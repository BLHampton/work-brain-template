const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const lib = require('./inbox-lib');

function brain() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-ui-'));
  fs.mkdirSync(path.join(root, 'tasks/2026-10-16-telemetry-signal-context'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tasks/2026-10-16-other'));
  fs.mkdirSync(path.join(root, 'templates'));
  fs.mkdirSync(path.join(root, 'repos'));
  fs.writeFileSync(path.join(root, 'templates/log.md'), '<!-- log.md · lead -->\n- <YYYY-MM-DD> — <decision>\n');
  return root;
}

test('safeTaskFolder accepts dated slugs and rejects traversal', () => {
  assert.equal(lib.safeTaskFolder('2026-10-16-telemetry-signal-context'), '2026-10-16-telemetry-signal-context');
  for (const bad of ['../x', '2026-10-16-../x', '2026-10-16-Telemetry', 'tasks/2026-10-16-x', '', null]) {
    assert.equal(lib.safeTaskFolder(bad), null, String(bad));
  }
});

test('repoForTask matches the brief against repos/*.json', () => {
  const root = brain();
  fs.writeFileSync(path.join(root, 'repos/web-app.json'), JSON.stringify({ name: 'Web-App', path: '/r/Web-App' }));
  fs.writeFileSync(path.join(root, 'repos/svc-orders-api.json'), JSON.stringify({ name: 'svc.orders-api', path: '/r/svc.orders-api' }));
  const brief = path.join(root, 'tasks/2026-10-16-telemetry-signal-context/brief.md');
  fs.writeFileSync(brief, '## Repo + branch\n\nWeb-App · `feat/telemetry-signal-context`\n');
  assert.deepEqual(lib.repoForTask(root, '2026-10-16-telemetry-signal-context'), { name: 'web-app', path: '/r/Web-App' });
  fs.writeFileSync(brief, '## Repo\n\nnothing recognisable\n');
  assert.equal(lib.repoForTask(root, '2026-10-16-telemetry-signal-context'), null);
  assert.equal(lib.repoForTask(root, '2026-10-16-other'), null, 'no brief');
  fs.unlinkSync(path.join(root, 'repos/svc-orders-api.json'));
  assert.deepEqual(lib.repoForTask(root, '2026-10-16-telemetry-signal-context'), { name: 'web-app', path: '/r/Web-App' }, 'single repo fallback');
});

test('repoForTask prefers the repo named under "## Repo + branch" over earlier mentions', () => {
  const root = brain();
  fs.writeFileSync(path.join(root, 'repos/storefront.json'), JSON.stringify({ name: 'storefront', path: '/r/storefront' }));
  fs.writeFileSync(path.join(root, 'repos/billing.json'), JSON.stringify({ name: 'Billing', path: '/r/billing' }));
  const brief = path.join(root, 'tasks/2026-10-16-telemetry-signal-context/brief.md');
  fs.writeFileSync(brief, '## Goal\n\nStop Storefront from double-sending.\n\n## Repo + branch\n\nBilling · `feature/x`\n');
  assert.deepEqual(lib.repoForTask(root, '2026-10-16-telemetry-signal-context'), { name: 'billing', path: '/r/billing' });
});

test('repoForTask returns the "## Repo + branch" repo when an earlier-mentioned repo\'s name is a substring of it', () => {
  const root = brain();
  // queue.json sorts before svc.queue-tasks.json and "queue" is a substring of "svc.queue-tasks".
  fs.writeFileSync(path.join(root, 'repos/queue.json'), JSON.stringify({ name: 'queue', path: '/r/queue' }));
  fs.writeFileSync(path.join(root, 'repos/svc.queue-tasks.json'), JSON.stringify({ name: 'svc.queue-tasks', path: '/r/svc.queue-tasks' }));
  const brief = path.join(root, 'tasks/2026-10-16-telemetry-signal-context/brief.md');
  fs.writeFileSync(brief, '## Goal\n\nPort the retry loop from queue.\n\n## Out of scope\n\nThe queue UI.\n\n## Repo + branch\n\nsvc.queue-tasks · `feature/x`\n');
  assert.deepEqual(lib.repoForTask(root, '2026-10-16-telemetry-signal-context'), { name: 'svc.queue-tasks', path: '/r/svc.queue-tasks' });
});


test('appendLog starts a task log from the template header, appends a line, and refuses a bad folder', () => {
  const root = brain();
  const log = path.join(root, 'tasks/2026-10-16-telemetry-signal-context/log.md');
  lib.appendLog(root, '2026-10-16-telemetry-signal-context', '- 2026-10-16 — card: Keep? → Keep');
  assert.equal(fs.readFileSync(log, 'utf8'), '<!-- log.md · lead -->\n- 2026-10-16 — card: Keep? → Keep\n');
  lib.appendLog(root, '2026-10-16-telemetry-signal-context', '- 2026-10-17 — second');
  assert.equal(fs.readFileSync(log, 'utf8').split('\n').length, 4);
  assert.throws(() => lib.appendLog(root, '../x', 'nope'), /bad task folder/);
});

test('parkItems / restoreItems / dropItems only write status.json: parked, not parked, done + dropped', () => {
  const root = brain();
  const folder = '2026-10-16-telemetry-signal-context';
  const statusPath = path.join(root, 'tasks', folder, 'status.json');
  const readStatus = () => JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  fs.writeFileSync(statusPath, JSON.stringify({ card: 'TICKET-1', folder: `tasks/${folder}`, lane: 'standard', stage: 'tdd' }, null, 2));

  const parked = lib.parkItems(root, folder);
  assert.equal(parked.parked, true);
  assert.equal(parked.stage, 'tdd', 'park keeps the stage');
  assert.deepEqual(readStatus(), parked, 'returns the status it wrote');
  const restored = lib.restoreItems(root, folder);
  assert.equal(restored.parked, false);
  assert.equal(restored.stage, 'tdd');
  assert.deepEqual(readStatus(), restored);
  const dropped = lib.dropItems(root, folder, '2026-10-30');
  assert.equal(dropped.stage, 'done');
  assert.equal(dropped.dropped, '2026-10-30');
  assert.deepEqual(readStatus(), dropped);
  assert.deepEqual(fs.readdirSync(root).sort(), ['repos', 'tasks', 'templates'], 'nothing else is written at the root');
});
