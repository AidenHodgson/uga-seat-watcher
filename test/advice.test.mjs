import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advise, waitlistOdds } from '../src/advice.mjs';
import { walkWarnings } from '../src/campus.mjs';
import { upcoming } from '../src/dates.mjs';
import { check } from '../src/rules.mjs';

// Sections shaped like toSection's. raw = seats Athena shows, wait = people waiting.
const S = (course, crn, days, begin, end, raw, wait = 0, building = null) => ({
  crn, course, meetings: [{ days, begin, end, building }], days, begin, end, online: false, remote: false,
  seats: wait > 0 ? 0 : raw, raw_seats: raw, waiting: wait, max: 40, instructor: null,
});
const rules = { earliest: '', latest: '', skip_days: 'F', preferred_days: '', avoid_times: [], allow_online: true };
const mark = (courses, config) =>
  courses.map((c) => ({ ...c, ok: true, sections: c.sections.map((s) => ({ ...s, ...check(s, config.courses.find((x) => x.course === c.course) ?? {}, config.rules) })) }));

// Nov 19, 2026, after the RMIN mixup: registered in BUSN and COMM, waitlisted for RMIN 73939.
const term = [
  { course: 'BUSN 4000', sections: [S('BUSN 4000', '35339', 'TR', '0815', '0935', 34, 8, 'Correll Hall')] },
  { course: 'COMM 1500', sections: [S('COMM 1500', '77095', 'TR', '0955', '1115', 29, 0, 'Park Hall')] },
  {
    course: 'RMIN 4000',
    sections: [
      S('RMIN 4000', '73939', 'MWF', '1315', '1410', 1, 4),
      S('RMIN 4000', '22779', 'TR', '1135', '1255', 17, 16),
      S('RMIN 4000', '73893', 'MW', '1135', '1255', 14, 13),
      S('RMIN 4000', '64146', 'WF', '0815', '0935', 26, 0),
    ],
  },
];

test('waitlist odds: more seats than people waiting is likely, not open', () => {
  const s = term[2].sections[1];
  assert.equal(s.seats, 0); // held for the waitlist
  assert.deepEqual(waitlistOdds(s), { position: 17, seats: 17, level: 'likely', text: "You'd be #17 for 17 open seats: likely" });
  assert.equal(waitlistOdds(term[2].sections[0]).level, 'maybe');
  assert.equal(waitlistOdds(term[2].sections[3]), null); // nobody waiting, no waitlist talk
});

test('waitlisted with a clearly better line: says to move the spot, with safe steps', () => {
  const config = {
    rules,
    courses: [
      { course: 'BUSN 4000', enabled: false, targets: [], registered: '35339', waitlisted: '' },
      { course: 'COMM 1500', enabled: false, targets: [], registered: '77095', waitlisted: '' },
      { course: 'RMIN 4000', enabled: true, targets: [], registered: '', waitlisted: '73939' },
    ],
  };
  const { week, moves } = advise(mark(term, config), config);
  assert.deepEqual(week.picks.map((p) => p.course), ['RMIN 4000', 'BUSN 4000', 'COMM 1500']);
  assert.equal(week.picks[0].waitlisted, true);
  const rmin = moves.find((m) => m.course === 'RMIN 4000');
  assert.equal(rmin.kind, 'switch-waitlist');
  assert.deepEqual(rmin.crns, ['22779']); // 73893 is just as likely; ties keep Athena's order
  assert.match(rmin.why, /one waitlist per course/);
  assert.match(rmin.steps.at(-1), /re-add 73939/);
  // 64146 is open, but meets Friday at 8:15, so it isn't offered as a register move.
  assert.ok(!moves.some((m) => m.crns.includes('64146')));
});

test('no seat yet and a section is truly open: register now', () => {
  const config = { rules: { ...rules, skip_days: '' }, courses: [{ course: 'RMIN 4000', enabled: true, targets: [], registered: '', waitlisted: '' }] };
  const { moves } = advise(mark([term[2]], config), config);
  assert.equal(moves[0].kind, 'register');
  assert.deepEqual(moves[0].crns, ['64146']);
});

test('registered with a better open section: one-submit swap, and never drop first when people wait', () => {
  const busn = { course: 'BUSN 4000', sections: [S('BUSN 4000', '35339', 'TR', '0815', '0935', 0, 3), S('BUSN 4000', '20743', 'MW', '1135', '1255', 5, 0)] };
  const config = { rules: { ...rules, earliest: '09:00' }, courses: [{ course: 'BUSN 4000', enabled: true, targets: [], registered: '35339', waitlisted: '' }] };
  const { moves } = advise(mark([busn], config), config);
  assert.equal(moves[0].kind, 'swap');
  assert.equal(moves[0].drop, '35339');
  assert.match(moves[0].steps.join(' '), /Click Submit once/);
  assert.match(moves[0].steps.at(-1), /Never drop 35339 on its own first/);
});

test('tight walks: east campus to north campus with 20 minutes to spare is tight', () => {
  const picks = [
    { course: 'MUSI 3550', meetings: [{ days: 'MW', begin: '0955', end: '1110', building: 'Music Building' }] },
    { course: 'ENGL 3000', meetings: [{ days: 'MW', begin: '1130', end: '1245', building: 'Park Hall' }] },
    { course: 'XXXX 3000', meetings: [{ days: 'TR', begin: '0955', end: '1110', building: 'Somewhere New' }] },
  ];
  const w = walkWarnings(picks);
  assert.equal(w.length, 2); // Monday and Wednesday; unknown buildings never warn
  assert.equal(w[0].level, 'tight');
  assert.equal(w[0].walk, 20);
  assert.equal(w[0].gap, 20);
});

test('key dates count down and drop off once past', () => {
  const d = upcoming('202702', '2027-01-09');
  assert.deepEqual(d.map((x) => [x.key, x.days_left]), [['drop_add_start', 2], ['drop_add_end', 6]]);
  assert.deepEqual(upcoming('209999'), []);
});

test('a 20 minute walk with a 15 minute break is too far', () => {
  const w = walkWarnings([
    { course: 'A', meetings: [{ days: 'T', begin: '0800', end: '0915', building: 'Ramsey Stu Ctr Pa' }] },
    { course: 'B', meetings: [{ days: 'T', begin: '0930', end: '1045', building: 'Peabody Hall' }] },
  ]);
  assert.equal(w[0].level, 'too far');
});
