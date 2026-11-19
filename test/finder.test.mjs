import { test } from 'node:test';
import assert from 'node:assert/strict';
import { find } from '../src/finder.mjs';

const sec = (course, crn, o = {}) => {
  const [subject, number] = course.split(' ');
  const meetings = o.days ? [{ days: o.days, begin: o.begin, end: o.end, building: null }] : [];
  return {
    crn, course, subject, number, title: o.title ?? 'Something', credits: o.credits ?? 3, meetings,
    days: o.days ?? '', begin: o.begin ?? null, end: o.end ?? null, online: !o.days, remote: !!o.remote,
    campus: o.remote ? 'Online' : 'Athens', seats: o.seats ?? 5, raw_seats: o.seats ?? 5, waiting: o.waiting ?? 0, max: 40,
  };
};

const term = {
  at: '2026-11-19T19:00:00Z',
  sections: [
    sec('ALDR 4600E', '68320', { remote: true, title: 'The Global Seminar', seats: 4 }),
    sec('FINA 4200', '11111', { days: 'MW', begin: '1135', end: '1250', title: 'Financial Modeling', seats: 9 }),
    sec('PSYC 4200', '22222', { days: 'MW', begin: '1135', end: '1250', title: 'Social Psychology', seats: 30 }),
    sec('PSYC 4210', '22223', { days: 'TR', begin: '0815', end: '0930', seats: 12 }),
    sec('ENGL 1101', '33333', { days: 'TR', begin: '1135', end: '1250', seats: 40 }),
    sec('HIST 4000', '44444', { days: 'F', begin: '1000', end: '1250', seats: 3 }),
    sec('ANTH 3000', '55555', { days: 'TR', begin: '1300', end: '1415', seats: 0, waiting: 0 }),
    sec('HIPR 4000', '66666', { seats: 25 }), // no set time, not online: time TBA
  ],
};

test('upper-level, open, three credits, no FINA', () => {
  const r = find(term, { min: 3000, max: 5999, credits: 3, open: true, exclude: ['FINA'] }, {});
  assert.deepEqual(r.courses.map((c) => c.course), ['PSYC 4200', 'HIPR 4000', 'PSYC 4210', 'ALDR 4600E', 'HIST 4000']);
});

test('online only means Athena says online, not just "no time listed"', () => {
  const r = find(term, { format: 'online' }, {});
  assert.deepEqual(r.courses.map((c) => c.course), ['ALDR 4600E']);
});

test('in person, Monday to Thursday, after 9:30, around your week', () => {
  const around = [{ meetings: [{ days: 'MW', begin: '1135', end: '1250' }] }];
  const r = find(term, { format: 'in_person', days: 'MTWR', after: '0930', around, min: 3000, open: true }, {});
  assert.deepEqual(r.courses.map((c) => c.course), []); // PSYC 4200 clashes, 4210 is early, HIST is Friday, ANTH full
  const loose = find(term, { format: 'in_person', days: 'MTWR', after: '0930', min: 3000, open: false }, {});
  assert.deepEqual(loose.courses.map((c) => c.course).sort(), ['ANTH 3000', 'FINA 4200', 'PSYC 4200']);
});

test('title words', () => {
  assert.deepEqual(find(term, { text: 'global seminar' }, {}).courses.map((c) => c.course), ['ALDR 4600E']);
});
