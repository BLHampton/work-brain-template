const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const SCRIPT = path.join(__dirname, 'ask_guard.py');
function run(input, env = {}) {
  const r = spawnSync('python3', [SCRIPT], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, ASK_GUARD: '', ...env } });
  return { status: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout) : null };
}
const stop = (msg, extra = {}) => ({ hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: msg, ...extra });

test('a turn ending in a question is blocked once with a reason that names question.md and bin/card ask', () => {
  const r = run(stop('Card is at the diff gate.\n\nShould I keep the old date format?'));
  assert.equal(r.status, 0);
  assert.equal(r.out.decision, 'block');
  assert.match(r.out.reason, /question\.md/);
  assert.match(r.out.reason, /bin\/card ask/);
});

test('it allows a plain stop, a repeat stop (stop_hook_active), a question only inside a code block, and ASK_GUARD=off', () => {
  assert.equal(run(stop('Listening for stamps.')).out, null);
  assert.equal(run(stop('Any objections?', { stop_hook_active: true })).out, null);
  assert.equal(run(stop('Run this:\n```\necho "ready?"\n```\nDone.')).out, null);
  assert.equal(run(stop('Ready?'), { ASK_GUARD: 'off' }).out, null);
});
