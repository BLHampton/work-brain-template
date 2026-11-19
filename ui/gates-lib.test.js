const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { lock, check } = require('./gates-lib');

function card() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'ui'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tasks', 'x'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'ui', 'a.test.js'), 'a');
  fs.writeFileSync(path.join(repo, 'ui', 'b.test.js'), 'b');
  fs.writeFileSync(path.join(root, 'tasks', 'x', 'status.json'), JSON.stringify({ repo }));
  fs.writeFileSync(path.join(root, 'tasks', 'x', 'gates.txt'), 'ui/a.test.js\nui/b.test.js\n');
  return { root, repo };
}

test('lock hashes every gates.txt file; check passes until a gate changes or disappears, then names it', () => {
  const { root, repo } = card();
  assert.equal(lock(root, 'tasks/x'), 2);
  assert.deepEqual(check(root, 'tasks/x'), []);
  fs.writeFileSync(path.join(repo, 'ui', 'a.test.js'), 'a changed');
  fs.rmSync(path.join(repo, 'ui', 'b.test.js'));
  assert.deepEqual(check(root, 'tasks/x'), ['ui/a.test.js', 'ui/b.test.js']);
});

test('check with no gates.lock yet reports every listed gate as changed; no gates.txt means nothing to check', () => {
  const { root } = card();
  assert.deepEqual(check(root, 'tasks/x'), ['ui/a.test.js', 'ui/b.test.js']);
  fs.rmSync(path.join(root, 'tasks', 'x', 'gates.txt'));
  assert.equal(lock(root, 'tasks/x'), 0);
  assert.deepEqual(check(root, 'tasks/x'), []);
});
