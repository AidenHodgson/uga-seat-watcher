// What to do next: your week as it stands, waitlist odds, and moves that can't leave you without a
// seat. Everything here follows UGA's rules as students actually hit them:
//
// - While anyone is on a section's waitlist, every open seat in it is held for the waitlist.
// - You can be on one waitlist per course, and not while registered in another section of it.
// - Switching sections: add the new CRN and drop the old one in the same submit. Dropping first can
//   leave you with nothing if the old section has people waiting (your seat goes to them).
// - When a waitlist seat opens for you, UGA emails your UGA address and you have about 18 hours.

import { clock, label } from './rules.mjs';
import { clash, describe, score, sortPicks, summary } from './schedule.mjs';
import { walkWarnings } from './campus.mjs';

/**
 * Your odds if you joined this section's waitlist now (or where the line stands if you're on it).
 * Athena shows how many are waiting, not your exact spot, so "you'd be #N" assumes you join last.
 * Returns null for a section with no waitlist.
 */
export function waitlistOdds(s, { onIt = false } = {}) {
  if (!s.waiting) return null;
  const position = onIt ? s.waiting : s.waiting + 1;
  const seats = s.raw_seats ?? 0;
  let level;
  let text;
  if (seats >= position) {
    level = 'likely';
    text = onIt
      ? `${s.waiting} on the list including you, ${seats} seats open: everyone on it should get in`
      : `You'd be #${position} for ${seats} open seats: likely`;
  } else if (seats > 0) {
    level = 'maybe';
    const need = position - seats;
    text = onIt
      ? `${s.waiting} on the list including you, ${seats} seats open: needs about ${need} more ${need === 1 ? 'drop' : 'drops'}`
      : `You'd be #${position}, ${seats} seats open: needs ${need} more ${need === 1 ? 'drop' : 'drops'}`;
  } else {
    level = 'long';
    text = onIt ? `${s.waiting} on the list including you, no seats open yet` : `You'd be #${position} and it's full: a long shot`;
  }
  return { position, seats, level, text };
}

const RANK = { likely: 0, maybe: 1, long: 2 };

/**
 * Your week and your next moves. `courses` are status courses with sections already marked `fits`
 * (and `why`), `config` is the loaded config.
 */
export function advise(courses, config) {
  const rules = config.rules;
  const byCourse = new Map(courses.filter((c) => c.ok).map((c) => [c.course, c]));
  const held = [];
  const notes = [];
  for (const c of config.courses) {
    const crn = c.registered || c.waitlisted;
    if (!crn) continue;
    const s = byCourse.get(c.course)?.sections.find((x) => x.crn === crn);
    if (!s) {
      if (byCourse.has(c.course)) notes.push(`${c.course}: CRN ${crn} isn't in Athena's list for this term. Check the number.`);
      continue;
    }
    held.push({
      course: c.course,
      key: s.meetings.map((m) => `${m.days}${m.begin}-${m.end}`).join('|'),
      meetings: s.meetings,
      sections: [s],
      current: true,
      waitlisted: !c.registered,
    });
  }
  const placed = held.filter((p) => p.meetings.length);
  const facts = describe(placed, rules);
  const week = {
    picks: sortPicks(placed),
    online: held.filter((p) => !p.meetings.length),
    facts,
    summary: placed.length ? summary(facts) : '',
    score: score(facts),
    walks: walkWarnings(placed),
    notes,
  };

  const moves = [];
  for (const c of config.courses) {
    const status = byCourse.get(c.course);
    if (!status) continue;
    const mine = held.find((p) => p.course === c.course);
    const others = placed.filter((p) => p.course !== c.course);
    const fitsAround = (s) => !others.some((o) => clash(o, s));
    const sections = status.sections;

    if (c.registered && mine) {
      // Registered: is there a better section open right now?
      const reg = mine.sections[0];
      const keep = reg.waiting > 0 || reg.seats <= 0;
      const better = sections
        .filter((s) => s.crn !== reg.crn && s.seats > 0 && s.fits && fitsAround(s))
        .map((s) => {
          const after = describe([...others, { ...s, current: false, sections: [s] }].filter((p) => p.meetings.length), rules);
          return { s, change: score(after) - week.score, after };
        })
        .filter((x) => c.targets?.length || !reg.fits || x.change < -0.5)
        .sort((a, b) => a.change - b.change);
      if (better.length) {
        const { s, after } = better[0];
        moves.push({
          course: c.course,
          kind: 'swap',
          urgency: 1,
          title: `Switch ${c.course} to ${label(s)} (CRN ${s.crn}, ${s.seats} open)`,
          why: improvements(facts, after) || (reg.fits ? 'A better week' : `Your section doesn't fit your rules (${reg.why?.join(', ')})`),
          steps: swapSteps(s.crn, reg.crn, keep),
          crns: [s.crn],
          drop: reg.crn,
          alternates: better.slice(1, 3).map((x) => x.s.crn),
        });
      }
      continue;
    }

    if (c.waitlisted && mine) {
      const wl = mine.sections[0];
      const now = waitlistOdds(wl, { onIt: true });
      const open = sections.filter((s) => s.crn !== wl.crn && s.seats > 0 && s.fits && fitsAround(s)).sort((a, b) => b.seats - a.seats);
      if (open.length) {
        moves.push({
          course: c.course,
          kind: 'register',
          urgency: 0,
          title: `Register for ${c.course} ${label(open[0])} now (CRN ${open[0].crn}, ${open[0].seats} open, nobody waiting)`,
          why: `A sure seat beats a waitlist spot. UGA won't keep you on the ${wl.crn} waitlist once you're registered in the course, so expect to lose that spot.`,
          steps: ['Enter CRNs: add ' + open[0].crn + ', click Add to Summary, then Submit.', `Check it says Registered. Your ${wl.crn} waitlist row may disappear; that's expected.`],
          crns: [open[0].crn],
        });
        continue;
      }
      // A waitlist with clearly better odds?
      const switchTo = sections
        .filter((s) => s.crn !== wl.crn && s.fits && fitsAround(s))
        .map((s) => ({ s, odds: waitlistOdds(s) }))
        .filter((x) => x.odds && x.odds.level === 'likely')
        .sort((a, b) => b.odds.seats - b.odds.position - (a.odds.seats - a.odds.position));
      if (switchTo.length && now?.level !== 'likely') {
        const { s, odds } = switchTo[0];
        moves.push({
          course: c.course,
          kind: 'switch-waitlist',
          urgency: 1,
          title: `Move your ${c.course} waitlist spot to ${label(s)} (CRN ${s.crn})`,
          why: `${odds.text}. Right now on ${wl.crn}: ${now?.text ?? 'no line info'}. You can only be on one waitlist per course, so you'd leave ${wl.crn}'s line for good.`,
          steps: [
            `Set ${wl.crn} to Drop (it may say Web Drop or Remove), Submit, and check it's gone.`,
            `Enter CRNs: add ${s.crn}, Add to Summary, Submit. You'll get "Seat(s) Reserved for Waitlist".`,
            `Change the ${s.crn} Action to Waitlisted and Submit again. Check the Status says Waitlisted.`,
            `If Waitlisted doesn't show up, re-add ${wl.crn} the same way right away.`,
          ],
          crns: [s.crn],
          drop: wl.crn,
        });
      } else {
        moves.push({
          course: c.course,
          kind: 'wait',
          urgency: 2,
          title: `${c.course}: hold your waitlist spot on ${wl.crn}`,
          why: `${now?.text ?? 'No line info yet'}. When a seat opens for you, UGA emails your UGA address and you have about 18 hours to register.`,
          steps: [`When the email comes: Register for Classes, set ${wl.crn} to Web Registered, Submit.`],
          crns: [],
        });
      }
      continue;
    }

    // No seat yet.
    const open = sections.filter((s) => s.seats > 0 && s.fits && fitsAround(s)).sort((a, b) => b.seats - a.seats);
    if (open.length) {
      moves.push({
        course: c.course,
        kind: 'register',
        urgency: 0,
        title: `Register for ${c.course} ${label(open[0])} (CRN ${open[0].crn}, ${open[0].seats} open)`,
        why: open.length > 1 ? `Also open: ${open.slice(1, 3).map((s) => `${label(s)} (${s.crn})`).join(', ')}.` : 'Nobody is waiting, so the seat is yours if you take it.',
        steps: [`Enter CRNs: add ${open[0].crn}, Add to Summary, Submit. Check it says Registered.`],
        crns: [open[0].crn],
      });
      continue;
    }
    const lines = sections
      .filter((s) => s.fits && fitsAround(s))
      .map((s) => ({ s, odds: waitlistOdds(s) }))
      .filter((x) => x.odds)
      .sort((a, b) => RANK[a.odds.level] - RANK[b.odds.level] || b.odds.seats - b.odds.position - (a.odds.seats - a.odds.position));
    if (lines.length) {
      const { s, odds } = lines[0];
      moves.push({
        course: c.course,
        kind: 'join-waitlist',
        urgency: 1,
        title: `Join the ${c.course} waitlist for ${label(s)} (CRN ${s.crn})`,
        why: `${odds.text}. You can only be on one waitlist per course, so pick the best line.`,
        steps: [
          `Enter CRNs: add ${s.crn}, Add to Summary, Submit. You'll get "Seat(s) Reserved for Waitlist".`,
          `Change the ${s.crn} Action to Waitlisted and Submit again. Check the Status says Waitlisted.`,
        ],
        crns: [s.crn],
      });
      continue;
    }
    const backups = sections.filter((s) => s.seats > 0 && fitsAround(s)).sort((a, b) => b.seats - a.seats);
    if (backups.length) {
      moves.push({
        course: c.course,
        kind: 'backup',
        urgency: 1,
        title: `Backup for ${c.course}: ${label(backups[0])} (CRN ${backups[0].crn}, ${backups[0].seats} open)`,
        why: `Nothing that fits your rules has a seat or a short waitlist (${backups[0].why?.join(', ') || 'outside your rules'}). A seat you don't love beats no seat, and the watcher will tell you if a better one opens.`,
        steps: [`Enter CRNs: add ${backups[0].crn}, Add to Summary, Submit.`],
        crns: [backups[0].crn],
      });
    } else {
      moves.push({
        course: c.course,
        kind: 'full',
        urgency: 2,
        title: `${c.course} is full everywhere`,
        why: 'No open seats and no waitlist worth joining that fits your week. The watcher keeps checking.',
        steps: [],
        crns: [],
      });
    }
  }
  moves.sort((a, b) => a.urgency - b.urgency);
  return { week, moves };
}

function swapSteps(add, drop, keep) {
  return [
    `Enter CRNs: add ${add} and click Add to Summary.`,
    `In the Summary, set ${drop} to Drop (it may say Web Drop). Don't submit yet.`,
    'Click Submit once, so both happen together. If you see a "Conditional Add and Drop" box, check it first.',
    `Check ${add} says Registered and ${drop} says Deleted.`,
    keep
      ? `Never drop ${drop} on its own first: people are waiting for it, so your seat would go to them and you couldn't get back in.`
      : `If ${add} errors out, re-add ${drop} right away while it still has room.`,
  ];
}

/** What gets better going from one week to another, in plain words. */
export function improvements(before, after) {
  const out = [];
  const freed = before.days.filter((d) => !after.days.includes(d));
  if (freed.length) out.push(`frees ${freed.map((d) => ({ M: 'Monday', T: 'Tuesday', W: 'Wednesday', R: 'Thursday', F: 'Friday' })[d]).join(' and ')}`);
  if (after.early < before.early) out.push(`${before.early - after.early} fewer early ${before.early - after.early === 1 ? 'day' : 'days'}`);
  if (after.days.length && before.days.length && after.earliest > before.earliest) out.push(`first class at ${clock(after.earliest)} instead of ${clock(before.earliest)}`);
  if (after.latest < before.latest && after.days.length) out.push(`done by ${clock(after.latest)}`);
  const gap = Math.round((before.gapMins - after.gapMins) / 60);
  if (gap > 0) out.push(`${gap}h less waiting between classes`);
  if (after.offPreferred < before.offPreferred) out.push('on your preferred days');
  if (!out.length) return '';
  const s = out.join(', ');
  return s[0].toUpperCase() + s.slice(1);
}
