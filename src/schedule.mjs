// Builds possible weekly schedules out of sections that have open seats.
//
// Sections of a course that meet at exactly the same times are grouped into one "time slot", so
// 12 COMM sections at TR 9:55 count once and the CRNs ride along as alternatives. Then it tries
// every combination of slots with no time clashes and ranks them by how livable the week is.

import { DAY_NAMES, clock } from './rules.mjs';

const WEEK = ['M', 'T', 'W', 'R', 'F'];
const MAX_NODES = 400_000;

const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(2));

// `held` is the CRN you're registered in (or waitlisted for): it's always usable, seats or not,
// because it's yours. Its slot is marked `current`.
function slotsFor(course, sections, strict, held = '') {
  const usable = sections.filter((s) => s.crn === held || (s.seats > 0 && !s.online && s.begin && (!strict || s.fits)));
  const bySlot = new Map();
  for (const s of usable) {
    if (!s.begin) continue;
    const key = s.meetings.map((m) => `${m.days}${m.begin}-${m.end}`).sort().join('|');
    if (!bySlot.has(key)) bySlot.set(key, { course, key, meetings: s.meetings, sections: [], current: false });
    const slot = bySlot.get(key);
    slot.sections.push(s);
    if (s.crn === held) slot.current = true;
  }
  for (const slot of bySlot.values()) slot.sections.sort((a, b) => (a.crn === held ? -1 : b.crn === held ? 1 : b.seats - a.seats));
  return [...bySlot.values()];
}

export function clash(a, b) {
  return a.meetings.some((x) => b.meetings.some((y) => [...x.days].some((d) => y.days.includes(d)) && x.begin < y.end && y.begin < x.end));
}

/** Plain facts about a week, used for ranking and for the summary line. */
export function describe(picks, rules) {
  const byDay = Object.fromEntries(WEEK.map((d) => [d, []]));
  for (const p of picks) for (const m of p.meetings) for (const d of m.days) if (byDay[d]) byDay[d].push(m);
  const days = WEEK.filter((d) => byDay[d].length);
  let gapMins = 0;
  let earliest = '2400';
  let latest = '0000';
  for (const d of days) {
    const ms = byDay[d].sort((a, b) => a.begin.localeCompare(b.begin));
    for (let i = 1; i < ms.length; i++) {
      const g = mins(ms[i].begin) - mins(ms[i - 1].end);
      if (g > 25) gapMins += g;
    }
    if (ms[0].begin < earliest) earliest = ms[0].begin;
    const end = ms.reduce((a, m) => (m.end > a ? m.end : a), '0000');
    if (end > latest) latest = end;
  }
  const preferred = rules.preferred_days || '';
  const offPreferred = preferred ? picks.filter((p) => p.meetings.some((m) => [...m.days].some((d) => !preferred.includes(d)))).length : 0;
  const early = days.filter((d) => byDay[d].some((m) => m.begin < '0930')).length;
  const late = days.filter((d) => byDay[d].some((m) => m.end > '1700')).length;
  const thin = picks.filter((p) => !p.current && p.sections[0].seats <= 3).length;
  return { days, earliest, latest, gapMins, offPreferred, early, late, thin };
}

export function score(f) {
  return f.days.length * 12 + f.early * 8 + f.late * 6 + (f.gapMins / 60) * 2 + f.offPreferred * 5 + f.thin * 3;
}

export function summary(f) {
  const parts = [`${f.days.length} days on campus (${f.days.map((d) => DAY_NAMES[d]).join(', ')})`];
  if (f.days.length) parts.push(`earliest ${clock(f.earliest)}`, `done by ${clock(f.latest)}`);
  if (f.gapMins >= 60) parts.push(`${Math.round(f.gapMins / 60)}h of gaps a week`);
  if (f.thin) parts.push(`${f.thin} section${f.thin > 1 ? 's' : ''} nearly full`);
  return parts.join(', ');
}

/**
 * courses: [{ course, sections }] with each section already marked `fits`.
 * Returns { complete, schedules: [{ score, summary, picks: [{ course, meetings, sections }] }], missing }.
 * When no week fits every course, it returns the weeks that fit the most courses and says which
 * ones are left out.
 */
export function buildSchedules(courses, rules, { strict = true, limit = 8 } = {}) {
  const options = courses.map((c) => ({ course: c.course, slots: slotsFor(c.course, c.sections, strict, c.held) }));
  const order = [...options].sort((a, b) => a.slots.length - b.slots.length);
  const results = [];
  let bestCount = 0;
  let nodes = 0;

  (function go(i, picks) {
    if (++nodes > MAX_NODES) return;
    if (i === order.length) {
      if (picks.length >= bestCount) {
        if (picks.length > bestCount) results.length = 0;
        bestCount = picks.length;
        results.push(picks);
      }
      return;
    }
    // Can the rest still reach the best count? If not, skip this branch.
    if (picks.length + (order.length - i) < bestCount) return;
    let placed = false;
    for (const slot of order[i].slots) {
      if (picks.some((p) => clash(p, slot))) continue;
      placed = true;
      go(i + 1, [...picks, slot]);
    }
    // Also try leaving this course out, so we still return something useful when a course can't fit.
    if (!placed || bestCount < order.length) go(i + 1, picks);
  })(0, []);

  const ranked = results
    .filter((picks) => picks.length) // nothing placed at all is not a schedule
    .map((picks) => {
      const f = describe(picks, rules);
      return { score: Math.round(score(f) * 10) / 10, summary: summary(f), picks: sortPicks(picks), facts: f, changes: picks.filter((p) => !p.current).length };
    })
    .sort((a, b) => a.score - b.score);

  // Drop near-duplicates: weeks with the same days and times are already one entry.
  const seen = new Set();
  const schedules = [];
  for (const s of ranked) {
    const key = s.picks.map((p) => `${p.course}:${p.key}`).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    schedules.push(s);
    if (schedules.length >= limit) break;
  }
  const placedCourses = new Set(schedules[0]?.picks.map((p) => p.course) ?? []);
  return {
    complete: bestCount === courses.length,
    missing: courses.map((c) => c.course).filter((c) => !placedCourses.has(c)),
    noSeats: options.filter((o) => !o.slots.length).map((o) => o.course),
    truncated: nodes > MAX_NODES,
    schedules,
  };
}

export function sortPicks(picks) {
  const first = (p) => {
    const m = p.meetings[0];
    return `${WEEK.indexOf(m.days[0])}${m.begin}`;
  };
  return [...picks].sort((a, b) => first(a).localeCompare(first(b)));
}
