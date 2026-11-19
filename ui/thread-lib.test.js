const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const lib = require('./thread-lib');

test('appendLine creates the file with a header quoting the card text then the line, appends only the line on a second write, and collapses newlines in text to spaces', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thread-lib-'));
  const file = path.join(root, 'tasks/2026-10-19-card-threads/threads/a1b2c3d4.md');
  const card = { id: 'a1b2c3d4', tag: 'BLOCKING', task: 'tasks/2026-10-19-card-threads', text: 'Ticket says X but code assumes Y. Which?' };

  lib.appendLine(file, { who: 'lead', text: 'Is X the v1 shape\nor the v2 one?', card }, new Date(2026, 9, 19, 14, 5));
  assert.equal(
    fs.readFileSync(file, 'utf8'),
    '# Thread · Ticket says X but code assumes Y. Which?\n\n- 2026-10-19 14:05 — lead: Is X the v1 shape or the v2 one?\n'
  );

  lib.appendLine(file, { who: 'Manager', text: 'v2', card }, new Date(2026, 9, 19, 14, 7));
  assert.equal(
    fs.readFileSync(file, 'utf8'),
    '# Thread · Ticket says X but code assumes Y. Which?\n\n- 2026-10-19 14:05 — lead: Is X the v1 shape or the v2 one?\n- 2026-10-19 14:07 — Manager: v2\n'
  );
});

test('parseThread returns { ts, who, text } for each dash line, skips the header, blanks and lines not in that shape, and splits on the first ": " after the who', () => {
  const text = [
    '# Thread · Ticket says X but code assumes Y. Which?',
    '',
    '- 2026-10-19 14:05 — lead: Is X the v1 shape or the v2 one?',
    '- 2026-10-19 14:07 — Manager: v2: the one with ids: use that',
    'stray line that is not a thread entry',
    '',
  ].join('\n');

  assert.deepEqual(lib.parseThread(text), [
    { ts: '2026-10-19 14:05', who: 'lead', text: 'Is X the v1 shape or the v2 one?' },
    { ts: '2026-10-19 14:07', who: 'Manager', text: 'v2: the one with ids: use that' },
  ]);
});

test('threadFile is the one card thread, tasks/<folder>/threads/card.md; a folder safeTaskFolder rejects throws', () => {
  assert.equal(lib.threadFile('/srv/work-brain', '2026-01-02-sample'), path.join('/srv/work-brain', 'tasks/2026-01-02-sample/threads/card.md'));
  assert.throws(() => lib.threadFile('/srv/work-brain', '../etc'), /bad task folder/);
});
