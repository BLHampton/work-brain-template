const { test } = require('node:test');
const assert = require('node:assert/strict');
const lib = require('./stats-lib');

test('pairDispatches closes a start exactly by its done row, taking seconds from the done row, and emits nothing for the done row itself', () => {
  const rows = [
    { ts: '2026-11-02T09:00:00.000Z', id: 'toolu_1', agent: 'implementer', mission: 'make test 3 green', task: 'tasks/2026-11-02-brain-agent-stats' },
    { ts: '2026-11-02T09:02:05.000Z', id: 'toolu_1', agent: 'implementer', done: true, seconds: 125 },
  ];
  assert.deepEqual(lib.pairDispatches(rows), [
    {
      id: 'toolu_1',
      agent: 'implementer',
      task: 'tasks/2026-11-02-brain-agent-stats',
      mission: 'make test 3 green',
      start: '2026-11-02T09:00:00.000Z',
      end: '2026-11-02T09:02:05.000Z',
      seconds: 125,
      inferred: false,
      open: false,
    },
  ]);
});

test('pairDispatches infers the end of an unmatched start from the next start of the same agent, leaves the newest start open, and never pairs across agents', () => {
  const rows = [
    { ts: '2026-11-02T09:00:00.000Z', id: 'toolu_a', agent: 'implementer', mission: 'make test 3 green', task: 'tasks/2026-11-02-brain-agent-stats' },
    { ts: '2026-11-02T09:05:00.000Z', id: 'toolu_b', agent: 'test-writer', mission: 'write test 4', task: 'tasks/2026-11-02-brain-agent-stats' },
    { ts: '2026-11-02T09:10:00.400Z', id: 'toolu_c', agent: 'implementer', mission: 'make test 4 green', task: 'tasks/2026-11-02-brain-agent-stats' },
    { ts: '2026-11-02T09:12:00.000Z', id: 'toolu_d', agent: 'reviewer', mission: 'review the diff', task: 'tasks/2026-11-02-brain-agent-stats' },
  ];
  const records = lib.pairDispatches(rows);
  const byId = Object.fromEntries(records.map((r) => [r.id, r]));

  // The first implementer start is closed by the next implementer start (not by the
  // test-writer start at 09:05), with seconds = the rounded difference.
  assert.deepEqual(byId.toolu_a, {
    id: 'toolu_a',
    agent: 'implementer',
    task: 'tasks/2026-11-02-brain-agent-stats',
    mission: 'make test 3 green',
    start: '2026-11-02T09:00:00.000Z',
    end: '2026-11-02T09:10:00.400Z',
    seconds: 600,
    inferred: true,
    open: false,
  });

  // The newest start of each agent stays open and is not inferred.
  for (const id of ['toolu_b', 'toolu_c', 'toolu_d']) {
    assert.equal(byId[id].open, true, `${id} should be open`);
    assert.equal(byId[id].inferred, false, `${id} should not be inferred`);
  }
  assert.equal(records.length, 4);
});

test('stageOf maps each agent role to its pipeline stage and everything else to other', () => {
  const cases = [
    ['test-writer', 'tdd'],
    ['implementer', 'tdd'],
    ['reviewer', 'review'],
    ['qa', 'verify'],
    ['researcher', 'research'],
    ['scribe', 'scribe'],
    ['Explore', 'other'],
    ['general-purpose', 'other'],
    [undefined, 'other'],
  ];
  for (const [agent, expected] of cases) {
    assert.equal(lib.stageOf(agent), expected, `stageOf(${JSON.stringify(agent)}) should be ${expected}`);
  }
});

test('statsByCard sums agent, inferred, per-role and per-stage seconds per task folder, copies card/lane/stage from its status, and omits folders with no dispatches', () => {
  const rows = [
    // folder A: one exact close, one inferred close, one exact close, one still open
    { ts: '2026-11-02T09:00:00.000Z', id: 'toolu_1', agent: 'implementer', mission: 'make test 3 green', task: 'tasks/2026-11-02-a' },
    { ts: '2026-11-02T09:02:05.000Z', id: 'toolu_1', agent: 'implementer', done: true, seconds: 125 },
    { ts: '2026-11-02T09:03:00.000Z', id: 'toolu_2', agent: 'test-writer', mission: 'write test 4', task: 'tasks/2026-11-02-a' },
    { ts: '2026-11-02T09:05:00.000Z', id: 'toolu_3', agent: 'reviewer', mission: 'review the diff', task: 'tasks/2026-11-02-a' },
    { ts: '2026-11-02T09:06:00.000Z', id: 'toolu_3', agent: 'reviewer', done: true, seconds: 60 },
    { ts: '2026-11-02T09:08:00.000Z', id: 'toolu_4', agent: 'test-writer', mission: 'write test 5', task: 'tasks/2026-11-02-a' },
    // folder B: has dispatches but no status.json
    { ts: '2026-11-02T09:00:00.000Z', id: 'toolu_5', agent: 'qa', mission: 'verify the card', task: 'tasks/2026-11-02-b' },
    { ts: '2026-11-02T09:00:30.000Z', id: 'toolu_5', agent: 'qa', done: true, seconds: 30 },
  ];
  const statuses = [
    { folder: 'tasks/2026-11-02-a', card: 'TICKET-1', lane: 'standard', stage: 'review', attempts: 0 },
    { folder: 'tasks/2026-11-02-c', card: 'TICKET-3', lane: 'quick', stage: 'brief', attempts: 0 }, // no dispatches → omitted
  ];

  const cards = lib.statsByCard(lib.pairDispatches(rows), statuses);
  const byFolder = Object.fromEntries(cards.map((c) => [c.folder, c]));

  assert.equal(cards.length, 2, 'one entry per folder that has dispatches');
  assert.equal(byFolder['tasks/2026-11-02-c'], undefined, 'a status with no dispatches is omitted');

  const a = byFolder['tasks/2026-11-02-a'];
  assert.equal(a.card, 'TICKET-1');
  assert.equal(a.lane, 'standard');
  assert.equal(a.stage, 'review');
  assert.equal(a.dispatches, 4, 'open starts still count as dispatches');
  assert.equal(a.agentSeconds, 125 + 300 + 60, 'sum of seconds over closed pairs; the open one adds nothing');
  assert.equal(a.inferredSeconds, 300, 'only the test-writer pair closed by its next start is inferred');
  assert.deepEqual(a.roles, {
    implementer: { count: 1, seconds: 125 },
    'test-writer': { count: 2, seconds: 300 },
    reviewer: { count: 1, seconds: 60 },
  });
  assert.equal(a.stages.tdd, 125 + 300, 'implementer + test-writer seconds land in tdd');
  assert.equal(a.stages.review, 60);
  assert.ok(!a.stages.verify, 'no qa time on folder A');

  const b = byFolder['tasks/2026-11-02-b'];
  assert.equal(b.card, null, 'no status → card null');
  assert.equal(b.lane, null, 'no status → lane null');
  assert.equal(b.stage, null, 'no status → stage null');
  assert.equal(b.dispatches, 1);
  assert.equal(b.agentSeconds, 30);
  assert.equal(b.inferredSeconds, 0);
  assert.deepEqual(b.roles, { qa: { count: 1, seconds: 30 } });
  assert.equal(b.stages.verify, 30);
});

test('statsByCard sums dispatcherSeconds from the positive gaps between consecutive dispatches on a folder, ordered by start, and counts open pairs in openCount', () => {
  const rows = [
    // folder A, in start order: pair 1 ends 09:02:00; pair 2 starts 09:04:00 (120 s gap) and ends 09:06:00;
    // pair 3 starts 09:05:30 (30 s overlap → adds 0) and stays open (no gap after it).
    { ts: '2026-11-02T09:00:00.000Z', id: 'toolu_1', agent: 'implementer', mission: 'make test 6 green', task: 'tasks/2026-11-02-a' },
    { ts: '2026-11-02T09:02:00.000Z', id: 'toolu_1', agent: 'implementer', done: true, seconds: 120 },
    { ts: '2026-11-02T09:04:00.000Z', id: 'toolu_2', agent: 'test-writer', mission: 'write test 7', task: 'tasks/2026-11-02-a' },
    { ts: '2026-11-02T09:06:00.000Z', id: 'toolu_2', agent: 'test-writer', done: true, seconds: 120 },
    { ts: '2026-11-02T09:05:30.000Z', id: 'toolu_3', agent: 'implementer', mission: 'make test 7 green', task: 'tasks/2026-11-02-a' },
    // folder B: one closed pair sitting inside folder A's 120 s gap; it must not shrink A's gap.
    { ts: '2026-11-02T09:02:30.000Z', id: 'toolu_4', agent: 'reviewer', mission: 'review the diff', task: 'tasks/2026-11-02-b' },
    { ts: '2026-11-02T09:03:30.000Z', id: 'toolu_4', agent: 'reviewer', done: true, seconds: 60 },
  ];
  const statuses = [
    { folder: 'tasks/2026-11-02-a', card: 'TICKET-1', lane: 'standard', stage: 'tdd', attempts: 0 },
    { folder: 'tasks/2026-11-02-b', card: 'TICKET-2', lane: 'quick', stage: 'review', attempts: 0 },
  ];

  // Pairs are handed over newest-first so the gaps only come out right if statsByCard orders by start.
  const pairs = lib.pairDispatches(rows).slice().reverse();
  const cards = lib.statsByCard(pairs, statuses);
  const byFolder = Object.fromEntries(cards.map((c) => [c.folder, c]));

  const a = byFolder['tasks/2026-11-02-a'];
  assert.equal(a.dispatcherSeconds, 120, 'the 120 s gap counts; the 30 s overlap adds 0; the open pair has no gap after it');
  assert.equal(a.openCount, 1, 'one open pair on folder A');

  const b = byFolder['tasks/2026-11-02-b'];
  assert.equal(b.dispatcherSeconds, 0, 'a single pair has no gap');
  assert.equal(b.openCount, 0, 'no open pairs on folder B');
});

test('pairDispatches caps an inferred span at INFERRED_CAP_SECONDS and marks it capped, leaves a short inferred span uncapped, never caps an exact span, and statsByCard sums the capped value', () => {
  const rows = [
    // implementer: start, then nothing for 3 h until the next implementer start → raw gap 10800 s, over the cap
    { ts: '2026-11-02T09:00:00.000Z', id: 'toolu_1', agent: 'implementer', mission: 'make test 4 green', task: 'tasks/2026-11-02-a' },
    { ts: '2026-11-02T12:00:00.000Z', id: 'toolu_2', agent: 'implementer', mission: 'make test 5 green', task: 'tasks/2026-11-02-a' },
    // test-writer: start closed by its next start 10 min later → 600 s, under the cap
    { ts: '2026-11-02T09:00:00.000Z', id: 'toolu_3', agent: 'test-writer', mission: 'write test 4', task: 'tasks/2026-11-02-a' },
    { ts: '2026-11-02T09:10:00.000Z', id: 'toolu_4', agent: 'test-writer', mission: 'write test 5', task: 'tasks/2026-11-02-a' },
    // reviewer: exact close via done row with seconds above the cap → kept as is
    { ts: '2026-11-02T09:00:00.000Z', id: 'toolu_5', agent: 'reviewer', mission: 'review the diff', task: 'tasks/2026-11-02-a' },
    { ts: '2026-11-02T11:30:00.000Z', id: 'toolu_5', agent: 'reviewer', done: true, seconds: 9000 },
  ];

  const byId = Object.fromEntries(lib.pairDispatches(rows).map((r) => [r.id, r]));

  assert.deepEqual(byId.toolu_1, {
    id: 'toolu_1',
    agent: 'implementer',
    task: 'tasks/2026-11-02-a',
    mission: 'make test 4 green',
    start: '2026-11-02T09:00:00.000Z',
    end: '2026-11-02T12:00:00.000Z',
    seconds: 7200,
    inferred: true,
    capped: true,
    open: false,
  });

  assert.equal(lib.INFERRED_CAP_SECONDS, 7200, 'the cap is exported and is 2 h');

  assert.equal(byId.toolu_3.seconds, 600, 'an inferred span under the cap keeps its raw gap');
  assert.ok(!byId.toolu_3.capped, 'an inferred span under the cap is not capped');

  assert.equal(byId.toolu_5.seconds, 9000, 'an exact span keeps the done row seconds even above the cap');
  assert.equal(byId.toolu_5.inferred, false);
  assert.ok(!byId.toolu_5.capped, 'an exact span is never capped');

  const statuses = [{ folder: 'tasks/2026-11-02-a', card: 'TICKET-1', lane: 'standard', stage: 'tdd', attempts: 0 }];
  const [a] = lib.statsByCard(lib.pairDispatches(rows), statuses);
  assert.equal(a.folder, 'tasks/2026-11-02-a');
  assert.equal(a.agentSeconds, 7200 + 600 + 9000, 'the capped value, not the raw 10800 s gap, is summed');
  assert.equal(a.inferredSeconds, 7200 + 600, 'inferred seconds use the capped value too');
  assert.equal(a.roles.implementer.seconds, 7200);
});

test('statsByCard caps each dispatcher gap at INFERRED_CAP_SECONDS before summing into dispatcherSeconds, and leaves a gap under the cap unchanged', () => {
  const rows = [
    // folder A, all exact closes: pair 1 ends 09:01:00; pair 2 starts 17:01:00 (8 h idle gap = 28800 s, over the cap)
    // and ends 17:02:00; pair 3 starts 17:03:30 (90 s gap) and ends 17:04:00.
    { ts: '2026-11-02T09:00:00.000Z', id: 'toolu_1', agent: 'implementer', mission: 'make test 7 green', task: 'tasks/2026-11-02-a' },
    { ts: '2026-11-02T09:01:00.000Z', id: 'toolu_1', agent: 'implementer', done: true, seconds: 60 },
    { ts: '2026-11-02T17:01:00.000Z', id: 'toolu_2', agent: 'reviewer', mission: 'review the diff', task: 'tasks/2026-11-02-a' },
    { ts: '2026-11-02T17:02:00.000Z', id: 'toolu_2', agent: 'reviewer', done: true, seconds: 60 },
    { ts: '2026-11-02T17:03:30.000Z', id: 'toolu_3', agent: 'qa', mission: 'verify the card', task: 'tasks/2026-11-02-a' },
    { ts: '2026-11-02T17:04:00.000Z', id: 'toolu_3', agent: 'qa', done: true, seconds: 30 },
    // folder B: one 10 min gap, under the cap
    { ts: '2026-11-02T09:00:00.000Z', id: 'toolu_4', agent: 'implementer', mission: 'make test 8 green', task: 'tasks/2026-11-02-b' },
    { ts: '2026-11-02T09:01:00.000Z', id: 'toolu_4', agent: 'implementer', done: true, seconds: 60 },
    { ts: '2026-11-02T09:11:00.000Z', id: 'toolu_5', agent: 'reviewer', mission: 'review the diff', task: 'tasks/2026-11-02-b' },
    { ts: '2026-11-02T09:12:00.000Z', id: 'toolu_5', agent: 'reviewer', done: true, seconds: 60 },
  ];
  const statuses = [
    { folder: 'tasks/2026-11-02-a', card: 'TICKET-1', lane: 'standard', stage: 'verify', attempts: 0 },
    { folder: 'tasks/2026-11-02-b', card: 'TICKET-2', lane: 'quick', stage: 'review', attempts: 0 },
  ];

  const cards = lib.statsByCard(lib.pairDispatches(rows), statuses);
  const byFolder = Object.fromEntries(cards.map((c) => [c.folder, c]));

  const a = byFolder['tasks/2026-11-02-a'];
  assert.equal(
    a.dispatcherSeconds,
    lib.INFERRED_CAP_SECONDS + 90,
    'the 8 h gap books the cap (7200), the 90 s gap books 90: 7290, not the raw 28890',
  );
  assert.equal(a.agentSeconds, 60 + 60 + 30, 'exact agent spans are untouched by the gap cap');

  const b = byFolder['tasks/2026-11-02-b'];
  assert.equal(b.dispatcherSeconds, 600, 'a gap under the cap is summed as is');
});
