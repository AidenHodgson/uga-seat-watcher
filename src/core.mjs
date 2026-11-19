// One check: ask Athena about every course, mark what fits, compare with last time, alert.

import { Athena } from './athena.mjs';
import { loadConfig } from './config.mjs';
import { notify } from './notify.mjs';
import { STATE, log, readJson, writeJson } from './paths.mjs';
import { backupNotice, check, label } from './rules.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const status = {
  started_at: new Date().toISOString(),
  last_check_at: null,
  last_error: null,
  checking: false,
  next_check_at: null,
  courses: [], // [{ course, ok, error?, sections: [...with fits, why] }]
  events: [], // newest first: { at, kind: 'open'|'backup'|'low'|'none', title, body }
};

function remember(kind, title, body) {
  status.events = [{ at: new Date().toISOString(), kind, title, body }, ...status.events].slice(0, 40);
}

export function openText(opened, preferred) {
  const tag = (s) => (preferred && s.days === preferred ? ' (your preferred days)' : '');
  if (opened.length === 1) {
    const s = opened[0];
    return {
      title: `Seat open: ${s.course} ${label(s)}`,
      body: `${s.course} ${label(s)}${tag(s)}${s.instructor ? ` with ${s.instructor}` : ''}. CRN ${s.crn}, ${s.seats} open. Go register now.`,
    };
  }
  return {
    title: `${opened.length} seats opened`,
    body: opened.map((s) => `${s.course} ${label(s)}${tag(s)}, CRN ${s.crn}, ${s.seats} open`).join('\n'),
  };
}

export function backupText(n) {
  const list = n.backups.slice(0, 3).map((s) => `${label(s)}, CRN ${s.crn}, ${s.seats} open`).join('\n');
  if (n.kind === 'none') return { title: `${n.course} is completely full`, body: `Every section of ${n.course} is full. Join a waitlist if there is one.` };
  if (n.kind === 'low') {
    return { title: `${n.course}: backups running low`, body: `Still nothing open that fits your rules, and the best backup is down to ${n.backups[0].seats} seats:\n${list}` };
  }
  return {
    title: `${n.course}: take a backup`,
    body: `Every section that fits your rules is full. A seat you don't love beats no seat:\n${list}\nThe watcher will tell you if a better one opens.`,
  };
}

let running = null;

/** Runs one check (or joins the one already running). `alerts: false` updates the page only. */
export function runCheck({ alerts = true } = {}) {
  if (running) return running;
  running = (async () => {
    status.checking = true;
    const config = loadConfig();
    const courses = [];
    const watch = config.courses.filter((c) => c.enabled !== false);
    if (config.term && watch.length) {
      const athena = new Athena(config.school.athena, config.term);
      try {
        await athena.start();
        for (const c of watch) {
          const [subject, number] = c.course.split(' ');
          try {
            const sections = (await athena.course(subject, number)).map((s) => ({ ...s, ...check(s, c, config.rules) }));
            courses.push({ course: c.course, ok: true, targeted: !!c.targets?.length, sections });
          } catch (e) {
            courses.push({ course: c.course, ok: false, error: e.message });
          }
          await sleep(1200); // be polite between courses
        }
        status.last_error = null;
      } catch (e) {
        status.last_error = e.message;
      }
    }
    if (courses.some((c) => c.ok) || !watch.length) {
      status.courses = courses;
      status.last_check_at = new Date().toISOString();
      await compare(courses, config, alerts);
    }
    status.checking = false;
    return courses;
  })().finally(() => {
    status.checking = false;
    running = null;
  });
  return running;
}

async function compare(courses, config, alerts) {
  const state = readJson(STATE, { sections: {} });
  const prev = state.sections;
  const opened = [];
  const notices = [];
  for (const c of courses) {
    if (!c.ok) continue;
    for (const s of c.sections) {
      const before = prev[s.crn];
      if (before && before.seats <= 0 && s.seats > 0 && s.fits) opened.push(s);
    }
    const before = Object.values(prev).filter((p) => p.course === c.course);
    const n = c.targeted ? null : backupNotice(c.course, before, c.sections);
    if (n) notices.push(n);
    for (const [crn, v] of Object.entries(prev)) if (v.course === c.course) delete prev[crn];
    for (const s of c.sections) prev[s.crn] = { course: c.course, seats: s.seats, fits: s.fits };
  }
  writeJson(STATE, state);
  if (!alerts) return;
  const url = `http://127.0.0.1:${config.port}`;
  if (opened.length) {
    const { title, body } = openText(opened, config.rules.preferred_days);
    remember('open', title, body);
    log(`OPEN ${title}`);
    for (const p of await notify(config, title, body, url)) log(`alert problem: ${p}`);
  }
  for (const n of notices) {
    const { title, body } = backupText(n);
    remember(n.kind === 'take' ? 'backup' : n.kind, title, body);
    log(`BACKUP ${title}`);
    for (const p of await notify(config, title, body, url)) log(`alert problem: ${p}`);
  }
}
