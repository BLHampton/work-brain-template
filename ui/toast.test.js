const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const toast = require('./toast');

function recorder() {
  const calls = [];
  const spawn = (cmd, args) => { calls.push({ cmd, args }); return { on() { return this; }, unref() {} }; };
  return { calls, spawn };
}
const row = (folder, state, title = `TICKET-123 · ${folder}`) => ({ folder, state, title });

test('the first tick only remembers: a card already needing the manager at server start does not toast', () => {
  const { calls, spawn } = recorder();
  const notify = toast.needsYouNotifier({ spawn, log: () => {} });
  notify([row('2026-01-02-sample', 'needs you'), row('2026-01-03-other', 'working')]);
  assert.equal(calls.length, 0);
});

test('a card moving from working to needs you toasts once via powershell.exe titled "work-brain: needs you"; staying there does not toast again', () => {
  const { calls, spawn } = recorder();
  const notify = toast.needsYouNotifier({ spawn, log: () => {} });
  notify([row('2026-01-02-sample', 'working'), row('2026-01-03-other', 'needs you')]);
  notify([row('2026-01-02-sample', 'needs you'), row('2026-01-03-other', 'needs you')]);
  assert.equal(calls.length, 1, 'only the card that changed state toasts');
  assert.equal(calls[0].cmd, 'powershell.exe');
  const joined = calls[0].args.join(' ');
  assert.ok(joined.includes('work-brain: needs you'), 'toast title');
  assert.ok(joined.includes('TICKET-123 · 2026-01-02-sample'), 'toast body is the card title');
  notify([row('2026-01-02-sample', 'needs you'), row('2026-01-03-other', 'needs you')]);
  assert.equal(calls.length, 1, 'still needing him is not new');
});

test('a card that leaves needs you and comes back toasts again; a brand-new card arriving in needs you toasts', () => {
  const { calls, spawn } = recorder();
  const notify = toast.needsYouNotifier({ spawn, log: () => {} });
  notify([row('2026-01-02-sample', 'needs you')]);
  notify([row('2026-01-02-sample', 'working')]);
  notify([row('2026-01-02-sample', 'needs you'), row('2026-01-04-new', 'needs you')]);
  assert.equal(calls.length, 2);
});

test('a card title with a quote is escaped for PowerShell and cut to 120 chars', () => {
  const { calls, spawn } = recorder();
  const notify = toast.needsYouNotifier({ spawn, log: () => {} });
  notify([]);
  notify([row('2026-01-02-sample', 'needs you', `it's ${'x'.repeat(200)}`)]);
  const joined = calls[0].args.join(' ');
  assert.ok(joined.includes("it''s"), 'single quote doubled');
  assert.ok(!joined.includes('x'.repeat(120)), 'title cut to 120 chars');
});

test('a throwing spawn or one that emits error later is logged, never fatal', async () => {
  const logged = [];
  const log = (m) => logged.push(String(m));
  const throwing = toast.needsYouNotifier({ spawn: () => { throw new Error('no interop'); }, log });
  throwing([]);
  assert.doesNotThrow(() => throwing([row('2026-01-02-sample', 'needs you')]));
  assert.ok(logged[0].includes('no interop'));
  const spawn = () => {
    const child = new EventEmitter();
    child.unref = () => {};
    setImmediate(() => child.emit('error', new Error('spawn powershell.exe EACCES')));
    return child;
  };
  const later = toast.needsYouNotifier({ spawn, log });
  later([]);
  later([row('2026-01-02-sample', 'needs you')]);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(logged.length, 2);
  assert.ok(logged[1].includes('EACCES'));
});
