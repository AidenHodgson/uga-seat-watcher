// The elective finder: every section of a term, filtered by what you can actually take.
//
// Athena's search returns the whole term when asked for no subject (about 19,000 sections at UGA),
// 500 per page. That's ~40 requests, so it's fetched slowly, at most once every few hours, and kept
// in a cache file. Only when someone opens the finder; never in the background.

import fs from 'node:fs';
import { Athena, toSection } from './athena.mjs';
import { log, readJson, termCache } from './paths.mjs';
import { check } from './rules.mjs';
import { clash } from './schedule.mjs';

export const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const PAGE = 500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let loading = null;
export const progress = { loading: false, done: 0, total: 0 };

/** The cached term, downloading it first if it's missing, stale, or `force`d. */
export function loadTerm(config, { force = false } = {}) {
  const file = termCache(config.term);
  const cached = readJson(file, null);
  if (!force && cached && Date.now() - Date.parse(cached.at) < MAX_AGE_MS) return Promise.resolve(cached);
  if (loading) return loading;
  loading = (async () => {
    progress.loading = true;
    progress.done = 0;
    const a = new Athena(config.school.athena, config.term);
    await a.start();
    await a.req(`${a.base}/classSearch/resetDataForm`, { method: 'POST' });
    const sections = [];
    for (let offset = 0; ; offset += PAGE) {
      const q = new URLSearchParams({ txt_term: config.term, pageOffset: String(offset), pageMaxSize: String(PAGE), sortColumn: 'subjectDescription', sortDirection: 'asc' });
      const r = await a.req(`${a.base}/searchResults/searchResults?${q}`);
      if (!r.ok) throw new Error(`Athena search failed (HTTP ${r.status})`);
      const j = r.json();
      const data = j.data ?? [];
      sections.push(...data.map(toSection));
      progress.total = j.totalCount ?? sections.length;
      progress.done = sections.length;
      if (!data.length || sections.length >= progress.total) break;
      await sleep(900); // be polite: this is the heaviest thing the app does
    }
    const out = { at: new Date().toISOString(), term: config.term, sections };
    fs.writeFileSync(file, JSON.stringify(out));
    log(`finder: cached ${sections.length} sections for ${config.term}`);
    return out;
  })().finally(() => {
    loading = null;
    progress.loading = false;
  });
  return loading;
}

export function cachedAt(config) {
  return readJson(termCache(config.term), null)?.at ?? null;
}

const num = (s) => parseInt(s.number, 10);
const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(2));

/**
 * Filters the term. Query (all optional):
 *  min, max        course number range, e.g. 3000 to 5999
 *  format          'online' | 'in_person' | 'any'
 *  open            true: only sections you can register in now (nobody waiting)
 *  days            allowed day letters, e.g. 'MTWR' (sections meeting other days are out)
 *  after, before   'HHMM': start no earlier, end no later
 *  credits         exact credit hours, e.g. 3
 *  subjects        only these prefixes; exclude: never these
 *  text            words in the title, e.g. 'leadership'
 *  fits_rules      true: must fit your rules from Settings
 *  around          held sections ({ meetings }) the results must not clash with
 *  skip_courses    courses to leave out (ones you already take)
 *  campus          e.g. 'Athens' (online sections always pass this)
 * Returns { at, total, courses: [{ course, title, credits, sections: [...] }] } best first.
 */
export function find(term, q, rules) {
  const subjects = new Set((q.subjects ?? []).map((s) => s.toUpperCase()));
  const exclude = new Set((q.exclude ?? []).map((s) => s.toUpperCase()));
  const skip = new Set(q.skip_courses ?? []);
  const words = String(q.text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const keep = term.sections.filter((s) => {
    const n = num(s);
    if (q.min && !(n >= q.min)) return false;
    if (q.max && !(n <= q.max)) return false;
    if (subjects.size && !subjects.has(s.subject)) return false;
    if (exclude.has(s.subject)) return false;
    if (skip.has(s.course)) return false;
    if (q.credits && Number(s.credits) !== Number(q.credits)) return false;
    if (q.format === 'online' && !s.remote) return false;
    if (q.format === 'in_person' && (s.remote || !s.begin)) return false;
    if (q.campus && !s.remote && s.campus !== q.campus) return false;
    if (q.open && s.seats <= 0) return false;
    if (words.length && !words.every((w) => s.title.toLowerCase().includes(w))) return false;
    if (s.begin) {
      if (q.days && s.meetings.some((m) => [...m.days].some((d) => !q.days.includes(d)))) return false;
      if (q.after && s.meetings.some((m) => m.begin < q.after)) return false;
      if (q.before && s.meetings.some((m) => m.end > q.before)) return false;
      if (q.around?.length && q.around.some((h) => clash(h, s))) return false;
    }
    if (q.fits_rules && !check(s, {}, rules).fits) return false;
    return true;
  });
  const byCourse = new Map();
  for (const s of keep) {
    if (!byCourse.has(s.course)) byCourse.set(s.course, { course: s.course, title: s.title, credits: s.credits, sections: [] });
    byCourse.get(s.course).sections.push(s);
  }
  const courses = [...byCourse.values()];
  for (const c of courses) c.sections.sort((a, b) => b.seats - a.seats || (a.begin ?? '9999').localeCompare(b.begin ?? '9999'));
  courses.sort((a, b) => b.sections[0].seats - a.sections[0].seats || a.course.localeCompare(b.course));
  return { at: term.at, total: keep.length, courses };
}

export { minutes };
