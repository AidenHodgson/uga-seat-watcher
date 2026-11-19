// Builds a fake section the same shape athena.mjs returns, so tests never touch the network.
export function sec(crn, days, begin, end, seats = 5, extra = {}) {
  return {
    crn: String(crn),
    course: extra.course ?? 'TEST 1000',
    title: 'Test',
    credits: 3,
    meetings: begin ? [{ days, begin, end, building: null, room: null }] : [],
    days: begin ? days : '',
    begin,
    end,
    online: !begin,
    instructor: 'Pat Example',
    seats,
    raw_seats: seats,
    waiting: 0,
    max: 40,
    ...extra,
  };
}
