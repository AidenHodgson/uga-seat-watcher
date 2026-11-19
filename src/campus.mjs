// Rough walking times between parts of UGA's Athens campus, for "tight walk" warnings between
// back-to-back classes. Buildings use Athena's names. This is approximate on purpose: zones, not
// coordinates. A building that isn't listed gets no warning rather than a guess.

const ZONES = {
  north: [
    'Park Hall', 'Peabody Hall', 'Candler Hall', 'Brooks Hall', 'Baldwin Hall', 'Moore College', 'Old College',
    'New College', 'Meigs Hall', 'Leconte Hall', 'Caldwell Hall', 'Law School', 'Dean Rusk Hall', 'Holmes/Hunter Acad',
    'Fine Arts', 'Jackson St Bldg', 'Denmark Hall', 'Founders House',
  ],
  central: [
    'Zell B Miller Learning Center', 'Journalism', 'Psychology', 'Sanford Hall', 'Inst Plaza', 'Dawson Hall', 'Barrow Hall',
    'Joe Brown', 'Gilbert Hall', 'Geography Geology', 'School of Social Work Building', 'Memorial Hall', 'Correll Hall',
    'BLC II Benson Hall', 'Moore-Rooker Hall', 'Amos Hall', 'Ivester',
  ],
  south: [
    'Science Learning Center', 'Boyd Research & Education CTR', 'Physics', 'Life Sci F.Davison', 'Driftmier Eng Ctr',
    'Miller Plant Sci', 'Conner Hall', 'Cedar Street Building A', 'Cedar Street Building B', 'Cedar Street Building C',
    'Cedar Street Building D', 'Forest Resources-1', 'Forest Resources-2', 'Forest Resources-4', 'Ecology',
    'Poultry Science Bldg.', 'Food Science', 'Coverdell Center', 'Robt C Wilson Phar', 'Pharmacy South', 'I-STEM 1',
    'I-STEM 2', 'Animal Dairy Sci -', 'Four Towers', 'Aderhold Hall', 'Enviro Health Sci',
  ],
  east: ['Ramsey Stu Ctr Pa', 'Music Building', 'Main Art Building', 'Performng Arts Ctr', 'Intramural Fields'],
  // Health Sciences Campus and the vet school: a bus ride from the main campus.
  hsc: ['Russell Hall Hsc'],
  vet: ['Vet Med - 1', 'Vet Med Tchng Hosp'],
};

const ZONE_OF = new Map(Object.entries(ZONES).flatMap(([z, list]) => list.map((b) => [b.toLowerCase(), z])));

// Minutes on foot (or bus, for hsc and vet), roughly.
const WALK = {
  'central-north': 8, 'north-south': 15, 'east-north': 20, 'central-south': 8, 'central-east': 12, 'east-south': 10,
};
const FAR = 25;

export const zoneOf = (building) => (building ? ZONE_OF.get(String(building).toLowerCase()) ?? null : null);

/** Rough minutes between two buildings, or null when either isn't known. */
export function walkMinutes(a, b) {
  const za = zoneOf(a);
  const zb = zoneOf(b);
  if (!za || !zb) return null;
  if (a === b) return 0;
  if (za === zb) return 5;
  if (['hsc', 'vet'].includes(za) || ['hsc', 'vet'].includes(zb)) return FAR;
  return WALK[[za, zb].sort().join('-')] ?? null;
}

const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(2));

/**
 * Back-to-back classes where the walk is about as long as the break (or longer). `picks` are
 * { course, meetings: [{ days, begin, end, building }] }. Returns
 * [{ day, from, to, gap, walk, level: 'tight' | 'too far' }].
 */
export function walkWarnings(picks) {
  const out = [];
  for (const day of 'MTWRF') {
    const today = picks
      .flatMap((p) => p.meetings.filter((m) => m.days.includes(day) && m.begin).map((m) => ({ ...m, course: p.course })))
      .sort((x, y) => x.begin.localeCompare(y.begin));
    for (let i = 1; i < today.length; i++) {
      const a = today[i - 1];
      const b = today[i];
      const gap = mins(b.begin) - mins(a.end);
      if (gap < 0 || gap > 30 || !a.building || !b.building || a.building === b.building) continue;
      const walk = walkMinutes(a.building, b.building);
      if (walk == null) continue;
      if (walk > gap) out.push({ day, from: a, to: b, gap, walk, level: 'too far' });
      else if (walk >= gap - 5) out.push({ day, from: a, to: b, gap, walk, level: 'tight' });
    }
  }
  return out;
}
