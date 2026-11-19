// Registration dates that matter, per term. UGA publishes these on the registrar's calendar; add a
// term here when it's announced. Only terms listed here get a countdown.
//
// waitlist_purge: UGA clears every waitlist three days before drop/add. After that, an open seat goes
// to whoever grabs it first.

export const TERM_DATES = {
  202702: {
    name: 'Spring 2027',
    dates: [
      { key: 'waitlist_purge', date: '2027-01-08', label: 'Waitlists cleared', tip: 'After this, open seats are first come, first served.' },
      { key: 'drop_add_start', date: '2027-01-11', label: 'Drop/add starts', tip: 'Seats move fast this week. Keep your computer awake.' },
      { key: 'drop_add_end', date: '2027-01-15', label: 'Drop/add ends', tip: 'Last day to add or switch sections.' },
    ],
  },
};

/** Upcoming dates for a term with days left, soonest first. `today` is 'YYYY-MM-DD' (New York). */
export function upcoming(term, today = nyToday()) {
  const t = TERM_DATES[term];
  if (!t) return [];
  return t.dates
    .map((d) => ({ ...d, days_left: Math.round((Date.parse(d.date) - Date.parse(today)) / 86_400_000) }))
    .filter((d) => d.days_left >= 0);
}

export function nyToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
