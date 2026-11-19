const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const lib = require('./board-lib');

const TASK_LOG =
  '# Task log\n' +
  '\n' +
  '`date | ticket | what | lane | status` — status: in-progress · pr-open · merged · deployed · dropped. Only `deployed` = shipped.\n' +
  '\n' +
  '2026-10-16 | none | Telemetry: user/BU/version meta on every signal | standard | in-progress\n' +
  '2026-10-17 | TICKET-812 | Rate limiter returns 429 per API key | quick | pr-open\n';

test('parseTaskLog turns each task-log row into { date, ticket, what, lane, status } and skips the header, legend and blank lines', () => {
  assert.deepEqual(lib.parseTaskLog(TASK_LOG), [
    { date: '2026-10-16', ticket: 'none', what: 'Telemetry: user/BU/version meta on every signal', lane: 'standard', status: 'in-progress' },
    { date: '2026-10-17', ticket: 'TICKET-812', what: 'Rate limiter returns 429 per API key', lane: 'quick', status: 'pr-open' },
  ]);
});

function brainWithTasks(folders, files = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'board-ui-'));
  for (const f of folders) fs.mkdirSync(path.join(root, 'tasks', f), { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(root, 'tasks', f), '');
  return root;
}

test('folderForDate returns the only tasks/<date>-* folder for a date, and null when there are none, more than one, or only a stray file', () => {
  const root = brainWithTasks(
    ['2026-10-16-brain-board', '2026-10-17-rate-limiter', '2026-10-17-telemetry-signal'],
    ['2026-10-18-notes.md'],
  );
  assert.equal(lib.folderForDate(root, '2026-10-16'), 'tasks/2026-10-16-brain-board');
  assert.equal(lib.folderForDate(root, '2026-10-17'), null);
  assert.equal(lib.folderForDate(root, '2026-10-15'), null);
  assert.equal(lib.folderForDate(root, '2026-10-18'), null);
});

test('reviewed cards land in their own section: parseTaskLog keeps a reviewed row, sectionFor maps review/research lanes to "Reviews & research" and the rest to "Our cards"', () => {
  const reviewedRow = lib.parseTaskLog('2026-10-29 | TICKET-41370 | PR review: status keys null checks | review | reviewed\n');
  assert.deepEqual(reviewedRow, [
    { date: '2026-10-29', ticket: 'TICKET-41370', what: 'PR review: status keys null checks', lane: 'review', status: 'reviewed' },
  ]);
  assert.equal(lib.sectionFor('review'), 'Reviews & research');
  assert.equal(lib.sectionFor('research'), 'Reviews & research');
  assert.equal(lib.sectionFor('standard'), 'Our cards');
  assert.equal(lib.sectionFor('quick'), 'Our cards');
});
