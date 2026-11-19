const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BRAIN = path.resolve(__dirname, '..');
const CLI = path.join(BRAIN, 'bin', 'dispatch');

const ROWS = [
  { ts: '2026-11-02T09:50:00.000Z', id: 'toolu_old', agent: 'implementer', mission: 'older, no done row', task: 'tasks/2026-11-02-brain-agent-stats' },
  { ts: '2026-11-02T09:57:30.000Z', id: 'toolu_new', agent: 'implementer', mission: 'newest open', task: 'tasks/2026-11-02-brain-agent-stats' },
  { ts: '2026-11-02T09:58:00.000Z', id: 'toolu_rev', agent: 'reviewer', mission: 'review the diff', task: 'tasks/2026-11-02-brain-agent-stats' },
  { ts: '2026-11-02T09:59:00.000Z', id: 'toolu_rev', agent: 'reviewer', done: true, seconds: 60 },
];

function brain() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-cli-'));
  fs.mkdirSync(path.join(root, 'ui'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ui/dispatch.jsonl'), ROWS.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return root;
}

function done(root, agent) {
  return spawnSync(process.execPath, [CLI, 'done', agent], { cwd: BRAIN, env: { ...process.env, WORK_BRAIN_ROOT: root }, encoding: 'utf8' });
}

const readRows = (root) => fs.readFileSync(path.join(root, 'ui/dispatch.jsonl'), 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l));

test('bin/dispatch done <agent> appends the done row for the newest open start under WORK_BRAIN_ROOT and exits 0; with no open start it appends nothing and exits 0', () => {
  const root = brain();
  const before = Date.now();
  const closed = done(root, 'implementer');
  assert.equal(closed.status, 0, `exit code with an open start: ${closed.stderr}`);
  const rows = readRows(root);
  assert.equal(rows.length, ROWS.length + 1, 'exactly one row appended');
  assert.deepEqual(rows.slice(0, ROWS.length), ROWS, 'fixture rows untouched');
  const appended = rows.at(-1);
  assert.deepEqual(Object.keys(appended).sort(), ['agent', 'done', 'id', 'seconds', 'ts']);
  assert.deepEqual({ id: appended.id, agent: appended.agent, done: appended.done }, { id: 'toolu_new', agent: 'implementer', done: true });
  assert.ok(Date.parse(appended.ts) >= before - 1000 && Date.parse(appended.ts) <= Date.now() + 1000, `ts is now: ${appended.ts}`);
  assert.equal(appended.seconds, Math.round((Date.parse(appended.ts) - Date.parse('2026-11-02T09:57:30.000Z')) / 1000), 'seconds = ts - start');

  const after = fs.readFileSync(path.join(root, 'ui/dispatch.jsonl'), 'utf8');
  for (const agent of ['reviewer', 'qa']) {
    const noop = done(root, agent);
    assert.equal(noop.status, 0, `exit code with no open start for ${agent}: ${noop.stderr}`);
    assert.equal(fs.readFileSync(path.join(root, 'ui/dispatch.jsonl'), 'utf8'), after, `file unchanged after done ${agent}`);
  }
});

const TWO_TASKS = [
  { ts: '2026-11-02T11:00:00.000Z', id: 'toolu_tdd_impl', agent: 'implementer', mission: 'make test 2b green', task: 'tasks/2026-11-02-brain-agent-stats' },
  { ts: '2026-11-02T11:05:00.000Z', id: 'toolu_other_impl', agent: 'implementer', mission: 'quick-lane fix', task: 'tasks/2026-11-02-other-card' },
  { ts: '2026-11-02T11:06:00.000Z', id: 'toolu_tw', agent: 'test-writer', mission: 'write test 3', task: 'tasks/2026-11-02-brain-agent-stats' },
];

function doneArgs(root, args) {
  return spawnSync(process.execPath, [CLI, 'done', ...args], { cwd: BRAIN, env: { ...process.env, WORK_BRAIN_ROOT: root }, encoding: 'utf8' });
}

test('bin/dispatch done <agent> --task <folder> closes the newest open start of that agent on that task, not a newer open start of the same agent on another task', () => {
  const root = brain();
  fs.writeFileSync(path.join(root, 'ui/dispatch.jsonl'), TWO_TASKS.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const closed = doneArgs(root, ['implementer', '--task', 'tasks/2026-11-02-brain-agent-stats']);
  assert.equal(closed.status, 0, `exit code with --task: ${closed.stderr}`);
  const rows = readRows(root);
  assert.equal(rows.length, TWO_TASKS.length + 1, 'exactly one row appended');
  assert.deepEqual(rows.slice(0, TWO_TASKS.length), TWO_TASKS, 'fixture rows untouched');
  const appended = rows.at(-1);
  assert.deepEqual(Object.keys(appended).sort(), ['agent', 'done', 'id', 'seconds', 'ts']);
  assert.deepEqual({ id: appended.id, agent: appended.agent, done: appended.done }, { id: 'toolu_tdd_impl', agent: 'implementer', done: true });
  assert.equal(appended.seconds, Math.round((Date.parse(appended.ts) - Date.parse('2026-11-02T11:00:00.000Z')) / 1000), 'seconds = ts - start of the task-matched start');

  const after = fs.readFileSync(path.join(root, 'ui/dispatch.jsonl'), 'utf8');
  const noop = doneArgs(root, ['implementer', '--task', 'tasks/2026-11-02-no-such-card']);
  assert.equal(noop.status, 0, `exit code with --task and no open start on that folder: ${noop.stderr}`);
  assert.equal(fs.readFileSync(path.join(root, 'ui/dispatch.jsonl'), 'utf8'), after, 'file unchanged when no open start matches the task');
});
