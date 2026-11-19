const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, 'dispatch-log.js');

let brain;
beforeEach(() => {
  brain = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-log-'));
  fs.mkdirSync(path.join(brain, 'ui'));
});

function run(input) {
  const stdin = typeof input === 'string' ? input : JSON.stringify(input);
  const r = spawnSync(process.execPath, [SCRIPT], {
    input: stdin, encoding: 'utf8', env: { ...process.env, WORK_BRAIN_ROOT: brain },
  });
  return { status: r.status, stderr: r.stderr.trim(), stdout: r.stdout };
}

function readLines() {
  const file = path.join(brain, 'ui/dispatch.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function seedLines(lines) {
  fs.writeFileSync(path.join(brain, 'ui/dispatch.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

test('PreToolUse Agent appends a start line with agent, mission and the first tasks/<folder> in the prompt', () => {
  const before = Date.now();
  const r = run({
    hook_event_name: 'PreToolUse',
    tool_name: 'Agent',
    tool_use_id: 'toolu_01abc',
    cwd: brain,
    tool_input: {
      subagent_type: 'test-writer',
      description: 'Write failing dispatch test',
      prompt: 'Task folder: /home/x/work-brain/tasks/2026-10-16-agent-roster\nAlso see tasks/2026-10-01-other for context.',
    },
  });
  const lines = readLines();
  assert.equal(lines.length, 1, `expected one start line in ui/dispatch.jsonl, got ${lines.length}; stderr: ${r.stderr}`);
  const line = lines[0];
  assert.deepEqual(Object.keys(line).sort(), ['agent', 'id', 'mission', 'task', 'ts']);
  assert.equal(line.id, 'toolu_01abc');
  assert.equal(line.agent, 'test-writer');
  assert.equal(line.mission, 'Write failing dispatch test');
  assert.equal(line.task, 'tasks/2026-10-16-agent-roster');
  const ts = Date.parse(line.ts);
  assert.ok(ts >= before - 1000 && ts <= Date.now() + 1000, `ts should be now-ish ISO, got ${line.ts}`);

  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('PreToolUse for a non-Agent tool appends nothing and exits 0, even with Agent-shaped tool_input', () => {
  const r = run({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_use_id: 'toolu_02bash',
    cwd: brain,
    tool_input: {
      subagent_type: 'implementer',
      description: 'Looks like an Agent call but is not one',
      prompt: 'Task folder: tasks/2026-10-16-agent-roster',
      command: 'ls',
    },
  });
  assert.deepEqual(readLines(), [], 'non-Agent tool must not write to ui/dispatch.jsonl');
  assert.equal(fs.existsSync(path.join(brain, 'ui/dispatch.jsonl')), false, 'log file should not even be created');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('SubagentStop appends a done line paired to the newest open start line for that agent_type, seconds measured from its ts', () => {
  // Two open start lines for `implementer`: an older one (60 s ago) and the newest (5 s ago).
  // The newest is the pair, so id must be toolu_03new and seconds about 5, not 60.
  const olderAt = new Date(Date.now() - 60000).toISOString();
  const newestAt = new Date(Date.now() - 5000).toISOString();
  const older = { ts: olderAt, id: 'toolu_03old', agent: 'implementer', mission: 'Make test 2 pass', task: 'tasks/2026-10-16-agent-roster' };
  const newest = { ts: newestAt, id: 'toolu_03new', agent: 'implementer', mission: 'Make test 3 pass', task: 'tasks/2026-10-16-agent-roster' };
  seedLines([older, newest]);

  const r = run({
    hook_event_name: 'SubagentStop',
    session_id: 'sess_01',
    cwd: brain,
    agent_id: 'agent_01xyz',
    agent_type: 'implementer',
    stop_hook_active: false,
  });
  const lines = readLines();
  assert.equal(lines.length, 3, `expected the two seeded start lines plus one done line, got ${lines.length}; stderr: ${r.stderr}`);
  assert.deepEqual(lines[0], older, 'start lines must be left untouched');
  assert.deepEqual(lines[1], newest, 'start lines must be left untouched');
  const done = lines[2];
  assert.deepEqual(Object.keys(done).sort(), ['agent', 'done', 'id', 'seconds', 'ts']);
  assert.equal(done.id, 'toolu_03new', 'id must be copied from the newest open start line for this agent');
  assert.equal(done.agent, 'implementer');
  assert.equal(done.done, true);
  assert.equal(typeof done.seconds, 'number');
  assert.ok(done.seconds >= 4 && done.seconds <= 7, `seconds should be about 5 (gap from the newest start line), got ${done.seconds}`);
  const ts = Date.parse(done.ts);
  assert.ok(ts >= Date.parse(newestAt) + 4000 && ts <= Date.now() + 1000, `ts should be now-ish ISO, got ${done.ts}`);

  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('PostToolUse Agent appends nothing and exits 0 (done lines come from SubagentStop now)', () => {
  const seeded = { ts: new Date(Date.now() - 5000).toISOString(), id: 'toolu_04post', agent: 'implementer', mission: 'Make test 4 pass', task: 'tasks/2026-10-16-agent-roster' };
  seedLines([seeded]);

  const r = run({
    hook_event_name: 'PostToolUse',
    tool_name: 'Agent',
    tool_use_id: 'toolu_04post',
    cwd: brain,
    tool_input: {
      subagent_type: 'implementer',
      description: 'Make test 4 pass',
      prompt: 'Task folder: tasks/2026-10-16-agent-roster',
    },
    tool_response: { content: [{ type: 'text', text: 'done' }] },
  });
  assert.deepEqual(readLines(), [seeded], 'PostToolUse Agent must not append a done line');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('SubagentStop with no open start line for that agent_type appends nothing and exits 0', () => {
  // One start line for a different agent (open) and one for implementer that is already closed.
  const otherAgent = { ts: new Date(Date.now() - 9000).toISOString(), id: 'toolu_05rev', agent: 'reviewer', mission: 'Review', task: 'tasks/2026-10-16-agent-roster' };
  const closedStart = { ts: new Date(Date.now() - 8000).toISOString(), id: 'toolu_05impl', agent: 'implementer', mission: 'Make test 5 pass', task: 'tasks/2026-10-16-agent-roster' };
  const closedDone = { ts: new Date(Date.now() - 3000).toISOString(), id: 'toolu_05impl', agent: 'implementer', done: true, seconds: 5 };
  seedLines([otherAgent, closedStart, closedDone]);

  const r = run({
    hook_event_name: 'SubagentStop',
    session_id: 'sess_01',
    cwd: brain,
    agent_id: 'agent_05xyz',
    agent_type: 'implementer',
    stop_hook_active: false,
  });
  assert.deepEqual(readLines(), [otherAgent, closedStart, closedDone], 'no open start line for implementer, so nothing may be appended');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('empty or malformed stdin exits 0 and appends nothing', () => {
  for (const [label, stdin] of [['empty stdin', ''], ['non-JSON stdin', 'not json {{{']]) {
    const r = run(stdin);
    assert.equal(r.status, 0, `${label}: hook must never exit non-zero; stderr: ${r.stderr}`);
    assert.equal(r.stdout, '', `${label}: nothing on stdout`);
    assert.equal(fs.existsSync(path.join(brain, 'ui/dispatch.jsonl')), false, `${label}: log file should not be created`);
    assert.deepEqual(readLines(), [], `${label}: nothing appended to ui/dispatch.jsonl`);
  }
});
