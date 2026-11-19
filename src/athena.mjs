// Talks to Athena's public "Browse Classes" search. No login, no Duo: this is the same search
// anyone can do from the registration site without signing in. Athena runs on Ellucian Banner 9,
// so other Banner schools should work with a different base URL (untested).
//
// Every request opens a fresh connection (no keep-alive). Athena's load balancer ties a search
// session to the connection, and Node's fetch reuses pooled connections, so a session started on
// one connection could be asked about on another and come back empty.

import https from 'node:https';

const agent = new https.Agent({ keepAlive: false });

function request(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers: { ...headers, ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) }, agent, timeout: 30_000 }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          cookies: [].concat(res.headers['set-cookie'] ?? []),
          text: data,
          json() {
            return JSON.parse(data);
          },
        }),
      );
    });
    req.on('timeout', () => req.destroy(new Error('Athena timed out')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const DAY_KEYS = [
  ['monday', 'M'],
  ['tuesday', 'T'],
  ['wednesday', 'W'],
  ['thursday', 'R'],
  ['friday', 'F'],
  ['saturday', 'S'],
  ['sunday', 'U'],
];

export class Athena {
  constructor(base, term) {
    this.base = base.replace(/\/+$/, '');
    this.term = term;
    this.jar = {};
  }

  async req(url, init = {}) {
    const res = await request(url, {
      ...init,
      headers: {
        'User-Agent': 'Mozilla/5.0 (seat watcher; one student, a few requests every few minutes)',
        Accept: 'application/json, text/plain, */*',
        Cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; '),
        ...(init.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
    });
    for (const c of res.cookies) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (i > 0) this.jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
    }
    return res;
  }

  /** Terms Athena offers, newest first: [{ code: '202702', description: 'Spring 2027' }]. */
  static async terms(base) {
    const r = await request(`${base.replace(/\/+$/, '')}/classSearch/getTerms?searchTerm=&offset=1&max=12`, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`Athena would not list terms (HTTP ${r.status})`);
    return r.json();
  }

  async start() {
    const r = await this.req(`${this.base}/term/search?mode=search`, { method: 'POST', body: `term=${encodeURIComponent(this.term)}` });
    if (!r.ok) throw new Error(`Athena would not open term ${this.term} (HTTP ${r.status})`);
  }

  /** Every section of one course, e.g. ('BUSN', '4000'). Exact number only, so 4000 skips 4000H. */
  async course(subject, number) {
    await this.req(`${this.base}/classSearch/resetDataForm`, { method: 'POST' });
    const rows = [];
    for (let offset = 0; ; ) {
      const q = new URLSearchParams({
        txt_subject: subject,
        txt_courseNumber: number,
        txt_term: this.term,
        pageOffset: String(offset),
        pageMaxSize: '100',
        sortColumn: 'subjectDescription',
        sortDirection: 'asc',
      });
      const r = await this.req(`${this.base}/searchResults/searchResults?${q}`);
      if (!r.ok) throw new Error(`Athena search failed (HTTP ${r.status})`);
      const d = r.json();
      const page = d.data ?? [];
      rows.push(...page);
      offset += page.length;
      if (!page.length || offset >= (d.totalCount ?? 0)) break;
    }
    return rows.filter((c) => `${c.subject} ${c.courseNumber}` === `${subject} ${number}`).map(toSection);
  }
}

export function toSection(c) {
  const meetings = (c.meetingsFaculty ?? []).map((m) => m.meetingTime ?? {}).filter((m) => m.beginTime);
  const daysOf = (m) => DAY_KEYS.filter(([k]) => m[k]).map(([, l]) => l).join('');
  const where = [c.instructionalMethod, c.instructionalMethodDescription, c.campusDescription, ...(c.meetingsFaculty ?? []).map((m) => m.meetingTime?.buildingDescription)]
    .filter(Boolean)
    .join(' ');
  const rawSeats = Number(c.seatsAvailable) || 0;
  const waiting = Number(c.waitCount) || 0;
  const m0 = meetings[0];
  return {
    crn: String(c.courseReferenceNumber),
    course: `${c.subject} ${c.courseNumber}`,
    title: c.courseTitle ?? '',
    credits: c.creditHourLow ?? c.creditHours ?? null,
    meetings: meetings.map((m) => ({
      days: daysOf(m),
      begin: m.beginTime,
      end: m.endTime ?? m.beginTime,
      building: m.buildingDescription ?? null,
      room: m.room ?? null,
    })),
    days: m0 ? daysOf(m0) : '',
    begin: m0?.beginTime ?? null,
    end: m0?.endTime ?? null,
    online: !m0 || /online|web|virtual|distance|ecore/i.test(where),
    instructor: (c.faculty ?? []).map((f) => f.displayName).filter(Boolean).join(', ') || null,
    // Athena gives an open seat to the waitlist first, so a seat is only really open to a new
    // student when more seats are open than students waiting.
    seats: Math.max(0, rawSeats - waiting),
    raw_seats: rawSeats,
    waiting,
    max: Number(c.maximumEnrollment) || 0,
  };
}
