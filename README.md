# UGA Seat Watcher

Tells you when a seat opens in a UGA class that fits your schedule, and builds possible weekly
schedules out of what's open right now.

- **No UGA login, no Duo.** It reads Athena's public "Browse Classes" search, the same one anyone can
  use without signing in.
- **Only real seats count.** Athena hands an open seat to the waitlist first, so a seat counts as
  open only when more seats are open than people waiting. (We learned this the hard way on
  registration night.)
- **Your rules.** Earliest start, latest end, days to skip, days you prefer, online or not.
- **Backups.** A seat you don't love beats no seat. If everything that fits is full, it tells you
  which sections still have room.
- **Switch mode.** Already registered? Star the sections you'd rather have and it only alerts for those.
- **Schedules.** Every combination of open sections with no time clashes, ranked by fewest days on
  campus, no early mornings, no late classes and no long gaps. One click copies the CRNs.
- **Alerts** on your Windows or Mac desktop, and on your phone through the free ntfy app or Discord.
- **Rate My Professors** link on every instructor's name.

It never registers you for anything. It just tells you, and you register in Athena.

## Setup (about 3 minutes)

1. **Install Node.js** (free) from https://nodejs.org, the LTS version. Skip this if you have it.
2. **Get this folder** onto your computer and unzip it.
   - **Mac:** put it in your home folder, not Desktop, Documents or Downloads. macOS blocks
     background apps from reading those, so it would stop working after a restart.
3. **Double-click the launcher:**
   - **Windows:** `Start Here (Windows).cmd`. If Windows warns you, click "More info" then "Run anyway".
   - **Mac:** right-click `Start Here (Mac).command`, choose Open, then Open again.
4. **Setup opens in your browser.** Pick the term, add your courses, set your rules and turn on phone
   alerts if you want them. Leave "run in the background" checked.

That's it. The dashboard lives at **http://127.0.0.1:4823**. Bookmark it, or double-click the
launcher again any time to open it. On Windows it's also in the Start menu as "Seat Watcher".

## The dashboard

- **Seats:** every section of your courses. Bright means seats are open, faded means full. A green
  edge means it fits your rules; an amber edge says why it doesn't ("meets Fri", "starts 8:15am").
  Click a CRN to copy it, click an instructor for Rate My Professors, star (☆) a section to switch
  that course to "only tell me about these."
- **Schedules:** possible weeks built from open seats. Uncheck "only sections that fit my rules" to
  see weeks that use backups.
- **Settings:** change anything from setup. Saved changes apply right away. To start setup over,
  delete `config.json` and run the launcher again.

## Phone alerts

Setup can make you an ntfy topic. Install **ntfy** (App Store or Google Play), tap +, and subscribe
to that exact topic. Treat the topic like a password: anyone who knows it can see your alerts.
For Discord, make a webhook in a channel (Server Settings > Integrations > Webhooks) and paste the link
into Settings.

## How it runs

It checks every 3 minutes while your computer is on and you're logged in. Sleep or a closed lid
pauses it; it picks back up on wake. It starts by itself after a restart, as soon as you log in.

- Windows: a Task Scheduler task called "UGA Seat Watcher" (your user only, no admin).
- Mac: a launch agent, `~/Library/LaunchAgents/com.ugaseatwatcher.agent.plist`.

If Mac notifications don't show up: System Settings > Notifications > Script Editor > Allow.

Log file: `%LOCALAPPDATA%\uga-seat-watcher\watcher.log` on Windows,
`~/Library/Application Support/uga-seat-watcher/watcher.log` on a Mac.

## When it matters most

Seats open all through registration as people drop and swap. The big window is right before
drop/add: UGA closes waitlists 3 days before drop/add starts, and after that an open seat goes to
whoever grabs it first. Keep your computer awake that week.

## Commands

Run these from this folder.

| Command | What it does |
|---|---|
| `node watcher.mjs --open` | Start it and open the dashboard (what the launcher does) |
| `node watcher.mjs --once` | One check, printed |
| `node watcher.mjs find BUSN 4000` | Every section of a course |
| `node watcher.mjs --test` | Send a test alert |
| `node watcher.mjs --install` | Start automatically at login |
| `node watcher.mjs --uninstall` | Stop starting automatically |

## Be nice to Athena

One search per course every few minutes is nothing. Please don't set it below 2 minutes, and don't
run several copies. If a lot of people hammer Athena, UGA will block it for everyone.

## Other schools

Athena runs on Ellucian Banner 9, which many universities use. Changing `school.athena` and
`school.register_url` in `config.json` should work for other Banner schools, but that's untested.

## License

MIT. Use it, change it, share it.
