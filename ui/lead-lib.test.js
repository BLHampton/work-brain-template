const test = require('node:test');
const assert = require('node:assert/strict');
const { findLead, listLeads, startLead, promptLead, closeLead, focusLead, leadState } = require('./lead-lib');

const SESSION = '9d810f02-3eae-4894-bdc4-cc2fb1c4e239';
const ok = (result) => ({ stdout: JSON.stringify({ id: 'cli', result }), status: 0 });
const agent = (pane, session, status) => ({ agent: 'claude', agent_session: { kind: 'id', value: session }, agent_status: status, pane_id: pane });

// A fake herdr: records every argument array, answers from `replies` by the first two words of the command.
function fake(replies = {}) {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    const reply = replies[args.slice(0, 2).join(' ')];
    return typeof reply === 'function' ? reply(args) : reply ?? ok({ type: 'ok' });
  };
  return { run, calls };
}

const list = (...agents) => ({ 'agent list': ok({ type: 'agent_list', agents }) });

test('findLead picks the agent whose session id matches; no match is null', () => {
  const { run } = fake(list(agent('w1:p1', 'other', 'working'), agent('w13:p2', SESSION, 'done')));
  assert.deepEqual(findLead(run, SESSION), { pane_id: 'w13:p2', agent_status: 'done' });
  assert.equal(findLead(run, 'nobody'), null);
});

test('a herdr failure throws with herdr\'s own message', () => {
  const { run } = fake({ 'agent list': { stdout: JSON.stringify({ error: { code: 'x', message: 'server not running' } }), status: 1 } });
  assert.throws(() => findLead(run, SESSION), /server not running/);
});

const startReplies = (workspaces) => ({
  'workspace list': ok({ type: 'workspace_list', workspaces }),
  'workspace create': ok({ type: 'workspace_created', workspace: { workspace_id: 'w13', label: 'leads' } }),
  'tab create': ok({ type: 'tab_created', root_pane: { pane_id: 'w13:p2' } }),
  'agent start': ok({ type: 'agent_started' }),
});
const opts = { root: '/brain', folder: '2026-01-02-sample', repo: '/repos/sample', session: SESSION, title: 'TICKET-123 sample card' };

test('startLead creates the leads workspace only when no workspace has that label', () => {
  const none = fake(startReplies([{ workspace_id: 'w1', label: 'Dispatch' }]));
  assert.deepEqual(startLead(none.run, opts), { pane_id: 'w13:p2' });
  assert.deepEqual(none.calls.find((a) => a[1] === 'create' && a[0] === 'workspace'), ['workspace', 'create', '--label', 'leads', '--cwd', '/brain', '--no-focus']);

  const has = fake(startReplies([{ workspace_id: 'w9', label: 'leads' }]));
  startLead(has.run, opts);
  assert.equal(has.calls.some((a) => a[0] === 'workspace' && a[1] === 'create'), false);
  assert.deepEqual(has.calls.find((a) => a[0] === 'tab').slice(0, 4), ['tab', 'create', '--workspace', 'w9']);
});

test('startLead opens a tab named after the card with CARD=tasks/<folder> as one --env argument, then starts claude in it', () => {
  const { run, calls } = fake(startReplies([{ workspace_id: 'w9', label: 'leads' }]));
  startLead(run, { ...opts, title: 'x'.repeat(60) });
  const tab = calls.find((a) => a[0] === 'tab');
  assert.deepEqual(tab, ['tab', 'create', '--workspace', 'w9', '--cwd', '/brain', '--label', 'x'.repeat(40), '--env', 'CARD=tasks/2026-01-02-sample', '--no-focus']);
  const start = calls.find((a) => a[0] === 'agent' && a[1] === 'start');
  assert.deepEqual(start.slice(0, 8), ['agent', 'start', 'lead-2026-01-02-sample', '--kind', 'claude', '--pane', 'w13:p2', '--']);
  const claude = start.slice(8);
  assert.deepEqual(claude.slice(0, 2), ['--session-id', SESSION]);
  assert.deepEqual(claude.slice(claude.indexOf('--add-dir'), claude.indexOf('--add-dir') + 2), ['--add-dir', '/repos/sample']);
  assert.equal(claude[claude.indexOf('--append-system-prompt-file') + 1], '/brain/templates/lead.md');
  assert.equal(claude[claude.indexOf('--permission-mode') + 1], 'auto');
  assert.equal(claude[claude.indexOf('--model') + 1], 'opus');
  assert.deepEqual(claude.slice(claude.indexOf('--disallowedTools') + 1), ['Edit', 'Write', 'NotebookEdit', 'Agent', 'Bash(git commit:*)', 'Bash(git push:*)', 'Bash(gh pr:*)']);
  assert.ok(claude.includes('Bash(node bin/card assume:*)'));
  
});

test('startLead passes --resume when asked and no --add-dir when the task has no repo', () => {
  const { run, calls } = fake(startReplies([{ workspace_id: 'w9', label: 'leads' }]));
  startLead(run, { ...opts, repo: null, resume: true });
  const claude = calls.find((a) => a[0] === 'agent' && a[1] === 'start').slice(8);
  assert.deepEqual(claude.slice(0, 2), ['--resume', SESSION]);
  assert.equal(claude.includes('--add-dir'), false);
});

test('a failed agent start closes the pane it opened and throws herdr\'s message', () => {
  const { run, calls } = fake({ ...startReplies([{ workspace_id: 'w9', label: 'leads' }]), 'agent start': { stdout: JSON.stringify({ error: { message: 'agent did not become ready' } }), status: 1 } });
  assert.throws(() => startLead(run, opts), /agent did not become ready/);
  assert.deepEqual(calls.at(-1), ['pane', 'close', 'w13:p2']);
});

test('promptLead passes the text as one unchanged argument and throws on a non-zero exit', () => {
  const text = 'why? "; rm -rf ~ $(x)';
  const { run, calls } = fake();
  promptLead(run, 'w13:p2', text);
  assert.deepEqual(calls, [['agent', 'prompt', 'w13:p2', text, '--wait', '--until', 'working', '--timeout', '20000']]);
  // herdr takes the text only right after the target, refuses `--`, and parses a text equal to one of its flags as that flag
  const dashed = fake();
  promptLead(dashed.run, 'w13:p2', '--help');
  assert.deepEqual(dashed.calls[0].slice(0, 4), ['agent', 'prompt', 'w13:p2', '› --help']);
  const failing = fake({ 'agent prompt': { stdout: '', stderr: 'no such pane', status: 1 } });
  assert.throws(() => promptLead(failing.run, 'w13:p2', 'hi'), /no such pane/);
});

test('closeLead closes the pane', () => {
  const { run, calls } = fake();
  closeLead(run, 'w13:p2');
  assert.deepEqual(calls, [['pane', 'close', 'w13:p2']]);
});

test('leadState: working is replying, blocked is waiting on you, any other live status is idle, no pane or no herdr is none', () => {
  const state = (status) => leadState(fake(list(agent('w13:p2', SESSION, status))).run, SESSION);
  assert.equal(state('working'), 'replying');
  assert.equal(state('blocked'), 'waiting on you');
  assert.equal(state('done'), 'idle');
  assert.equal(state('idle'), 'idle');
  assert.equal(leadState(fake(list()).run, SESSION), 'none');
  assert.equal(leadState(fake({ 'agent list': { stdout: '', stderr: 'connect failed', status: 1 } }).run, SESSION), 'none');
  assert.equal(leadState(fake().run, null), 'none');
});

test('focusLead focuses the pane and throws herdr\'s message on a non-zero exit', () => {
  const { run, calls } = fake();
  focusLead(run, 'w13:p2');
  assert.deepEqual(calls, [['agent', 'focus', 'w13:p2']]);
  assert.throws(() => focusLead(fake({ 'agent focus': { stdout: '', stderr: 'pane gone', status: 1 } }).run, 'w13:p2'), /pane gone/);
});

test('listLeads makes one agent list call and gives session, pane and status for each', () => {
  const { run, calls } = fake(list(agent('w1:p1', 'a', 'working'), agent('w1:p2', 'b', 'done')));
  assert.deepEqual(listLeads(run), [{ session: 'a', pane_id: 'w1:p1', agent_status: 'working' }, { session: 'b', pane_id: 'w1:p2', agent_status: 'done' }]);
  assert.equal(calls.length, 1);
});

test('startLead keeps the agent name within herdr\'s 32 characters for a long folder, unique by session', () => {
  const { run, calls } = fake(startReplies([{ workspace_id: 'w9', label: 'leads' }]));
  startLead(run, { ...opts, folder: '2026-01-02-a-very-long-sample-folder-name' });
  const name = calls.find((a) => a[0] === 'agent' && a[1] === 'start')[2];
  assert.equal(name, `lead-2026-01-02-a-very--${SESSION.slice(0, 8)}`);
  assert.equal(name.length, 32);
});
