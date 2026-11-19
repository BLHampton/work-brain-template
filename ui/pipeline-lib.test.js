const { test } = require('node:test');
const assert = require('node:assert/strict');
const lib = require('./pipeline-lib');

const status = (o) => ({ attempts: 0, review_round: 0, awaiting: null, blocked_reason: null, look_flags: [], ...o });

test('pipelineRow for a standard card at tdd returns the seven stages with brief and plan passed, tdd current, the rest pending', () => {
  const row = lib.pipelineRow(status({
    card: 'TICKET-812',
    folder: 'tasks/2026-10-30-rate-limit',
    lane: 'standard',
    stage: 'tdd',
    attempts: 2,
  }));
  assert.deepEqual(row, {
    card: 'TICKET-812',
    folder: 'tasks/2026-10-30-rate-limit',
    lane: 'standard',
    stages: [
      { name: 'brief', state: 'passed' },
      { name: 'plan', state: 'passed' },
      { name: 'tdd', state: 'current' },
      { name: 'review', state: 'pending' },
      { name: 'verify', state: 'pending' },
      { name: 'packet', state: 'pending' },
      { name: 'scribe', state: 'pending' },
    ],
    awaiting: null,
    blocked_reason: null,
    agentCount: 0,
  });
});

test('pipelineRow marks awaiting amber with its label, blocked red with blocked_reason, and a review card runs brief → review → done', () => {
  const cases = [
    {
      name: 'standard card awaiting plan approval: plan light is amber with the label',
      status: status({ card: 'TICKET-812', folder: 'tasks/2026-10-30-rate-limit', lane: 'standard', stage: 'plan', awaiting: 'plan approval' }),
      stages: [
        { name: 'brief', state: 'passed' },
        { name: 'plan', state: 'awaiting', label: 'plan approval' },
        { name: 'tdd', state: 'pending' },
        { name: 'review', state: 'pending' },
        { name: 'verify', state: 'pending' },
        { name: 'packet', state: 'pending' },
        { name: 'scribe', state: 'pending' },
      ],
    },
    {
      name: 'quick card blocked: a red light carries blocked_reason',
      status: status({ card: 'TICKET-813', folder: 'tasks/2026-10-30-typo', lane: 'quick', stage: 'blocked', blocked_reason: 'review rounds exhausted' }),
      stages: [
        { name: 'tdd', state: 'pending' },
        { name: 'review', state: 'pending' },
        { name: 'packet', state: 'pending' },
        { name: 'scribe', state: 'pending' },
        { name: 'blocked', state: 'blocked', label: 'review rounds exhausted' },
      ],
    },
    {
      name: 'review card at review: brief → review → done',
      status: status({ card: 'PR 41365', folder: 'tasks/2026-10-30-ld-review', lane: 'review', stage: 'review' }),
      stages: [
        { name: 'brief', state: 'passed' },
        { name: 'review', state: 'current' },
        { name: 'done', state: 'pending' },
      ],
    },
  ];
  for (const c of cases) {
    assert.deepEqual(lib.pipelineRow(c.status).stages, c.stages, c.name);
  }
});

test('pipelineRow counts open dispatch rows whose task matches the folder, leaving out finished and other-folder dispatches', () => {
  // Rows shaped like .claude/hooks/dispatch-log.js writes them: a start line names the task, a done line shares its id.
  const dispatches = [
    { ts: '2026-10-30T10:00:00.000Z', id: 'toolu_1', agent: 'test-writer', mission: 'rate-limit test 3', task: 'tasks/2026-10-30-rate-limit' },
    { ts: '2026-10-30T10:05:00.000Z', id: 'toolu_1', agent: 'test-writer', done: true, seconds: 300 },
    { ts: '2026-10-30T10:06:00.000Z', id: 'toolu_2', agent: 'implementer', mission: 'rate-limit impl 3', task: 'tasks/2026-10-30-rate-limit' },
    { ts: '2026-10-30T10:07:00.000Z', id: 'toolu_3', agent: 'reviewer', mission: 'typo review', task: 'tasks/2026-10-30-typo' },
    { ts: '2026-10-30T10:08:00.000Z', id: 'toolu_4', agent: 'researcher', mission: 'no task named', task: null },
    { ts: '2026-10-30T10:09:00.000Z', id: 'toolu_5', agent: 'qa', mission: 'rate-limit qa', task: 'tasks/2026-10-30-rate-limit' },
  ];
  const rateLimit = status({ card: 'TICKET-812', folder: 'tasks/2026-10-30-rate-limit', lane: 'standard', stage: 'tdd' });
  const typo = status({ card: 'TICKET-813', folder: 'tasks/2026-10-30-typo', lane: 'quick', stage: 'review' });

  assert.equal(lib.pipelineRow(rateLimit, dispatches).agentCount, 2, 'implementer and qa are open; the test-writer finished');
  assert.equal(lib.pipelineRow(typo, dispatches).agentCount, 1, 'only the reviewer names the typo folder');
  assert.equal(lib.pipelineRow(rateLimit, []).agentCount, 0, 'no dispatch rows = no agents');
  assert.equal(lib.pipelineRow(rateLimit).agentCount, 0, 'rows are optional');
});
