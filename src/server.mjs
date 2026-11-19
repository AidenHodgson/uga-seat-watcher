// The dashboard at http://127.0.0.1:4830, including first-time setup. Only this computer can open it.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Athena } from './athena.mjs';
import { DEFAULTS, courseName, hasConfig, loadConfig, normalize, saveConfig, validate } from './config.mjs';
import { advise, waitlistOdds } from './advice.mjs';
import { history, recentHistory, runCheck, status } from './core.mjs';
import { upcoming } from './dates.mjs';
import { MAX_AGE_MS, cachedAt, find, loadTerm, progress } from './finder.mjs';
import { notify } from './notify.mjs';
import { ROOT, STATE, log, readJson, termCache } from './paths.mjs';
import { check } from './rules.mjs';
import { buildSchedules } from './schedule.mjs';
import { install, installed } from './service.mjs';

const PAGE = path.join(ROOT, 'web', 'index.html');
let termsCache = null;

export function openBrowser(url) {
  if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', url]);
  else if (process.platform === 'darwin') execFile('open', [url]);
  else execFile('xdg-open', [url], () => {});
}

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 200_000) throw new Error('too big');
  }
  return raw ? JSON.parse(raw) : {};
}

/**
 * Adds what the page shows next to a section: does it fit, your waitlist odds, and when it last
 * reopened (only for a section that has been full since watching started).
 */
function decorate(s, rule, config, state, mine = {}) {
  const h = history(s.crn, state);
  return {
    ...s,
    ...check(s, rule ?? {}, config.rules),
    odds: waitlistOdds(s, { onIt: mine.waitlisted === s.crn }),
    reopened_at: h?.ever_full && s.seats > 0 && h.opened_at ? h.opened_at : null,
    opens: h?.opens ?? 0,
    yours: mine.registered === s.crn ? 'registered' : mine.waitlisted === s.crn ? 'waitlisted' : null,
  };
}

/** Re-marks sections against the current config, so the page reflects edits before the next check. */
function view(config) {
  const byCourse = new Map(config.courses.map((c) => [c.course, c]));
  const state = readJson(STATE, { sections: {} });
  return status.courses.map((c) => {
    const rule = byCourse.get(c.course);
    if (!c.ok || !rule) return c;
    return {
      ...c,
      alerts: rule.enabled !== false,
      targeted: !!rule.targets?.length,
      sections: c.sections.map((s) => decorate(s, rule, config, state, rule)),
    };
  });
}

// Courses looked up for the extension (ones you aren't watching), kept briefly so a page of
// results doesn't mean a page of Athena searches.
const lookups = new Map();
const LOOKUP_MS = 2 * 60 * 1000;

async function lookup(name, config) {
  const watched = view(config).find((c) => c.course === name && c.ok);
  if (watched) return { course: name, watched: true, sections: watched.sections };
  const hit = lookups.get(name);
  if (hit && Date.now() - hit.at < LOOKUP_MS) return hit.value;
  const a = new Athena(config.school.athena, config.term);
  await a.start();
  const [subject, number] = name.split(' ');
  const state = readJson(STATE, { sections: {} });
  const value = { course: name, watched: false, sections: (await a.course(subject, number)).map((s) => decorate(s, {}, config, state)) };
  lookups.set(name, { at: Date.now(), value });
  return value;
}

/** Sets which section you're in / waitlisted for (adding the course if it's new), then saves. */
function setHeld(config, course, { registered, waitlisted, enabled } = {}) {
  const name = courseName(course);
  if (!name) throw new Error(`"${course}" doesn't look like a course.`);
  let c = config.courses.find((x) => x.course === name);
  if (!c) {
    c = { course: name, enabled: false, targets: [], registered: '', waitlisted: '' };
    config.courses.push(c);
  }
  if (registered !== undefined) c.registered = registered || '';
  if (waitlisted !== undefined) c.waitlisted = waitlisted || '';
  if (c.registered && c.waitlisted === c.registered) c.waitlisted = '';
  if (enabled !== undefined) c.enabled = !!enabled;
  return validate(config);
}

const intParam = (v) => (v ? parseInt(v, 10) || undefined : undefined);
const listParam = (v) => (v ? String(v).split(',').map((x) => x.trim()).filter(Boolean) : []);

// macOS won't let a background app read Desktop, Documents or Downloads without extra permission,
// so auto-start would quietly break from there.
const macFolderWarning = process.platform === 'darwin' && /\/(Desktop|Documents|Downloads)(\/|$)/.test(ROOT) ? ROOT.match(/(Desktop|Documents|Downloads)/)[1] : null;

/**
 * Starts the dashboard. `onSetup(config, autostart)` runs when first-time setup finishes; it
 * returns what the page should say next.
 */
export function serve({ onSetup } = {}) {
  const port = loadConfig().port;
  const server = http.createServer(async (req, res) => {
    const host = (req.headers.host || '').split(':')[0];
    if (host !== '127.0.0.1' && host !== 'localhost') return send(res, 403, { error: 'local only' });
    // A web page you visit can still send requests to 127.0.0.1. Only this dashboard and browser
    // extensions may talk to it.
    const origin = req.headers.origin;
    if (origin && !/^(http:\/\/(127\.0\.0\.1|localhost):\d+|chrome-extension:\/\/[a-p]{32})$/.test(origin)) {
      return send(res, 403, { error: 'not allowed from that page' });
    }
    const url = new URL(req.url, 'http://x');
    try {
      if (req.method === 'GET' && url.pathname === '/') return send(res, 200, fs.readFileSync(PAGE, 'utf8'), 'text/html; charset=utf-8');

      if (req.method === 'GET' && url.pathname === '/api/state') {
        const c = loadConfig();
        return send(res, 200, {
          needs_setup: !hasConfig(),
          root: ROOT,
          config: c,
          status: { ...status, courses: view(c) },
          platform: process.platform,
          autostart: installed(),
          mac_folder_warning: macFolderWarning,
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/terms') {
        termsCache ??= (await Athena.terms(loadConfig().school.athena)).filter((t) => !/view only/i.test(t.description));
        return send(res, 200, termsCache);
      }

      // Setup checks each course as it's typed: does it exist this term, and how many seats are open?
      if (req.method === 'GET' && url.pathname === '/api/course') {
        const name = courseName(url.searchParams.get('name'));
        const term = url.searchParams.get('term');
        if (!name) return send(res, 400, { error: "That doesn't look like a course. Use the form BUSN 4000." });
        if (!/^\d{6}$/.test(term ?? '')) return send(res, 400, { error: 'Pick a term first.' });
        const a = new Athena(loadConfig().school.athena, term);
        await a.start();
        const [subject, number] = name.split(' ');
        const secs = await a.course(subject, number);
        return send(res, 200, { course: name, title: secs[0]?.title ?? '', sections: secs.length, open: secs.filter((s) => s.seats > 0).length });
      }

      if (req.method === 'GET' && url.pathname === '/api/schedules') {
        const c = loadConfig();
        const strict = url.searchParams.get('strict') !== '0';
        const held = new Map(c.courses.map((x) => [x.course, x.registered || x.waitlisted]));
        const courses = view(c)
          .filter((x) => x.ok)
          .map((x) => ({ ...x, held: held.get(x.course) || '' }));
        return send(res, 200, buildSchedules(courses, c.rules, { strict }));
      }

      // Your week, what to do next, and the dates that matter.
      if (req.method === 'GET' && url.pathname === '/api/week') {
        const c = loadConfig();
        return send(res, 200, { ...advise(view(c), c), dates: upcoming(c.term), last_check_at: status.last_check_at, checking: status.checking });
      }

      // Every section of one course, marked against your rules (the extension's view of a course).
      if (req.method === 'GET' && url.pathname === '/api/lookup') {
        const name = courseName(url.searchParams.get('course'));
        if (!name) return send(res, 400, { error: "That doesn't look like a course. Use the form BUSN 4000." });
        const c = loadConfig();
        if (!c.term) return send(res, 400, { error: 'Finish setup first.' });
        return send(res, 200, await lookup(name, c));
      }

      // Which section you're in or waitlisted for, set from the dashboard, the extension or Claude.
      if (req.method === 'POST' && url.pathname === '/api/held') {
        const body = await readBody(req);
        let next;
        try {
          next = setHeld(loadConfig(), body.course, body);
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
        saveConfig(next);
        runCheck({ alerts: false }).catch(() => {});
        return send(res, 200, { ok: true, config: next });
      }

      // The extension reads the Summary panel in Athena and sends what it says: Registered,
      // Waitlisted, or dropped. Only courses on that page change.
      if (req.method === 'POST' && url.pathname === '/api/import') {
        const body = await readBody(req);
        let next = loadConfig();
        const changed = [];
        try {
          for (const row of body.rows ?? []) {
            const name = courseName(row.course);
            const crn = String(row.crn ?? '').trim();
            if (!name || !/^\d{5}$/.test(crn)) continue;
            const st = String(row.status ?? '').toLowerCase();
            const cur = next.courses.find((x) => x.course === name);
            if (st.includes('wait')) next = setHeld(next, name, { waitlisted: crn, ...(cur?.registered === crn ? { registered: '' } : {}) });
            else if (st.includes('regist') || st.includes('enrol')) next = setHeld(next, name, { registered: crn, ...(cur?.waitlisted === crn ? { waitlisted: '' } : {}) });
            else if (st.includes('delet') || st.includes('drop')) {
              if (cur?.registered === crn) next = setHeld(next, name, { registered: '' });
              if (cur?.waitlisted === crn) next = setHeld(next, name, { waitlisted: '' });
            } else continue;
            changed.push(`${name} ${crn} ${row.status}`);
          }
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
        saveConfig(next);
        if (changed.length) {
          log(`imported from Athena: ${changed.join('; ')}`);
          runCheck({ alerts: false }).catch(() => {});
        }
        return send(res, 200, { ok: true, changed });
      }

      // The elective finder. The first search of the day downloads the term (a minute or so).
      if (req.method === 'GET' && url.pathname === '/api/finder') {
        const c = loadConfig();
        if (!c.term) return send(res, 400, { error: 'Finish setup first.' });
        const p = url.searchParams;
        if (!cachedAt(c) || p.get('refresh') === '1') {
          loadTerm(c, { force: p.get('refresh') === '1' }).catch((e) => log(`finder download failed: ${e.message}`));
          return send(res, 202, { loading: true, progress });
        }
        // Answer from the cache; when it's over 6 hours old, refresh it in the background for next time.
        const term = readJson(termCache(c.term), null);
        if (Date.now() - Date.parse(term.at) > MAX_AGE_MS) loadTerm(c, { force: true }).catch((e) => log(`finder refresh failed: ${e.message}`));
        const held = advise(view(c), c).week.picks;
        const q = {
          min: intParam(p.get('min')),
          max: intParam(p.get('max')),
          credits: intParam(p.get('credits')),
          format: p.get('format') || 'any',
          open: p.get('open') !== '0',
          days: p.get('days') || '',
          after: p.get('after') || '',
          before: p.get('before') || '',
          subjects: listParam(p.get('subjects')),
          exclude: listParam(p.get('exclude')),
          text: p.get('text') || '',
          campus: p.get('campus') || '',
          fits_rules: p.get('fits_rules') === '1',
          around: p.get('around_week') === '0' ? [] : held,
          skip_courses: c.courses.map((x) => x.course),
        };
        const r = find(term, q, c.rules);
        const limit = Math.min(200, intParam(p.get('limit')) ?? 60);
        return send(res, 200, { ...r, courses: r.courses.slice(0, limit), shown: Math.min(limit, r.courses.length) });
      }

      if (req.method === 'GET' && url.pathname === '/api/history') {
        return send(res, 200, recentHistory({ crns: listParam(url.searchParams.get('crns')).length ? listParam(url.searchParams.get('crns')) : undefined, limit: 200 }));
      }

      if (req.method === 'POST' && url.pathname === '/api/check') {
        await runCheck();
        return send(res, 200, { ok: true });
      }

      if (req.method === 'PUT' && url.pathname === '/api/config') {
        let next;
        try {
          next = validate(await readBody(req));
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
        saveConfig(next);
        log('settings saved from the dashboard');
        runCheck({ alerts: false }).catch(() => {}); // refresh the page without alerting
        return send(res, 200, { ok: true, config: next });
      }

      if (req.method === 'POST' && url.pathname === '/api/setup') {
        const body = await readBody(req);
        let next;
        try {
          next = validate({ ...DEFAULTS, ...body.config });
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
        saveConfig(next);
        log('first-time setup saved');
        const result = onSetup ? await onSetup(next, body.autostart !== false) : { message: 'Saved.' };
        return send(res, 200, { ok: true, ...result });
      }

      // The page can send a test with alert settings it hasn't saved yet (setup does).
      if (req.method === 'POST' && url.pathname === '/api/test-alert') {
        const body = await readBody(req).catch(() => ({}));
        const c = normalize({ ...loadConfig(), ...(body.alerts ? { alerts: body.alerts } : {}) });
        const problems = await notify(c, 'Seat Watcher test', 'If you see this, alerts work.', `http://127.0.0.1:${c.port}`);
        return send(res, 200, { ok: !problems.length, problems });
      }

      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 500, { error: e.message });
    }
  });

  // If the port is busy (another copy is handing off, or still shutting down), keep trying.
  let warned = false;
  server.on('error', (e) => {
    if (e.code !== 'EADDRINUSE') return log(`dashboard error: ${e.message}`);
    if (!warned) log(`port ${port} is busy, will keep trying (is another copy running? http://127.0.0.1:${port})`);
    warned = true;
    setTimeout(() => server.listen(port, '127.0.0.1'), 5000);
  });
  server.on('listening', () => log(`dashboard on http://127.0.0.1:${port}`));
  server.listen(port, '127.0.0.1');
  return server;
}

export { install };
