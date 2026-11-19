const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, 'role-guard.js');
const WS_PATTERNS = [
  '\\.spec\\.ts$', '/src/test-setup\\.ts$', '/testing/', '/__mocks__/', '/__snapshots__/',
  '\\.(fixtures|mock)\\.ts$', '^apps/[^/]+-e2e/', '^cypress/',
];

let brain;
before(() => {
  brain = fs.mkdtempSync(path.join(os.tmpdir(), 'role-guard-'));
  for (const d of ['repos', 'tasks', 'ws', 'api']) fs.mkdirSync(path.join(brain, d));
  fs.writeFileSync(path.join(brain, 'repos/ws.json'),
    JSON.stringify({ name: 'Web-App', path: path.join(brain, 'ws'), testPatterns: WS_PATTERNS }));
  fs.writeFileSync(path.join(brain, 'repos/api.json'),
    JSON.stringify({ name: 'orders-api', path: path.join(brain, 'api'), testPatterns: ['^test/'] }));
});

function run(role, input) {
  const args = role === undefined ? [] : ['--role', role];
  const stdin = typeof input === 'string' ? input : JSON.stringify(input);
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    input: stdin, encoding: 'utf8', env: { ...process.env, WORK_BRAIN_ROOT: brain },
  });
  return { status: r.status, stderr: r.stderr.trim(), stdout: r.stdout };
}
const edit = (role, file, extra = {}) =>
  run(role, { tool_name: 'Edit', tool_input: { file_path: file }, cwd: brain, ...extra });
const inBrain = (p) => path.join(brain, p);

const cases = [
  ['test-writer', 'ws/libs/x/y.spec.ts', 0],
  ['test-writer', 'ws/libs/x/y.ts', 2],
  ['test-writer', 'ws/libs/x/testing/helper.ts', 0],
  ['implementer', 'ws/libs/x/y.spec.ts', 2],
  ['implementer', 'ws/libs/x/y.ts', 0],
  ['implementer', 'ws/apps/foo-e2e/src/a.ts', 2],
  ['implementer', 'api/test/Foo/BarTests.cs', 2],
  ['implementer', 'api/src/Foo.cs', 0],
  ['test-writer', 'api/src/Foo.cs', 2],
  ['test-writer', 'tasks/2026-10-16-x/plan.md', 0],
  ['implementer', 'tasks/2026-10-16-x/plan.md', 0],
];
for (const [role, rel, expected] of cases) {
  test(`${role} + ${rel} -> exit ${expected}`, () => {
    const r = edit(role, inBrain(rel));
    assert.equal(r.status, expected, r.stderr);
    assert.equal(r.stdout, '');
    if (expected === 2) assert.match(r.stderr, /^role-guard: /);
    else assert.equal(r.stderr, '');
  });
}

test('block reason names the role and the offending path', () => {
  const r = edit('test-writer', inBrain('ws/libs/x/y.ts'));
  assert.match(r.stderr, /test-writer may only edit test files/);
  assert.match(r.stderr, /Web-App/);
  assert.match(r.stderr, /libs\/x\/y\.ts$/);
});

test('implementer + path outside every repo -> block', () => {
  const r = edit('implementer', '/somewhere/else/file.ts');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /outside every known repo and the task folder/);
});

test('NotebookEdit honors notebook_path', () => {
  const r = run('implementer', {
    tool_name: 'NotebookEdit', tool_input: { notebook_path: inBrain('ws/libs/x/y.spec.ts') }, cwd: brain,
  });
  assert.equal(r.status, 2);
});

test('Write and MultiEdit are guarded too', () => {
  for (const tool_name of ['Write', 'MultiEdit']) {
    const r = run('implementer', { tool_name, tool_input: { file_path: inBrain('ws/libs/x/y.spec.ts') }, cwd: brain });
    assert.equal(r.status, 2, tool_name);
  }
});

test('tool_name Bash -> allow', () => {
  const r = run('test-writer', { tool_name: 'Bash', tool_input: { command: 'rm -rf x' }, cwd: brain });
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
});

test('relative file_path resolves against cwd', () => {
  const r = run('test-writer', { tool_name: 'Edit', tool_input: { file_path: 'libs/x/y.ts' }, cwd: inBrain('ws') });
  assert.equal(r.status, 2);
  const ok = run('test-writer', { tool_name: 'Edit', tool_input: { file_path: 'libs/x/y.spec.ts' }, cwd: inBrain('ws') });
  assert.equal(ok.status, 0);
});

test('missing --role exits 2', () => {
  const r = run(undefined, { tool_name: 'Edit', tool_input: { file_path: inBrain('ws/a.ts') }, cwd: brain });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /role/);
});

test('unknown --role exits 2', () => {
  const r = edit('janitor', inBrain('ws/a.ts'));
  assert.equal(r.status, 2);
});

test('malformed stdin JSON exits 0 with a warning', () => {
  const r = run('implementer', '{not json');
  assert.equal(r.status, 0);
  assert.match(r.stderr, /role-guard: warning/);
});

test('missing repos dir exits 0 with a warning', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'role-guard-empty-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--role', 'implementer'], {
    input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: '/x/y.ts' }, cwd: empty }),
    encoding: 'utf8', env: { ...process.env, WORK_BRAIN_ROOT: empty },
  });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /role-guard: warning/);
});
