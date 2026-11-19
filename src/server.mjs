// The dashboard at http://127.0.0.1:4823. Only this computer can open it.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Athena } from './athena.mjs';
import { loadConfig, saveConfig, validate } from './config.mjs';
import { runCheck, status } from './core.mjs';
import { notify } from './notify.mjs';
import { ROOT, log } from './paths.mjs';
import { check } from './rules.mjs';
import { buildSchedules } from './schedule.mjs';

const PAGE = path.join(ROOT, 'web', 'index.html');
let termsCache = null;

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

export function serve() {
  const config = loadConfig();
  const server = http.createServer(async (req, res) => {
    const host = (req.headers.host || '').split(':')[0];
    if (host !== '127.0.0.1' && host !== 'localhost') return send(res, 403, { error: 'local only' });
    const url = new URL(req.url, 'http://x');
    try {
      if (req.method === 'GET' && url.pathname === '/') return send(res, 200, fs.readFileSync(PAGE, 'utf8'), 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const c = loadConfig();
        return send(res, 200, { config: c, status: { ...status, courses: view(c) }, platform: process.platform });
      }
      if (req.method === 'GET' && url.pathname === '/api/schedules') {
        const c = loadConfig();
        const strict = url.searchParams.get('strict') !== '0';
        const courses = view(c).filter((x) => x.ok);
        return send(res, 200, buildSchedules(courses, c.rules, { strict }));
      }
      if (req.method === 'GET' && url.pathname === '/api/terms') {
        termsCache ??= await Athena.terms(loadConfig().school.athena);
        return send(res, 200, termsCache);
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
        runCheck({ alerts: false }).catch(() => {}); // refresh the page data without alerting
        return send(res, 200, { ok: true, config: next });
      }
      if (req.method === 'POST' && url.pathname === '/api/test-alert') {
        const c = loadConfig();
        const problems = await notify(c, 'Seat Watcher test', 'If you see this, alerts work.', `http://127.0.0.1:${c.port}`);
        return send(res, 200, { ok: !problems.length, problems });
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 500, { error: e.message });
    }
  });
  server.on('error', (e) =>
    log(e.code === 'EADDRINUSE' ? `port ${config.port} is busy: is the watcher already running? (open http://127.0.0.1:${config.port})` : `dashboard error: ${e.message}`),
  );
  server.listen(config.port, '127.0.0.1', () => log(`dashboard on http://127.0.0.1:${config.port}`));
  return server;
}
