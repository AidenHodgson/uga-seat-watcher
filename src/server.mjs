// The dashboard at http://127.0.0.1:4830, including first-time setup. Only this computer can open it.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Athena } from './athena.mjs';
import { DEFAULTS, courseName, hasConfig, loadConfig, normalize, saveConfig, validate } from './config.mjs';
import { runCheck, status } from './core.mjs';
import { notify } from './notify.mjs';
import { ROOT, log } from './paths.mjs';
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

/** Re-marks sections against the current config, so the page reflects edits before the next check. */
function view(config) {
  const byCourse = new Map(config.courses.map((c) => [c.course, c]));
  return status.courses.map((c) => {
    const rule = byCourse.get(c.course);
    if (!c.ok || !rule) return c;
    return { ...c, targeted: !!rule.targets?.length, sections: c.sections.map((s) => ({ ...s, ...check(s, rule, config.rules) })) };
  });
}

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
        return send(res, 200, buildSchedules(view(c).filter((x) => x.ok), c.rules, { strict }));
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
