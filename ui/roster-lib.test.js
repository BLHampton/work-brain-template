const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const lib = require('./roster-lib');

const TASK_LOG_HEADER = '# Task log\n\n`date | ticket | what | lane | status` — status: in-progress · pr-open · merged · deployed · dropped. Only `deployed` = shipped.\n\n';

function brain() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-ui-'));
  fs.mkdirSync(path.join(root, '.claude/agents'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude/agents/a.md'), '---\nname: a\n---\n');
  fs.writeFileSync(path.join(root, '.claude/agents/b.md'), '---\nname: b\n---\n');
  fs.writeFileSync(path.join(root, 'task-log.md'), TASK_LOG_HEADER);
  return root;
}

test('rosterFor lists every agent file plus lead, all idle with empty records when nothing was dispatched', () => {
  const root = brain();
  const empty = { status: 'idle', mission: null, task: null, since: null, record: { missions: 0, bugsCaught: 0, avgMinutes: 0 } };
  assert.deepEqual(lib.rosterFor(root), [
    { name: 'a', ...empty },
    { name: 'b', ...empty },
    { name: 'lead', ...empty },
  ]);
});

test('rosterFor marks an agent with a start line and no done line as working with mission, task and since', () => {
  const root = brain();
  const start = { ts: '2026-10-16T09:00:00.000Z', id: 'toolu_1', agent: 'a', mission: 'write failing test 6', task: 'tasks/2026-10-16-agent-roster' };
  fs.mkdirSync(path.join(root, 'ui'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ui/dispatch.jsonl'), JSON.stringify(start) + '\n');
  const byName = Object.fromEntries(lib.rosterFor(root).map((r) => [r.name, r]));
  assert.deepEqual(
    { status: byName.a.status, mission: byName.a.mission, task: byName.a.task, since: byName.a.since },
    { status: 'working', mission: 'write failing test 6', task: 'tasks/2026-10-16-agent-roster', since: '2026-10-16T09:00:00.000Z' },
  );
  assert.equal(byName.b.status, 'idle');
});

test('rosterFor counts done lines as missions and averages their seconds to one-decimal minutes, skipping null seconds', () => {
  const root = brain();
  const lines = [
    { ts: '2026-10-16T09:00:00.000Z', id: 'toolu_1', agent: 'a', mission: 'm1', task: 'tasks/2026-10-16-agent-roster' },
    { ts: '2026-10-16T09:01:30.000Z', id: 'toolu_1', agent: 'a', done: true, seconds: 90 },
    { ts: '2026-10-16T09:02:00.000Z', id: 'toolu_2', agent: 'a', mission: 'm2', task: 'tasks/2026-10-16-agent-roster' },
    { ts: '2026-10-16T09:04:30.000Z', id: 'toolu_2', agent: 'a', done: true, seconds: 150 },
    { ts: '2026-10-16T09:05:00.000Z', id: 'toolu_3', agent: 'a', mission: 'm3', task: 'tasks/2026-10-16-agent-roster' },
    { ts: '2026-10-16T09:05:10.000Z', id: 'toolu_3', agent: 'a', done: true, seconds: null },
    { ts: '2026-10-16T09:06:00.000Z', id: 'toolu_4', agent: 'b', mission: 'm4', task: 'tasks/2026-10-16-agent-roster' },
    { ts: '2026-10-16T09:07:40.000Z', id: 'toolu_4', agent: 'b', done: true, seconds: 100 },
  ];
  fs.mkdirSync(path.join(root, 'ui'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ui/dispatch.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const byName = Object.fromEntries(lib.rosterFor(root).map((r) => [r.name, r]));
  assert.deepEqual(
    { a: { status: byName.a.status, record: byName.a.record }, b: { status: byName.b.status, record: byName.b.record } },
    {
      a: { status: 'idle', record: { missions: 3, bugsCaught: 0, avgMinutes: 2.0 } },
      b: { status: 'idle', record: { missions: 1, bugsCaught: 0, avgMinutes: 1.7 } },
    },
  );
});

test('rosterFor makes the lead working on the newest non-deployed non-dropped task-log line, and idle when there is none', () => {
  const root = brain();
  const lines = [
    '2026-10-14 | TICKET-801 | Rate limiter returns 429 per API key | standard | in-progress',
    '2026-10-15 | TICKET-802 | Telemetry meta on every signal | standard | deployed',
    '2026-10-16 | TICKET-803 | Roster tab in work-brain UI | quick | dropped',
  ];
  fs.writeFileSync(path.join(root, 'task-log.md'), TASK_LOG_HEADER + lines.join('\n') + '\n');
  const lead = lib.rosterFor(root).find((r) => r.name === 'lead');
  assert.deepEqual(
    { status: lead.status, mission: lead.mission, task: lead.task, since: lead.since },
    { status: 'working', mission: 'Rate limiter returns 429 per API key', task: null, since: '2026-10-14' },
  );

  fs.writeFileSync(path.join(root, 'task-log.md'), TASK_LOG_HEADER + lines.slice(1).join('\n') + '\n');
  const idleLead = lib.rosterFor(root).find((r) => r.name === 'lead');
  assert.deepEqual(
    { status: idleLead.status, mission: idleLead.mission, task: idleLead.task, since: idleLead.since },
    { status: 'idle', mission: null, task: null, since: null },
  );
});

function review(root, folder, body, verdict) {
  fs.mkdirSync(path.join(root, 'tasks', folder), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'tasks', folder, 'review.md'),
    `<!-- review.md · reviewer · cap: tables + 1 line -->\n## Findings\n\n| severity | file:line | issue | suggested fix |\n| --- | --- | --- | --- |\n${body}\n## Ponytail\n\nnothing\n\nVerdict: ${verdict}\n`,
  );
}

test('rosterFor counts Verdict: CHANGES_REQUESTED lines across tasks/*/review.md as the reviewer bugsCaught, ignoring mentions in the body', () => {
  const root = brain();
  fs.writeFileSync(path.join(root, '.claude/agents/reviewer.md'), '---\nname: reviewer\n---\n');
  review(root, '2026-10-13-rate-limiter', '| HIGH | `ui/a.js:12` | off by one | use `<=` |\n', 'CHANGES_REQUESTED');
  review(root, '2026-10-14-telemetry-signal', '| LOW | `review.md:20` | last line was CHANGES_REQUESTED in a draft | leave as is |\n', 'APPROVE');
  review(root, '2026-10-15-roster', '| BLOCKER | `ui/b.js:3` | throws on empty input | guard |\n', 'CHANGES_REQUESTED');
  const byName = Object.fromEntries(lib.rosterFor(root).map((r) => [r.name, r]));
  assert.deepEqual(
    { reviewer: byName.reviewer.record.bugsCaught, a: byName.a.record.bugsCaught, lead: byName.lead.record.bugsCaught },
    { reviewer: 2, a: 0, lead: 0 },
  );
});

function qa(root, folder, rows) {
  fs.mkdirSync(path.join(root, 'tasks', folder), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'tasks', folder, 'qa.md'),
    `<!-- qa.md · qa · cap: 1 page -->\n## Suite\n\n\`node --test\` — passed 3 · failed 0 · skipped 0\n\n## Acceptance criteria\n\n| # | criterion | pass / fail | how checked |\n| --- | --- | --- | --- |\n${rows}\n## Edge cases tried\n\n| case | result |\n| --- | --- |\n| empty input | ok |\n`,
  );
}

function tddLog(root, folder, rows) {
  fs.mkdirSync(path.join(root, 'tasks', folder), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'tasks', folder, 'tdd-log.md'),
    `<!-- tdd-log.md · lead · table only, one row per test-list item -->\n| # | test name | red confirmed (reason) | green confirmed | who | notes |\n| --- | --- | --- | --- | --- | --- |\n${rows}`,
  );
}

test('rosterFor counts qa.md fail rows as the qa bugsCaught and tdd-log.md yes-red rows as the test-writer bugsCaught, zero for implementer and lead', () => {
  const root = brain();
  for (const name of ['qa', 'test-writer', 'implementer']) {
    fs.writeFileSync(path.join(root, `.claude/agents/${name}.md`), `---\nname: ${name}\n---\n`);
  }
  qa(root, '2026-10-13-rate-limiter',
    '| 1 | returns 429 after 100 requests | fail | got 200 on request 101 |\n' +
    '| 2 | per-key counters are isolated | pass | second key did not fail after the first hit 100 |\n' +
    '| 3 | headers carry Retry-After | fail | header missing |\n');
  qa(root, '2026-10-14-telemetry-signal',
    '| 1 | meta on every signal | pass | checked three signal types |\n' +
    '| 2 | no PII in meta | fail | employee id present |\n');
  tddLog(root, '2026-10-13-rate-limiter',
    '| 1 | returns 429 after 100 requests | yes (assertion: expected 429, got 200) | yes | test-writer / implementer | faked |\n' +
    '| 2 | per-key counters | no (import error on first run, fixed) | yes | test-writer / implementer | |\n' +
    '| 3 | Retry-After header | yes (expected header, got undefined) | yes | test-writer / implementer | |\n');
  tddLog(root, '2026-10-14-telemetry-signal',
    '| 1 | meta on every signal | yes (expected meta, got undefined) | yes | test-writer / implementer | |\n');
  const byName = Object.fromEntries(lib.rosterFor(root).map((r) => [r.name, r]));
  assert.deepEqual(
    {
      qa: byName.qa.record.bugsCaught,
      'test-writer': byName['test-writer'].record.bugsCaught,
      implementer: byName.implementer.record.bugsCaught,
      lead: byName.lead.record.bugsCaught,
    },
    { qa: 3, 'test-writer': 3, implementer: 0, lead: 0 },
  );
});

test('rosterFor reports the newest done dispatch as the mission and task of an idle agent, with since null', () => {
  const root = brain();
  const lines = [
    { ts: '2026-10-16T09:00:00.000Z', id: 'toolu_1', agent: 'a', mission: 'write failing test 6', task: 'tasks/2026-10-16-agent-roster' },
    { ts: '2026-10-16T09:01:30.000Z', id: 'toolu_1', agent: 'a', done: true, seconds: 90 },
    { ts: '2026-10-16T09:02:00.000Z', id: 'toolu_2', agent: 'a', mission: 'review the diff', task: 'tasks/2026-10-16-brain-board' },
    { ts: '2026-10-16T09:04:30.000Z', id: 'toolu_2', agent: 'a', done: true, seconds: 150 },
  ];
  fs.mkdirSync(path.join(root, 'ui'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ui/dispatch.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const byName = Object.fromEntries(lib.rosterFor(root).map((r) => [r.name, r]));
  assert.deepEqual(
    { status: byName.a.status, mission: byName.a.mission, task: byName.a.task, since: byName.a.since },
    { status: 'idle', mission: 'review the diff', task: 'tasks/2026-10-16-brain-board', since: null },
  );
  assert.deepEqual({ mission: byName.b.mission, task: byName.b.task }, { mission: null, task: null });
});

test('rosterFor derives status from the newest start line only, so a cancelled older start with no done line does not keep the agent working', () => {
  const root = brain();
  const lines = [
    { ts: '2026-10-17T09:00:00.000Z', id: 'toolu_s1', agent: 'a', mission: 'cancelled midway', task: 'tasks/2026-10-16-agent-roster' },
    { ts: '2026-10-18T09:00:00.000Z', id: 'toolu_s2', agent: 'a', mission: 'review the diff', task: 'tasks/2026-10-16-brain-board' },
    { ts: '2026-10-18T09:02:30.000Z', id: 'toolu_s2', agent: 'a', done: true, seconds: 150 },
  ];
  fs.mkdirSync(path.join(root, 'ui'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ui/dispatch.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const byName = Object.fromEntries(lib.rosterFor(root).map((r) => [r.name, r]));
  assert.deepEqual(
    { status: byName.a.status, mission: byName.a.mission, task: byName.a.task, since: byName.a.since },
    { status: 'idle', mission: 'review the diff', task: 'tasks/2026-10-16-brain-board', since: null },
  );
});

test('doneLineFor builds a done row for the newest open start of the agent, and null when none is open or it is already done', () => {
  const now = new Date('2026-11-02T10:00:00.000Z');
  const starts = [
    { ts: '2026-11-02T09:50:00.000Z', id: 'toolu_old', agent: 'implementer', mission: 'older, no done row', task: 'tasks/2026-11-02-brain-agent-stats' },
    { ts: '2026-11-02T09:57:30.000Z', id: 'toolu_new', agent: 'implementer', mission: 'newest open', task: 'tasks/2026-11-02-brain-agent-stats' },
    { ts: '2026-11-02T09:58:00.000Z', id: 'toolu_rev', agent: 'reviewer', mission: 'review the diff', task: 'tasks/2026-11-02-brain-agent-stats' },
  ];
  const cases = [
    {
      name: 'newest start of the agent is open',
      dispatches: starts,
      agent: 'implementer',
      expected: { ts: '2026-11-02T10:00:00.000Z', id: 'toolu_new', agent: 'implementer', done: true, seconds: 150 },
    },
    {
      name: 'no start of that agent at all',
      dispatches: starts,
      agent: 'qa',
      expected: null,
    },
    {
      name: 'newest start of the agent already has a done row',
      dispatches: [...starts, { ts: '2026-11-02T09:59:00.000Z', id: 'toolu_new', agent: 'implementer', done: true, seconds: 90 }],
      agent: 'implementer',
      expected: null,
    },
  ];
  for (const c of cases) {
    assert.deepEqual(lib.doneLineFor(c.dispatches, c.agent, now), c.expected, c.name);
  }
});
