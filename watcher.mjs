#!/usr/bin/env node
/**
 * Seat Watcher: tells you when a seat opens in a UGA class that fits your schedule.
 *
 *   node watcher.mjs --open          start (setup in the browser the first time) and open the dashboard
 *   node watcher.mjs                 run: checks every few minutes plus the dashboard
 *   node watcher.mjs --once          one check, printed
 *   node watcher.mjs find BUSN 4000  every section of a course
 *   node watcher.mjs --test          send a test alert
 *   node watcher.mjs --install       start automatically when you log in (Windows or Mac)
 *   node watcher.mjs --uninstall     stop starting automatically
 */

import { Athena } from './src/athena.mjs';
import { hasConfig, loadConfig } from './src/config.mjs';
import { runCheck, status } from './src/core.mjs';
import { notify } from './src/notify.mjs';
import { log } from './src/paths.mjs';
import { label } from './src/rules.mjs';
import { openBrowser, serve } from './src/server.mjs';
import { install, uninstall } from './src/service.mjs';

const [major] = process.versions.node.split('.').map(Number);
if (major < 18) {
  console.error(`Seat Watcher needs Node 18 or newer (you have ${process.versions.node}). Get the LTS from https://nodejs.org`);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const row = (s) =>
  `CRN ${s.crn}  ${label(s).padEnd(18)} ${String(s.seats).padStart(3)} open of ${s.max}${s.waiting ? `, ${s.waiting} waiting` : ''}  ${s.instructor ?? ''}`;

async function loop() {
  let failures = 0;
  for (;;) {
    let minutes = 3;
    try {
      await runCheck();
      minutes = Math.max(2, Number(loadConfig().every_minutes) || 3);
      failures = status.last_error ? failures + 1 : 0;
      if (status.last_error) log(`check problem: ${status.last_error}`);
    } catch (e) {
      failures++;
      log(`check failed: ${e.message}`);
    }
    // After a failure (usually no wifi right after the laptop wakes up) back off, up to 15 minutes.
    const wait = failures ? Math.min(minutes * failures, 15) : minutes;
    status.next_check_at = new Date(Date.now() + wait * 60_000).toISOString();
    await sleep(wait * 60_000);
  }
}

/** Is a watcher already answering on this computer? */
async function alreadyRunning(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/state`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * The normal way in. Starts the dashboard; with no config yet the dashboard shows setup, and the
 * checking starts once setup is saved. If setup turns on auto-start, this copy hands over to the
 * background one and exits.
 */
async function start({ open }) {
  const port = loadConfig().port;
  const url = `http://127.0.0.1:${port}`;
  // Only the launcher steps aside for a copy that's already running. The background service never
  // does: during the hand-off from setup, the port is busy for a moment and the dashboard retries.
  if (open && (await alreadyRunning(port))) {
    console.log(`Seat Watcher is already running. Opening ${url}`);
    if (open) openBrowser(url);
    return;
  }
  log('seat watcher started');
  let looping = false;
  const begin = () => {
    if (looping) return;
    looping = true;
    loop();
  };
  serve({
    onSetup: async (config, autostart) => {
      if (autostart && (process.platform === 'win32' || process.platform === 'darwin')) {
        try {
          install(config.port);
          console.log('\nAll set. Seat Watcher now runs in the background and starts whenever you log in.');
          console.log('You can close this window.');
          // Let the page get its answer, then step aside so the background copy takes the port.
          setTimeout(() => process.exit(0), 1500);
          return { handoff: true, message: 'Seat Watcher now runs in the background and starts whenever you log in.' };
        } catch (e) {
          log(`auto-start setup failed: ${e.message.split('\n')[0]}`);
          begin();
          return { handoff: false, message: `Couldn't set up auto-start (${e.message.split('\n')[0]}). It's running now, but only while this window stays open.` };
        }
      }
      begin();
      return { handoff: false, message: 'Running. Keep the Seat Watcher window open (you can minimize it).' };
    },
  });
  if (hasConfig()) begin();
  else console.log(`First time? Finish setup in your browser: ${url}`);
  if (open) setTimeout(() => openBrowser(url), 600);
}

const [cmd, ...args] = process.argv.slice(2);
if (!hasConfig() && ['--once', '--test', '--install'].includes(cmd)) {
  console.log('Not set up yet. Run "node watcher.mjs --open" and finish setup in your browser.');
  process.exit(1);
}

if (cmd === 'find') {
  const [subject, number] = args.map((a) => a.toUpperCase());
  const c = loadConfig();
  if (!subject || !number) {
    console.log('usage: node watcher.mjs find BUSN 4000');
  } else {
    const a = new Athena(c.school.athena, c.term || (await Athena.terms(c.school.athena))[0].code);
    await a.start();
    const rows = (await a.course(subject, number)).sort((x, y) => String(x.begin ?? '9999').localeCompare(String(y.begin ?? '9999')));
    for (const s of rows) console.log(row(s));
    console.log(`\n${rows.length} section(s)`);
  }
} else if (cmd === '--once') {
  const courses = await runCheck({ alerts: false });
  for (const c of courses) {
    console.log(`\n${c.course}${c.ok ? '' : `  (failed: ${c.error})`}`);
    for (const s of c.sections ?? []) console.log(`  ${s.fits ? '*' : ' '} ${row(s)}${s.why?.length ? `  [${s.why.join(', ')}]` : ''}`);
  }
  console.log('\n* fits your rules');
} else if (cmd === '--test') {
  const c = loadConfig();
  const problems = await notify(c, 'Seat Watcher test', 'If you see this, alerts work.', `http://127.0.0.1:${c.port}`);
  console.log(problems.length ? `Some alerts failed:\n  ${problems.join('\n  ')}` : 'Sent a test alert.');
} else if (cmd === '--install') {
  console.log(install(loadConfig().port));
} else if (cmd === '--uninstall') {
  console.log(uninstall());
} else {
  await start({ open: cmd === '--open' });
}
