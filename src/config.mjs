// config.json: what to watch and how. Written by setup in the browser and by the Settings tab, read again on
// every check, so edits apply within a few minutes without a restart.

import { CONFIG, readJson, writeJson } from './paths.mjs';
import { hhmm } from './rules.mjs';

export const DEFAULTS = {
  school: {
    name: 'UGA',
    athena: 'https://athena-prod.uga.edu/StudentRegistrationSsb/ssb',
    register_url: 'https://athena.uga.edu',
    // Rate My Professors school id (the number in ratemyprofessors.com/school/<id>). Optional: it
    // narrows the professor links to your school. Blank searches every school.
    rmp_school_id: '',
  },
  term: '',
  term_name: '',
  every_minutes: 3,
  rules: {
    earliest: '', // e.g. "09:30": skip sections that start earlier
    latest: '', // e.g. "17:00": skip sections that end later
    skip_days: '', // day letters M T W R(Thursday) F
    preferred_days: '', // e.g. "MW": schedules that stick to these rank higher
    avoid_times: [], // extra windows like "TR 13:00-14:30"
    allow_online: true,
  },
  courses: [], // { course: "BUSN 4000", enabled: true, targets: [] }
  alerts: { desktop: true, ntfy_topic: '', discord_webhook: '' },
  // Not 4823, so it never collides with the Basecamp seat watcher on the same laptop.
  port: 4830,
};

export function normalize(raw) {
  const c = raw ?? {};
  return {
    ...DEFAULTS,
    ...c,
    school: { ...DEFAULTS.school, ...(c.school ?? {}) },
    rules: { ...DEFAULTS.rules, ...(c.rules ?? {}) },
    alerts: { ...DEFAULTS.alerts, ...(c.alerts ?? {}) },
    courses: (c.courses ?? []).filter((x) => x && typeof x.course === 'string'),
  };
}

export const loadConfig = () => normalize(readJson(CONFIG, null));
export const hasConfig = () => readJson(CONFIG, null) !== null;

/** 'busn  4000' to 'BUSN 4000', or null. */
export function courseName(v) {
  const m = /^([A-Za-z]{2,4})\s*(\d{4}[A-Za-z]?)$/.exec(String(v ?? '').trim());
  return m ? `${m[1].toUpperCase()} ${m[2].toUpperCase()}` : null;
}

const dayLetters = (v) => {
  const up = String(v ?? '').toUpperCase();
  return [...'MTWRFSU'].filter((d) => up.includes(d)).join('');
};

/** Checks a config sent from the Settings tab. Throws an Error with a plain message when bad. */
export function validate(input) {
  const c = normalize(input);
  if (!/^\d{6}$/.test(c.term)) throw new Error('Pick a term.');
  const every = Number(c.every_minutes);
  if (!Number.isInteger(every) || every < 2 || every > 60) throw new Error('Check every 2 to 60 minutes. Please keep it at 2 or more so Athena stays happy.');
  c.every_minutes = every;
  for (const k of ['earliest', 'latest']) {
    if (c.rules[k] && !hhmm(c.rules[k])) throw new Error(`"${c.rules[k]}" isn't a time like 9:30 or 17:00.`);
    c.rules[k] = c.rules[k] ? `${hhmm(c.rules[k]).slice(0, 2)}:${hhmm(c.rules[k]).slice(2)}` : '';
  }
  c.rules.skip_days = dayLetters(c.rules.skip_days);
  c.rules.preferred_days = dayLetters(c.rules.preferred_days);
  c.rules.allow_online = c.rules.allow_online !== false;
  c.rules.avoid_times = (c.rules.avoid_times ?? []).map(String).filter((s) => s.trim());
  const seen = new Set();
  c.courses = c.courses.map((x) => {
    const name = courseName(x.course);
    if (!name) throw new Error(`"${x.course}" doesn't look like a course. Use the form BUSN 4000.`);
    if (seen.has(name)) throw new Error(`${name} is on the list twice.`);
    seen.add(name);
    const targets = (x.targets ?? []).map((t) => String(t).trim()).filter(Boolean);
    if (targets.some((t) => !/^\d{5}$/.test(t))) throw new Error(`${name}: CRNs are five digits.`);
    return { course: name, enabled: x.enabled !== false, targets, ...(x.allow_online === false ? { allow_online: false } : {}) };
  });
  if (c.courses.length > 15) throw new Error('Watch at most 15 courses.');
  if (c.alerts.ntfy_topic && !/^[\w-]{6,64}$/.test(c.alerts.ntfy_topic)) throw new Error('The ntfy topic can only use letters, numbers, - and _ (6 to 64 characters).');
  if (c.alerts.discord_webhook && !/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(c.alerts.discord_webhook)) throw new Error("That doesn't look like a Discord webhook link.");
  const port = Number(c.port);
  c.port = Number.isInteger(port) && port > 1024 && port < 65536 ? port : DEFAULTS.port;
  return c;
}

export const saveConfig = (c) => writeJson(CONFIG, c);
