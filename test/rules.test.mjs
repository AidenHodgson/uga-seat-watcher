import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toSection } from '../src/athena.mjs';
import { backupNotice, check, clock, hhmm } from '../src/rules.mjs';
import { sec } from './helpers.mjs';

const rules = { earliest: '09:30', latest: '17:00', skip_days: 'F', allow_online: true, avoid_times: [] };

test('times', () => {
  assert.equal(clock('0815'), '8:15am');
  assert.equal(clock('1315'), '1:15pm');
  assert.equal(clock('1200'), '12:00pm');
  assert.equal(hhmm('9:30'), '0930');
  assert.equal(hhmm('17:00'), '1700');
  assert.equal(hhmm('25:00'), null);
});

test('a section fits, or says why not', () => {
  assert.deepEqual(check(sec(1, 'MW', '0955', '1110'), { course: 'X' }, rules), { fits: true, why: [] });
  assert.deepEqual(check(sec(2, 'TR', '0815', '0930'), { course: 'X' }, rules).why, ['starts 8:15am']);
  assert.deepEqual(check(sec(3, 'MWF', '1315', '1405'), { course: 'X' }, rules).why, ['meets Fri']);
  assert.deepEqual(check(sec(4, 'TR', '1635', '1755'), { course: 'X' }, rules).why, ['ends 5:55pm']);
});

test('online sections follow allow_online, and a course can override it', () => {
  assert.equal(check(sec(5, '', null, null), { course: 'X' }, rules).fits, true);
  assert.equal(check(sec(5, '', null, null), { course: 'X', allow_online: false }, rules).fits, false);
});

test('switch targets fit no matter the rules, and nothing else fits', () => {
  const c = { course: 'X', targets: ['22222'] };
  assert.equal(check(sec(22222, 'MWF', '0815', '0905'), c, rules).fits, true);
  assert.equal(check(sec(33333, 'MW', '1135', '1250'), c, rules).fits, false);
});

test('seats held for the waitlist do not count as open', () => {
  const raw = { courseReferenceNumber: 73893, subject: 'RMIN', courseNumber: '4000', seatsAvailable: 1, waitCount: 19, maximumEnrollment: 43, meetingsFaculty: [], faculty: [] };
  const s = toSection(raw);
  assert.equal(s.seats, 0);
  assert.equal(s.raw_seats, 1);
  assert.equal(s.waiting, 19);
  // More seats than people waiting still isn't open: Athena holds them all (22779, Nov 19: 17 open, 16 waiting).
  assert.equal(toSection({ ...raw, seatsAvailable: 17, waitCount: 16 }).seats, 0);
  assert.equal(toSection({ ...raw, seatsAvailable: 5, waitCount: 0 }).seats, 5);
});

test('backups: take one when nothing that fits is open, then once more when they run low', () => {
  const fit = (seats) => ({ ...sec(1, 'MW', '1135', '1250', seats), fits: true });
  const backup = (seats) => ({ ...sec(2, 'TR', '0815', '0930', seats), fits: false });
  // something that fits is open: nothing to say
  assert.equal(backupNotice('X', [], [fit(2), backup(30)]), null);
  // the last fitting seat goes: take a backup
  assert.equal(backupNotice('X', [fit(2), backup(30)], [fit(0), backup(28)]).kind, 'take');
  // still full, backup still roomy: quiet
  assert.equal(backupNotice('X', [fit(0), backup(28)], [fit(0), backup(20)]), null);
  // backup drops under 10: low, once
  assert.equal(backupNotice('X', [fit(0), backup(12)], [fit(0), backup(8)]).kind, 'low');
  assert.equal(backupNotice('X', [fit(0), backup(8)], [fit(0), backup(6)]), null);
  // all gone
  assert.equal(backupNotice('X', [fit(0), backup(1)], [fit(0), backup(0)]).kind, 'none');
});
