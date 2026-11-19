# UGA Seat Watcher: notes for coding agents

You're helping a student run or change Seat Watcher, a small local app that watches UGA's Athena
class search for open seats and builds possible schedules. The person you're helping is probably a
student, not a developer. Explain what you're doing in plain words, keep changes small, and test
before you say something works.

## What it is

- Plain Node.js (18 or newer), **no dependencies** and no build step. Keep it that way: friends
  install it by unzipping a folder. Don't add packages unless there's truly no other way, and ask
  first.
- One process does everything: checks Athena every few minutes, keeps a little state, sends alerts,
  and serves a dashboard on `http://127.0.0.1:4830` (only this computer can open it).
- Setup happens in that dashboard the first time (no `config.json` yet). Settings are saved to
  `config.json` in this folder and re-read on every check.
- It never logs in to Athena and never registers anyone for anything. That's a hard line; see
  "Don'ts" below.

## Files

| File | What it does |
|---|---|
| `watcher.mjs` | Entry point and command line (`--open`, `--once`, `find`, `--test`, `--install`, `--uninstall`). Starts the dashboard and the check loop, and hands off to the background service after setup. |
| `src/athena.mjs` | Talks to Athena's public Browse Classes search. Turns Athena's JSON into our section shape (`toSection`). |
| `src/rules.mjs` | Does a section fit the person's rules (`check`, returns `{ fits, why }`), time formatting, and backup alerts (`backupNotice`). |
| `src/schedule.mjs` | Builds clash-free weekly schedules from open sections and ranks them (`buildSchedules`, `score`). |
| `src/core.mjs` | One check: fetch every course, mark fits, compare with the last check, alert. Holds the live `status` the dashboard reads. |
| `src/server.mjs` | The dashboard's HTTP server and JSON API (`/api/state`, `/api/schedules`, `/api/config`, `/api/setup`, `/api/course`, `/api/terms`, `/api/check`, `/api/test-alert`). |
| `src/notify.mjs` | Alerts: Windows toast (PowerShell), Mac notification (osascript), Linux notify-send, ntfy, Discord webhook. |
| `src/service.mjs` | Start at login: Windows Task Scheduler task "UGA Seat Watcher" (runs `scripts/run-windows.ps1`), Mac launchd agent `com.ugaseatwatcher.agent`. |
| `src/config.mjs` | Defaults, `validate` (every saved config goes through it), load and save. |
| `src/paths.mjs` | Where the log and state live (`%LOCALAPPDATA%\uga-seat-watcher` or `~/Library/Application Support/uga-seat-watcher`), plus `log`. |
| `web/index.html` | The whole dashboard and setup wizard: one file, vanilla JS, no framework. |
| `test/` | Offline tests (`npm test`). They never touch the network. |

## The section shape

Everything downstream uses what `toSection` returns:

```js
{ crn: '73893', course: 'RMIN 4000', title, credits,
  meetings: [{ days: 'MW', begin: '1135', end: '1250', building, room }],
  days, begin, end,          // first meeting, for quick display
  online,                    // no set time, or Athena says online
  instructor,
  seats,                     // REAL open seats: 0 while anyone is waiting, else seatsAvailable
  raw_seats, waiting, max }
```

Days use Banner letters: M T W R(Thursday) F S U. Times are `'HHMM'` strings, compared as strings.

## Things that will bite you (all learned the hard way)

1. **Seats held for the waitlist aren't open.** While anyone is on a section's waitlist, Athena
   holds every open seat for the waitlist, even with more seats than people waiting:
   `seatsAvailable: 17` with `waitCount: 16` still says "Seat(s) Reserved for Waitlist" to a new
   student. `seats` is 0 whenever `waiting > 0`; keep it that way everywhere. (The first version
   subtracted `waiting` instead, and that was wrong.)
2. **Every Athena request needs a fresh connection.** Athena's load balancer ties a search session to
   the TCP connection. Node's `fetch` reuses pooled connections, so a session started on one could
   be searched on another and come back with zero sections, silently. `athena.mjs` uses
   `https.request` with `keepAlive: false` for this reason. Don't switch it back to `fetch`.
3. **One Athena session per check.** `start()` picks the term (POST `term/search?mode=search`), then
   each course does `resetDataForm` and `searchResults`. Searching without picking a term first
   returns nothing.
4. **Athena blocks Cloudflare's network** (every request returned 520 from a Worker). Don't suggest
   moving the checking to Cloudflare Workers. A regular server (Railway, a home server, a laptop) works.
5. **Mac background apps can't read Desktop, Documents or Downloads** without extra permission, so
   the launchd agent fails quietly from there. The folder belongs in the home folder. Setup warns.
6. **Port 4830, not 4823.** 4823 is used by another watcher on the original author's laptop. The
   launcher checks what's answering on the port and says so instead of opening the wrong thing.
7. **Windows install:** the task runs `conhost.exe --headless powershell.exe -File
   scripts\run-windows.ps1 -Node <node> -Script <watcher.mjs>`, which restarts node 30 seconds after
   it exits. `--uninstall` also kills node processes whose command line has this folder's
   `watcher.mjs`.
8. **First sightings never alert.** A section's first appearance is the baseline. Alerts fire only
   when a section that fits goes from 0 to more than 0 real seats, plus the backup notices
   ("take a backup", "running low", "completely full").
9. **In the dashboard, never return `false` from an `onkeydown` handler** for keys you don't handle.
   That cancels typing. (It shipped once.)

## Commands

```
npm test                          offline tests, run these after any change to src/
node watcher.mjs --open           start, open the dashboard (setup first time)
node watcher.mjs --once           one check, printed, no alerts
node watcher.mjs find BUSN 4000   every section of a course
node watcher.mjs --test           send a test alert
node watcher.mjs --install        start at login (Windows or Mac)
node watcher.mjs --uninstall      stop starting at login, and stop it now
```

To try changes without touching the person's real setup, copy the folder somewhere else, delete
`config.json` in the copy, and change `port` after setup (or stop the real one first with
`--uninstall`). Two copies watching the same courses send every alert twice.

## Common changes and where they go

- **New alert channel** (Telegram, email, SMS): add a function in `src/notify.mjs` next to `ntfy`
  and `discord`, call it from `notify()` when its setting is filled in, add the field to
  `DEFAULTS.alerts` and `validate` in `src/config.mjs`, and add an input to the Alerts card in
  `web/index.html` (setup step 4 and the Settings tab). Never log tokens or webhook links.
- **New rule** (for example "no classes back to back"): add it to `check()` in `src/rules.mjs` with a
  plain-words reason in `why`, add the setting to `DEFAULTS.rules` and `validate`, add it to the
  setup step and Settings tab, and add a test in `test/rules.test.mjs`.
- **Different schedule ranking:** change `score()` in `src/schedule.mjs`. `describe()` gives you
  days on campus, earliest start, latest end, gap minutes, classes off preferred days, early and
  late days, and nearly-full sections. Add a test in `test/schedule.test.mjs`.
- **Another Banner 9 school:** change `school.athena` (the `.../StudentRegistrationSsb/ssb` base)
  and `school.register_url` in `config.json`. Untested outside UGA; check with
  `node watcher.mjs find SUBJ 1234` first.
- **Dashboard look:** colors are CSS variables at the top of `web/index.html`. Bright rows are open,
  faded rows (`.row.full`) are full; only full sections should be faded.

## Don'ts

- **Don't auto-register, and don't handle UGA passwords or Duo.** Alerts only. Registering for
  people means holding their credentials, and that's where this goes from a helpful tool to a
  problem.
- **Don't scrape Rate My Professors.** It has no public API, and its terms don't allow automated
  access. The dashboard links each instructor to an RMP search page; keep it a link.
- **Don't check more often than every 2 minutes** (`validate` enforces it), and don't run many
  courses per person. If lots of students hammer Athena, UGA will block it for everyone.
- **Don't add dependencies or a build step** unless the person asks and understands the tradeoff.
- **Don't commit `config.json`.** It holds the person's ntfy topic and Discord webhook, which work
  like passwords. It's in `.gitignore`.
