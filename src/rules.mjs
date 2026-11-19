// Which sections fit someone's rules, and how to describe sections and times.

export const DAY_NAMES = { M: 'Mon', T: 'Tue', W: 'Wed', R: 'Thu', F: 'Fri', S: 'Sat', U: 'Sun' };

/** '0955' to '9:55am'. */
export function clock(t) {
  if (!t) return 'online';
  const h = Number(t.slice(0, 2));
  return `${h % 12 || 12}:${t.slice(2)}${h < 12 ? 'am' : 'pm'}`;
}

/** '9:30', '09:30', '930' or '0930' to '0930'. Empty or bad gives null. */
export function hhmm(v) {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(String(v ?? '').trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return m[1].padStart(2, '0') + m[2];
}

export function label(s) {
  if (s.online || !s.begin) return 'Online';
  return s.meetings.map((m) => `${m.days} ${clock(m.begin)}`).join(' + ');
}

function hitsWindow(section, spec) {
  const m = /^(?:([MTWRFSU]+)\s+)?(\d{1,2}):?(\d{2})\s*-\s*(\d{1,2}):?(\d{2})$/.exec(String(spec).trim().toUpperCase());
  if (!m) return false;
  const [, days, h1, m1, h2, m2] = m;
  const from = h1.padStart(2, '0') + m1;
  const to = h2.padStart(2, '0') + m2;
  return section.meetings.some((mt) => (!days || [...mt.days].some((d) => days.includes(d))) && mt.begin < to && mt.end > from);
}

/**
 * Does a section fit? Returns { fits, why } where `why` lists what's wrong in plain words
 * ("meets Friday", "starts 8:15am"). A course with target CRNs (one you're already registered for
 * and want to switch out of) fits only those CRNs, whatever the other rules say.
 */
export function check(section, course, rules) {
  if (course.targets?.length) {
    return course.targets.includes(section.crn) ? { fits: true, why: [] } : { fits: false, why: ['not one of your switch targets'] };
  }
  const why = [];
  if (section.online || !section.begin) {
    const ok = (course.allow_online ?? rules.allow_online) !== false;
    return ok ? { fits: true, why } : { fits: false, why: ['online'] };
  }
  const skip = course.skip_days ?? rules.skip_days ?? '';
  const badDays = [...new Set(section.meetings.flatMap((m) => [...m.days]).filter((d) => skip.includes(d)))];
  if (badDays.length) why.push(`meets ${badDays.map((d) => DAY_NAMES[d]).join(', ')}`);
  const earliest = hhmm(rules.earliest);
  const first = section.meetings.reduce((a, m) => (m.begin < a ? m.begin : a), '2400');
  if (earliest && first < earliest) why.push(`starts ${clock(first)}`);
  const latest = hhmm(rules.latest);
  const last = section.meetings.reduce((a, m) => (m.end > a ? m.end : a), '0000');
  if (latest && last > latest) why.push(`ends ${clock(last)}`);
  for (const w of [...(rules.avoid_times ?? []), ...(course.avoid_times ?? [])]) {
    if (hitsWindow(section, w)) why.push(`overlaps ${w}`);
  }
  return { fits: why.length === 0, why };
}

// He'd rather have an 8am than no seat. When nothing that fits is open, sections that don't fit
// but have seats are backups: one "take a backup" alert when a course gets there, another when the
// best backup drops under LOW_BACKUP seats, and "completely full" when nothing is open at all.
export const LOW_BACKUP = 10;

export function backupNotice(course, before, now) {
  if (now.some((s) => s.fits && s.seats > 0)) return null;
  const backups = now.filter((s) => !s.fits && s.seats > 0).sort((a, b) => b.seats - a.seats);
  const hadFitOpen = before.some((s) => s.fits && s.seats > 0);
  const bestBefore = Math.max(0, ...before.filter((s) => !s.fits).map((s) => s.seats));
  const fresh = !before.length || hadFitOpen;
  if (!backups.length) return fresh || bestBefore > 0 ? { course, kind: 'none', backups: [] } : null;
  if (fresh) return { course, kind: 'take', backups };
  if (bestBefore >= LOW_BACKUP && backups[0].seats < LOW_BACKUP) return { course, kind: 'low', backups };
  return null;
}
