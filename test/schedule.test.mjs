import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSchedules } from '../src/schedule.mjs';
import { sec } from './helpers.mjs';

const rules = { preferred_days: 'MW' };
const fit = (s) => ({ ...s, fits: true });

test('finds clash-free weeks and ranks fewer days first', () => {
  const courses = [
    { course: 'AAAA 1000', sections: [fit(sec(1, 'MW', '0955', '1110', 5, { course: 'AAAA 1000' })), fit(sec(2, 'TR', '0955', '1110', 5, { course: 'AAAA 1000' }))] },
    { course: 'BBBB 1000', sections: [fit(sec(3, 'MW', '0955', '1110', 5, { course: 'BBBB 1000' })), fit(sec(4, 'MW', '1135', '1250', 5, { course: 'BBBB 1000' }))] },
  ];
  const r = buildSchedules(courses, rules);
  assert.equal(r.complete, true);
  const best = r.schedules[0];
  assert.deepEqual(best.facts.days, ['M', 'W']);
  assert.deepEqual(best.picks.map((p) => p.sections[0].crn).sort(), ['1', '4']);
  // never puts two classes at the same time
  for (const s of r.schedules) {
    const times = s.picks.flatMap((p) => p.meetings.flatMap((m) => [...m.days].map((d) => `${d}${m.begin}`)));
    assert.equal(new Set(times).size, times.length);
  }
});

test('sections at the same time are one slot with alternates', () => {
  const courses = [{ course: 'COMM 1500', sections: [fit(sec(10, 'TR', '0955', '1110', 3)), fit(sec(11, 'TR', '0955', '1110', 20)), fit(sec(12, 'TR', '0955', '1110', 0))] }];
  const r = buildSchedules(courses, rules);
  assert.equal(r.schedules.length, 1);
  assert.deepEqual(r.schedules[0].picks[0].sections.map((s) => s.crn), ['11', '10']); // most seats first, full one left out
});

test('when nothing fits a course, says so and still builds the rest', () => {
  const courses = [
    { course: 'AAAA 1000', sections: [fit(sec(1, 'MW', '0955', '1110'))] },
    { course: 'BBBB 1000', sections: [{ ...sec(2, 'MW', '1135', '1250', 0), fits: true }] },
  ];
  const r = buildSchedules(courses, rules);
  assert.equal(r.complete, false);
  assert.deepEqual(r.noSeats, ['BBBB 1000']);
  assert.deepEqual(r.missing, ['BBBB 1000']);
  assert.equal(r.schedules[0].picks.length, 1);
});

test('strict mode leaves out sections outside the rules; loose mode uses them', () => {
  const courses = [{ course: 'AAAA 1000', sections: [{ ...sec(1, 'MWF', '0815', '0905'), fits: false }] }];
  assert.equal(buildSchedules(courses, rules, { strict: true }).schedules.length, 0);
  assert.equal(buildSchedules(courses, rules, { strict: false }).schedules.length, 1);
});
