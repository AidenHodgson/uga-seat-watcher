#!/usr/bin/env node
// First-time setup: a few questions, then it starts watching. Run again any time to start over
// (or just use the Settings tab in the dashboard).

import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import { Athena } from './src/athena.mjs';
import { DEFAULTS, courseName, hasConfig, loadConfig, saveConfig, validate } from './src/config.mjs';
import { hhmm } from './src/rules.mjs';
import { ROOT } from './src/paths.mjs';
import { install } from './src/service.mjs';

const [major] = process.versions.node.split('.').map(Number);
if (major < 18) {
  console.error(`Seat Watcher needs Node 18 or newer (you have ${process.versions.node}). Get the LTS from https://nodejs.org`);
  process.exit(1);
}

// Line reader that works both typed and piped (piped input arrives all at once).
const rl = readline.createInterface({ input, output, terminal: !!input.isTTY });
const queue = [];
let waiting = null;
let closed = false;
rl.on('line', (l) => (waiting ? (waiting(l), (waiting = null)) : queue.push(l)));
rl.on('close', () => {
  closed = true;
  if (waiting) {
    console.log('\nSetup stopped before it finished. Run "node setup.mjs" again.');
    process.exit(1);
  }
});
const nextLine = () => {
  if (queue.length) return Promise.resolve(queue.shift());
  if (closed) {
    console.log('\nSetup stopped before it finished. Run "node setup.mjs" again.');
    process.exit(1);
  }
  return new Promise((r) => (waiting = r));
};
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;

async function ask(q, fallback = '') {
  output.write(`${bold(q)}${fallback ? dim(` [${fallback}]`) : ''} `);
  const a = (await nextLine()).trim();
  if (!input.isTTY) output.write(`${a}\n`);
  return a || fallback;
}
async function yes(q, def = true) {
  const a = (await ask(`${q} (y/n)`, def ? 'y' : 'n')).toLowerCase();
  return a.startsWith('y');
}

// macOS won't let a background app read Desktop, Documents or Downloads without extra permission,
// so the auto-start would silently fail from there.
if (process.platform === 'darwin' && /\/(Desktop|Documents|Downloads)(\/|$)/.test(ROOT)) {
  console.log(`\n\x1b[33mHeads up:\x1b[0m this folder is in ${ROOT.match(/(Desktop|Documents|Downloads)/)[1]}.`);
  console.log('macOS blocks background apps from reading that folder, so the watcher could stop working after a restart.');
  console.log('Move the "uga-seat-watcher" folder into your home folder (Finder > Go > Home), then run setup again from there.\n');
}

const old = hasConfig() ? loadConfig() : null;
const base = DEFAULTS.school.athena;

console.log(`\n${bold('Seat Watcher setup')}`);
console.log(`It checks Athena's public class search every few minutes and tells you when a seat opens.`);
console.log(dim('No UGA login needed. Press Enter to take the answer in [brackets].\n'));

// 1. Term
let terms = [];
try {
  terms = (await Athena.terms(base)).filter((t) => !/view only/i.test(t.description));
} catch (e) {
  console.log(`Couldn't reach Athena (${e.message}). Check your internet and run this again.`);
  process.exit(1);
}
terms.forEach((t, i) => console.log(`  ${i + 1}. ${t.description}`));
const pick = Number(await ask('Which term?', String(Math.max(1, terms.findIndex((t) => t.code === old?.term) + 1 || 1))));
const term = terms[Math.min(Math.max(pick, 1), terms.length) - 1];
console.log(green(`  ${term.description}\n`));

// 2. Courses
const athena = new Athena(base, term.code);
await athena.start();
const courses = [];
console.log(dim('Type your courses separated by commas, like: BUSN 4000, COMM 1500, RMIN 4000'));
for (;;) {
  const raw = await ask('Courses?', old?.courses.map((c) => c.course).join(', '));
  const names = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const bad = names.filter((n) => !courseName(n));
  if (!names.length || bad.length) {
    console.log(`  ${bad.length ? `"${bad.join('", "')}" doesn't look like a course.` : 'Add at least one.'} Use the form BUSN 4000.`);
    continue;
  }
  for (const n of names.map(courseName)) {
    const [s, num] = n.split(' ');
    const secs = await athena.course(s, num);
    const open = secs.filter((x) => x.seats > 0).length;
    if (!secs.length) console.log(`  ${n}: no sections in ${term.description}. Skipping it.`);
    else {
      console.log(`  ${n}: ${secs.length} sections, ${open} with open seats`);
      courses.push({ course: n, enabled: true, targets: old?.courses.find((c) => c.course === n)?.targets ?? [] });
    }
  }
  if (courses.length) break;
}
console.log('');

// 3. Rules
console.log(bold('Your rules') + dim('  (sections outside them still show up, they just don\'t alert or go in suggested schedules)'));
const timeQ = async (q, fallback) => {
  for (;;) {
    const a = await ask(q, fallback);
    if (!a || a.toLowerCase() === 'any' || hhmm(a)) return a.toLowerCase() === 'any' ? '' : a;
    console.log('  Use a time like 9:30 or 17:00, or type any.');
  }
};
const earliest = await timeQ('Earliest a class can start? (9:30, or any)', old?.rules.earliest || '9:00');
const latest = await timeQ('Latest a class can end? (17:00 is 5pm, or any)', old?.rules.latest || 'any');
const skip = await ask('Days to skip? (letters M T W R F, R is Thursday. Example: F)', old?.rules.skip_days || 'none');
const preferred = await ask('Days you prefer? (MW, TR, or none)', old?.rules.preferred_days || 'none');
const online = await yes('Count online sections?', old ? old.rules.allow_online : true);
console.log('');

// 4. Alerts
console.log(bold('Alerts') + dim(`  (you always get a pop-up on this ${process.platform === 'darwin' ? 'Mac' : 'computer'})`));
let ntfyTopic = old?.alerts.ntfy_topic ?? '';
if (await yes('Also send alerts to your phone? Uses the free ntfy app, no account', true)) {
  ntfyTopic ||= `seats-${crypto.randomBytes(6).toString('hex')}`;
  console.log(`  1. Install "ntfy" from the App Store or Google Play.`);
  console.log(`  2. Tap +, and subscribe to this topic: ${bold(ntfyTopic)}`);
  console.log(dim('     Keep the topic to yourself: anyone who knows it can see your alerts.'));
} else ntfyTopic = '';
const discordHook = (await ask('Discord webhook link? (optional, Enter to skip)', old?.alerts.discord_webhook || '')).trim();
const every = Number(await ask('Check every how many minutes? (2 or more)', String(old?.every_minutes ?? 3)));
console.log('');

let config;
try {
  config = validate({
    ...(old ?? {}),
    term: term.code,
    term_name: term.description,
    every_minutes: Math.max(2, every || 3),
    rules: {
      ...(old?.rules ?? {}),
      earliest,
      latest,
      skip_days: /none/i.test(skip) ? '' : skip,
      preferred_days: /none/i.test(preferred) ? '' : preferred,
      allow_online: online,
    },
    courses,
    alerts: { desktop: true, ntfy_topic: ntfyTopic, discord_webhook: discordHook },
  });
} catch (e) {
  console.log(`Something's off: ${e.message} Run setup again.`);
  process.exit(1);
}
saveConfig(config);
console.log(green('Saved your settings to config.json.'));

// 5. Start
const url = `http://127.0.0.1:${config.port}`;
if (process.platform === 'win32' || process.platform === 'darwin') {
  if (await yes('Start it now, and every time you log in?', true)) {
    try {
      console.log(install(config.port));
      console.log(`Dashboard: ${bold(url)}`);
      const { notify } = await import('./src/notify.mjs');
      await notify(config, 'Seat Watcher is on', 'This is what an alert looks like.', url);
      await new Promise((r) => setTimeout(r, 2500));
      if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', url]);
      else execFile('open', [url]);
      if (process.platform === 'darwin') {
        console.log(dim('\nIf no Mac notification showed up: System Settings > Notifications > Script Editor > Allow.'));
      }
    } catch (e) {
      console.log(`Couldn't set up auto-start: ${e.message.split('\n')[0]}`);
      console.log('You can still run it by hand with: node watcher.mjs');
    }
  } else {
    console.log(`OK. Run it whenever you want with: node watcher.mjs   (then open ${url})`);
  }
} else {
  console.log(`Run it with: node watcher.mjs   (then open ${url})`);
}
console.log('');
rl.close();
