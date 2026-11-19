#!/usr/bin/env node
// Seat Watcher as an MCP server, so Claude (Desktop or Claude Code) can see your week, your next
// moves and what's open, and find classes. No dependencies: MCP over stdio is newline-delimited
// JSON-RPC, handled by hand below.
//
// It talks to the Seat Watcher already running on this computer (http://127.0.0.1:<port>), so
// there's only ever one thing checking Athena. It never registers anyone for anything.
//
// Claude Code:    claude mcp add uga-seat-watcher -- node /full/path/to/uga-seat-watcher/mcp.mjs
// Claude Desktop: Settings > Developer > Edit Config, then add under "mcpServers":
//                 "uga-seat-watcher": { "command": "node", "args": ["/full/path/to/uga-seat-watcher/mcp.mjs"] }

import readline from 'node:readline';
import { loadConfig } from './src/config.mjs';

const VERSION = '1.0.0';
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const port = () => loadConfig().port;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, init) {
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${port()}${path}`, init);
  } catch {
    throw new Error(`Seat Watcher isn't running on this computer (nothing at http://127.0.0.1:${port()}). Start it with the "Start Here" launcher, then try again.`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 202) throw new Error(body.error || `Seat Watcher answered HTTP ${res.status}`);
  return { status: res.status, body };
}

const post = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Keep what Claude needs and drop the rest, so answers stay small.
const slimSection = (s) => ({
  crn: s.crn,
  when: s.remote ? 'online' : s.begin ? s.meetings.map((m) => `${m.days} ${m.begin}-${m.end}`).join(' + ') : 'time TBA',
  building: s.remote ? undefined : s.meetings?.[0]?.building ?? undefined,
  instructor: s.instructor ?? undefined,
  open_seats: s.seats,
  seats_shown_in_athena: s.raw_seats !== s.seats ? s.raw_seats : undefined,
  waiting: s.waiting || undefined,
  fits_rules: s.fits,
  why_not: s.fits || !s.why?.length ? undefined : s.why,
  waitlist_odds: s.odds?.text,
  yours: s.yours ?? undefined,
  reopened_at: s.reopened_at ?? undefined,
});

const RULES = [
  'Athena holds every open seat for the waitlist while anyone is on it, so open_seats is 0 whenever people are waiting (seats_shown_in_athena is what Athena displays).',
  'A student can be on one waitlist per course, and not while registered in another section of that course.',
  'To switch sections: add the new CRN and drop the old one in the same submit. Never tell someone to drop first when the old section has people waiting.',
  'When a waitlist seat opens, UGA emails the student; they have about 18 hours to register.',
  'This tool never registers anyone. The student clicks Submit in Athena themselves.',
].join(' ');

const TOOLS = [
  {
    name: 'my_week',
    description: `The student's current week (sections they're registered in or waitlisted for), tight walks between classes, next moves with exact Athena steps, and key registration dates. Start here. ${RULES}`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => {
      const { body: w } = await api('/api/week');
      return {
        week: w.week.picks.map((p) => ({ course: p.course, crn: p.sections[0].crn, waitlisted: !!p.waitlisted, when: p.meetings.map((m) => `${m.days} ${m.begin}-${m.end} ${m.building ?? ''}`.trim()) })),
        online: w.week.online.map((p) => ({ course: p.course, crn: p.sections[0].crn })),
        summary: w.week.summary,
        tight_walks: w.week.walks.map((x) => `${x.day}: ${x.from.course} (${x.from.building}) to ${x.to.course} (${x.to.building}), about ${x.walk} min walk, ${x.gap} min between: ${x.level}`),
        notes: w.week.notes,
        next_moves: w.moves.map((m) => ({ course: m.course, kind: m.kind, title: m.title, why: m.why, steps: m.steps, crns: m.crns })),
        dates: w.dates.map((d) => `${d.label}: ${d.date} (${d.days_left} days). ${d.tip}`),
        last_checked: w.last_check_at,
      };
    },
  },
  {
    name: 'course_sections',
    description: `Every section of one course this term with open seats, waitlist odds, whether it fits the student's rules, and when a full section reopened. ${RULES}`,
    inputSchema: {
      type: 'object',
      properties: { course: { type: 'string', description: 'Like "RMIN 4000" or "FHCE 3200E"' } },
      required: ['course'],
      additionalProperties: false,
    },
    run: async ({ course }) => {
      const { body } = await api(`/api/lookup?course=${encodeURIComponent(course)}`);
      return { course: body.course, watched: body.watched, sections: body.sections.map(slimSection) };
    },
  },
  {
    name: 'find_classes',
    description:
      'Search every section this term (the whole catalog) for classes the student can take: by level, credits, online or in person, open now, days, times, subjects, title words, and fitting around their current week. Use for electives ("any open online upper-level class"). The first search of the day downloads the term and can take about a minute. Remind the student to check prerequisites in the UGA Bulletin.',
    inputSchema: {
      type: 'object',
      properties: {
        min_level: { type: 'integer', description: 'Lowest course number, e.g. 3000 for upper level' },
        max_level: { type: 'integer', description: 'Highest course number. Defaults to 5999 (undergraduate).' },
        credits: { type: 'integer', description: 'Exact credit hours, e.g. 3' },
        format: { type: 'string', enum: ['any', 'online', 'in_person'] },
        open_only: { type: 'boolean', description: 'Only sections with a seat and nobody waiting. Default true.' },
        days: { type: 'string', description: 'Allowed day letters, M T W R(Thursday) F, e.g. "MTWR"' },
        start_after: { type: 'string', description: 'HHMM, e.g. "0930"' },
        end_before: { type: 'string', description: 'HHMM, e.g. "1700"' },
        exclude_subjects: { type: 'array', items: { type: 'string' }, description: 'Prefixes to leave out, e.g. ["FINA"]' },
        only_subjects: { type: 'array', items: { type: 'string' } },
        title_has: { type: 'string' },
        fits_my_week: { type: 'boolean', description: "No clash with the student's current week. Default true." },
        fits_my_rules: { type: 'boolean', description: "Must fit the student's rules (no 8ams etc). Default false." },
        limit: { type: 'integer', description: 'Courses to return, default 25, max 100' },
      },
      additionalProperties: false,
    },
    run: async (a) => {
      const q = new URLSearchParams({
        min: a.min_level ?? '',
        max: a.max_level ?? 5999,
        credits: a.credits ?? '',
        format: a.format ?? 'any',
        open: a.open_only === false ? '0' : '1',
        days: a.days ?? '',
        after: a.start_after ?? '',
        before: a.end_before ?? '',
        exclude: (a.exclude_subjects ?? []).join(','),
        subjects: (a.only_subjects ?? []).join(','),
        text: a.title_has ?? '',
        around_week: a.fits_my_week === false ? '0' : '1',
        fits_rules: a.fits_my_rules ? '1' : '0',
        limit: String(Math.min(100, a.limit ?? 25)),
      });
      for (let i = 0; i < 45; i++) {
        const { status, body } = await api(`/api/finder?${q}`);
        if (status !== 202) {
          return {
            class_list_from: body.at,
            matching_sections: body.total,
            courses: body.courses.map((c) => ({ course: c.course, title: c.title, credits: c.credits, sections: c.sections.slice(0, 5).map(slimSection), more_sections: Math.max(0, c.sections.length - 5) })),
          };
        }
        await sleep(3000);
      }
      throw new Error('Still downloading the class list from Athena. Try again in a minute.');
    },
  },
  {
    name: 'possible_schedules',
    description: "Whole weeks built from open sections plus the sections the student already holds, ranked by fewest days on campus, no early or late classes, and short gaps. 'changes' is how many classes differ from their current week.",
    inputSchema: {
      type: 'object',
      properties: { strict: { type: 'boolean', description: "Only sections that fit the student's rules. Default true." } },
      additionalProperties: false,
    },
    run: async ({ strict = true } = {}) => {
      const { body } = await api(`/api/schedules?strict=${strict ? 1 : 0}`);
      return {
        complete: body.complete,
        left_out: body.missing,
        schedules: body.schedules.map((s) => ({
          summary: s.summary,
          changes: s.changes,
          picks: s.picks.map((p) => ({ course: p.course, crn: p.sections[0].crn, yours: !!p.current, when: p.meetings.map((m) => `${m.days} ${m.begin}-${m.end}`).join(' + '), other_crns: p.sections.slice(1, 4).map((x) => x.crn) })),
        })),
      };
    },
  },
  {
    name: 'set_my_section',
    description:
      "Record which section the student is registered in or waitlisted for (after they changed it in Athena), or turn a course's alerts on or off. Adds the course if it's new. This only updates Seat Watcher; it does not touch Athena. Pass an empty string to clear.",
    inputSchema: {
      type: 'object',
      properties: {
        course: { type: 'string' },
        registered_crn: { type: 'string', description: 'Five-digit CRN, or "" to clear' },
        waitlisted_crn: { type: 'string', description: 'Five-digit CRN, or "" to clear' },
        alerts: { type: 'boolean' },
      },
      required: ['course'],
      additionalProperties: false,
    },
    run: async (a) => {
      const patch = { course: a.course };
      if (a.registered_crn !== undefined) patch.registered = a.registered_crn;
      if (a.waitlisted_crn !== undefined) patch.waitlisted = a.waitlisted_crn;
      if (a.alerts !== undefined) patch.enabled = a.alerts;
      const { body } = await post('/api/held', patch);
      const c = body.config.courses.find((x) => x.course.replace(/\s+/g, ' ').toUpperCase() === a.course.replace(/\s+/g, ' ').toUpperCase());
      return { saved: true, course: c };
    },
  },
  {
    name: 'seat_history',
    description: 'Recent times sections opened up or filled, newest first. Useful for "when do seats in this section usually free up".',
    inputSchema: {
      type: 'object',
      properties: { crns: { type: 'array', items: { type: 'string' } } },
      additionalProperties: false,
    },
    run: async ({ crns = [] } = {}) => {
      const { body } = await api(`/api/history${crns.length ? `?crns=${crns.join(',')}` : ''}`);
      return body.slice(0, 100);
    },
  },
];

const write = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id, result) => write({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return; // notifications (initialized, cancelled) need no answer
  switch (method) {
    case 'initialize': {
      const want = params?.protocolVersion;
      return reply(id, {
        protocolVersion: PROTOCOLS.includes(want) ? want : PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'uga-seat-watcher', version: VERSION },
        instructions: `Seat Watcher for UGA course registration. Call my_week first. ${RULES}`,
      });
    }
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools: TOOLS.map(({ run, ...t }) => t) });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return fail(id, -32602, `Unknown tool ${params?.name}`);
      try {
        const out = await tool.run(params.arguments ?? {});
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }] });
      } catch (e) {
        return reply(id, { content: [{ type: 'text', text: e.message }], isError: true });
      }
    }
    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return fail(null, -32700, 'Parse error');
  }
  handle(msg).catch((e) => fail(msg.id ?? null, -32603, e.message));
});
