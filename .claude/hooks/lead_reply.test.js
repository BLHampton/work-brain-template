const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, 'lead_reply.py');
const GUARD = path.join(__dirname, 'ask_guard.py');

function brain() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-reply-'));
  fs.mkdirSync(path.join(root, 'tasks', '2026-01-02-sample'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tasks', '2026-01-02-sample', 'card.json'), JSON.stringify({ title: 'TICKET-123 sample card' }));
  return root;
}
function run(script, input, env) {
  const r = spawnSync('python3', [script], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env: { ...process.env, ASK_GUARD: '', CARD: '', ...env } });
  return { status: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout) : null, err: r.stderr };
}
const stop = (msg) => ({ hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: msg });
const thread = (root) => path.join(root, 'tasks', '2026-01-02-sample', 'threads', 'card.md');

test('with no CARD set the hook writes nothing', () => {
  const root = brain();
  const r = run(SCRIPT, stop('hi'), { CLAUDE_PROJECT_DIR: root });
  assert.equal(r.status, 0);
  assert.equal(fs.existsSync(thread(root)), false);
});

test('with CARD set it appends one lead line, newlines to spaces, under the card title header', () => {
  const root = brain();
  const r = run(SCRIPT, stop('It is waiting on review.\n\nSee brief.md line 4.'), { CLAUDE_PROJECT_DIR: root, CARD: 'tasks/2026-01-02-sample' });
  assert.equal(r.status, 0);
  assert.equal(r.err, '');
  const text = fs.readFileSync(thread(root), 'utf8');
  assert.match(text, /^# Thread · TICKET-123 sample card\n\n- \d{4}-\d{2}-\d{2} \d{2}:\d{2} — lead: It is waiting on review\. See brief\.md line 4\.\n$/);
  run(SCRIPT, stop('Second.'), { CLAUDE_PROJECT_DIR: root, CARD: 'tasks/2026-01-02-sample' });
  assert.equal(fs.readFileSync(thread(root), 'utf8').match(/— lead:/g).length, 2);
});

test('a CARD outside the task-folder pattern, an empty message or bad input writes nothing and exits 0', () => {
  const root = brain();
  assert.equal(run(SCRIPT, stop('x'), { CLAUDE_PROJECT_DIR: root, CARD: '../../etc' }).status, 0);
  assert.equal(run(SCRIPT, stop('x'), { CLAUDE_PROJECT_DIR: root, CARD: 'tasks/2026-01-02-sample/../../x' }).status, 0);
  assert.equal(run(SCRIPT, stop('   '), { CLAUDE_PROJECT_DIR: root, CARD: 'tasks/2026-01-02-sample' }).status, 0);
  assert.equal(run(SCRIPT, '{not json', { CLAUDE_PROJECT_DIR: root, CARD: 'tasks/2026-01-02-sample' }).status, 0);
  assert.equal(run(SCRIPT, stop('x'), { CLAUDE_PROJECT_DIR: root, CARD: 'tasks/2026-01-09-missing' }).status, 0);
  assert.equal(fs.existsSync(thread(root)), false);
  assert.equal(fs.existsSync(path.join(root, 'tasks', '2026-01-09-missing')), false);
});

test('ask_guard lets a lead (CARD set) end its turn on a question', () => {
  assert.equal(run(GUARD, stop('Which date format should it keep?'), { CARD: 'tasks/2026-01-02-sample' }).out, null);
  assert.equal(run(GUARD, stop('Which date format should it keep?'), {}).out.decision, 'block');
});
