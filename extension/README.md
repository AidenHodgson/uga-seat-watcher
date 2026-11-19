# Seat Watcher for Chrome

Works on Athena's Register for Classes page, with the Seat Watcher app running on your computer.

- **Colors search results.** Green: open and fits your rules. Gray: open, but outside your rules (it says why). Amber: waitlist only, with your odds. Faded: full. Blue: yours. If a full section reopened, it says when.
- **Syncs your schedule.** It reads the Summary panel (Registered, Waitlisted, Deleted) and tells Seat Watcher, so Home always shows your real week.
- **Warns before a risky drop.** Choose Drop on a class with nothing replacing it in the same submit, and it tells you if people are waiting for your seat.
- **Fills CRNs.** The panel in the corner shows your next move and can put its CRN in the Enter CRNs box.

It never clicks Submit or Add, never sees your password, and only talks to Seat Watcher on your own computer.

## Install (2 minutes)

1. Make sure Seat Watcher is running (the dashboard opens at http://127.0.0.1:4830).
2. In Chrome, go to `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick the `extension` folder inside your `uga-seat-watcher` folder.
5. Open Athena's Register for Classes. The Seat Watcher panel shows up in the bottom right.

If you changed Seat Watcher's port, click the extension's icon and set it there.

Chrome may show a "developer mode extensions" notice now and then. That's normal for extensions loaded this way.
