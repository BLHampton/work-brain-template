const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BRAIN = path.resolve(__dirname, '..');
const CLI = path.join(BRAIN, 'bin', 'card');
const TASK = 'tasks/2026-01-02-sample';

const QUESTION_MD = [
  '<!-- question.md -->',
  '# TICKET-123 — question',
  'Stage: plan | Asked by: dispatcher | 2026-01-02 09:15',
  '',
  '## Question',
  'Ship behind a flag?',
  '',
  '## Options',
  'A. Flag it — safe, slower',
  'B. No flag — fast, riskier',
  '',
  '## Default',
  'A — small blast radius',
  '',
  '## Blocked meanwhile',
  'The plan; other cards can start.',
  '',
  '## Answer',
  '<filled in by the dispatcher when the manager answers>',
  '',
].join('\n');

function brain() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'card-cli-'));
  fs.mkdirSync(path.join(root, TASK), { recursive: true });
  return root;
}

function card(root, ...args) {
  return asLead(root, '', ...args);
}
// bin/card run inside a lead's session, where herdr set CARD=tasks/<folder>; '' is no lead.
function asLead(root, CARD, ...args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: BRAIN, env: { CARDS_URL: 'http://127.0.0.1:9', ...process.env, WORK_BRAIN_ROOT: root, CARD }, encoding: 'utf8' });
}

const file = (root) => path.join(root, TASK, 'card.json');
const read = (root) => JSON.parse(fs.readFileSync(file(root), 'utf8'));

function started() {
  const root = brain();
  const r = card(root, 'new', TASK, '--title', 'TICKET-123 · Sample');
  assert.equal(r.status, 0, r.stderr);
  return root;
}

test('new then ask writes one open question', () => {
  const root = started();
  const r = card(root, 'ask', TASK, '--q', 'Ship behind a flag?', '--suggested', 'Yes', '--why', 'Small blast radius.');
  assert.equal(r.status, 0, r.stderr);
  const c = read(root);
  assert.equal(c.title, 'TICKET-123 · Sample');
  assert.equal(c.questions.length, 1);
  assert.deepEqual({ id: c.questions[0].id, kind: c.questions[0].kind, q: c.questions[0].q, suggested: c.questions[0].suggested, why: c.questions[0].why, answer: c.questions[0].answer },
    { id: 'q1', kind: 'question', q: 'Ship behind a flag?', suggested: 'Yes', why: 'Small blast radius.', answer: null });
});

test('new on an existing card, or a missing task folder, exits 1', () => {
  const root = started();
  const again = card(root, 'new', TASK, '--title', 'x');
  assert.equal(again.status, 1);
  assert.match(again.stderr, /^card: card\.json already exists/);
  const missing = card(root, 'new', 'tasks/2026-01-03-nope', '--title', 'x');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^card: no such task folder/);
});

test('every command but new on a folder with no card.json exits 1', () => {
  const root = brain();
  const r = card(root, 'ask', TASK, '--q', 'a', '--suggested', 'b', '--why', 'c');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^card: unreadable card: no card\.json/);
  assert.equal(fs.existsSync(file(root)), false);
});

test('ask with a 141-char --q exits 1, names the cap, leaves the file unchanged', () => {
  const root = started();
  const before = fs.readFileSync(file(root), 'utf8');
  const r = card(root, 'ask', TASK, '--q', 'x'.repeat(141), '--suggested', 'a', '--why', 'b');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^card: .*cap 140/);
  assert.equal(fs.readFileSync(file(root), 'utf8'), before);
});

test('ask round-trips quotes and shell characters exactly', () => {
  const root = started();
  const q = 'a "quoted" $(x)';
  assert.equal(card(root, 'ask', TASK, '--q', q, '--suggested', 's', '--why', 'w').status, 0);
  assert.equal(read(root).questions[0].q, q);
});

test('ask --from question.md takes q, the Default option label, and Blocked meanwhile', () => {
  const root = started();
  fs.writeFileSync(path.join(root, TASK, 'question.md'), QUESTION_MD);
  const r = card(root, 'ask', TASK, '--from', 'question.md');
  assert.equal(r.status, 0, r.stderr);
  const [q] = read(root).questions;
  assert.equal(q.q, 'Ship behind a flag?');
  assert.equal(q.suggested, 'Flag it');
  assert.equal(q.why, 'The plan; other cards can start.');
  assert.equal(q.file, null);
});

test('ask --from a question.md with no Default option exits 1', () => {
  const root = started();
  fs.writeFileSync(path.join(root, TASK, 'question.md'), QUESTION_MD.replace('A — small blast radius', '<the option recommended>'));
  const r = card(root, 'ask', TASK, '--from', 'question.md');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^card: question\.md has no Default option/);
  assert.equal(read(root).questions.length, 0);
});

test('ask with a missing flag or a bad kind exits 1', () => {
  const root = started();
  const missing = card(root, 'ask', TASK, '--q', 'a', '--suggested', 'b');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^card: .*--why/);
  const kind = card(root, 'ask', TASK, '--q', 'a', '--suggested', 'b', '--why', 'c', '--kind', 'bogus');
  assert.equal(kind.status, 1);
  assert.match(kind.stderr, /^card: kind 'bogus'/);
});

test('where sets where and next; with one argument next is left alone', () => {
  const root = started();
  assert.equal(card(root, 'where', TASK, 'Writing tests', 'Review').status, 0);
  assert.equal(card(root, 'where', TASK, 'Reviewing').status, 0);
  const c = read(root);
  assert.equal(c.where, 'Reviewing');
  assert.equal(c.next, 'Review');
});

test('assume records an answered assumed entry; later appends; withdraw closes a question', () => {
  const root = started();
  assert.equal(card(root, 'assume', TASK, 'Keep v1 compatibility').status, 0);
  assert.equal(card(root, 'later', TASK, 'one').status, 0);
  assert.equal(card(root, 'later', TASK, 'two').status, 0);
  assert.equal(card(root, 'ask', TASK, '--q', 'a', '--suggested', 'b', '--why', 'c').status, 0);
  assert.equal(card(root, 'withdraw', TASK, 'q2').status, 0);
  const c = read(root);
  assert.deepEqual(c.later, ['one', 'two']);
  assert.equal(c.questions[0].kind, 'assumed');
  assert.equal(c.questions[0].answer, 'Keep v1 compatibility');
  assert.equal(c.questions[1].answer, 'withdrawn');
  assert.equal(card(root, 'withdraw', TASK, 'q9').status, 1);
});

test('waiting sets a name; with no name it sets waiting_on to null', () => {
  const root = started();
  assert.equal(card(root, 'waiting', TASK, 'the platform team').status, 0);
  assert.equal(read(root).waiting_on, 'the platform team');
  assert.equal(card(root, 'waiting', TASK).status, 0);
  assert.equal(read(root).waiting_on, null);
});

test('result records an existing file; a missing file exits 1', () => {
  const root = started();
  fs.writeFileSync(path.join(root, TASK, 'synthesis.md'), 'x');
  assert.equal(card(root, 'result', TASK, 'synthesis.md').status, 0);
  assert.equal(read(root).result, 'synthesis.md');
  const r = card(root, 'result', TASK, 'missing.md');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^card: /);
  assert.equal(read(root).result, 'synthesis.md');
});

test('a bad folder, an unknown command and no arguments exit 1 with card: usage', () => {
  const root = started();
  for (const args of [['where', '../etc', 'x'], ['where', 'tasks/Bad', 'x'], ['bogus', TASK], []]) {
    const r = card(root, ...args);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, /^card: /);
  }
});

test('an unknown --flag exits 1 and names it', () => {
  const root = started();
  const r = card(root, 'ask', TASK, '--q', 'a', '--suggested', 'b', '--why', 'c', '--wat', 'x');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^card: unknown flag --wat/);
});

test('ask --file takes a path inside the task folder and refuses one that leaves it', () => {
  const root = started();
  assert.equal(card(root, 'ask', TASK, '--q', 'a', '--suggested', 'b', '--why', 'c', '--file', 'research/synthesis.md').status, 0);
  assert.equal(read(root).questions[0].file, 'research/synthesis.md');
  for (const bad of ['../x.md', '/etc/passwd', 'a/../b.md', '', '.']) {
    const r = card(root, 'ask', TASK, '--q', 'a', '--suggested', 'b', '--why', 'c', '--file', bad);
    assert.equal(r.status, 1, bad);
    assert.match(r.stderr, /^card: --file must be a path inside the task folder/);
  }
  assert.equal(read(root).questions.length, 1);
});

test('result takes an existing path inside the task folder and refuses one that leaves it', () => {
  const root = started();
  fs.mkdirSync(path.join(root, TASK, 'research'));
  fs.writeFileSync(path.join(root, TASK, 'research', 'synthesis.md'), 'x');
  assert.equal(card(root, 'result', TASK, 'research/synthesis.md').status, 0);
  assert.equal(read(root).result, 'research/synthesis.md');
  for (const bad of ['../x.md', '/etc/passwd', 'a/../b.md', '.']) {
    const r = card(root, 'result', TASK, bad);
    assert.equal(r.status, 1, bad);
    assert.match(r.stderr, /^card: result must be a path inside the task folder/);
  }
  assert.equal(read(root).result, 'research/synthesis.md');
});

test('a lead (CARD set) may ask and assume on its own card only', () => {
  const root = started();
  fs.mkdirSync(path.join(root, 'tasks', '2026-01-03-other'), { recursive: true });
  assert.equal(card(root, 'new', 'tasks/2026-01-03-other', '--title', 'Other').status, 0);
  const before = fs.readFileSync(file(root), 'utf8');

  const other = asLead(root, 'tasks/2026-01-03-other', 'assume', TASK, 'keep v1');
  assert.equal(other.status, 1);
  assert.match(other.stderr, /^card: a lead may only write its own card$/m);
  for (const args of [['where', TASK, 'x'], ['later', TASK, 'x'], ['waiting', TASK], ['withdraw', TASK, 'q1'], ['result', TASK, 'card.json']]) {
    const r = asLead(root, TASK, ...args);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, /^card: a lead may only ask or assume$/m);
  }
  assert.equal(fs.readFileSync(file(root), 'utf8'), before, 'nothing was written');

  assert.equal(asLead(root, TASK, 'assume', TASK, 'keep v1').status, 0);
  assert.equal(asLead(root, TASK, 'ask', TASK, '--q', 'Q?', '--suggested', 'Y', '--why', 'w').status, 0);
  assert.deepEqual(read(root).questions.map((x) => x.kind), ['assumed', 'question']);
});

test('two bin/card later calls started together on the same card both land', async () => {
  const { spawn } = require('node:child_process');
  const root = brain();
  assert.equal(card(root, 'new', TASK, '--title', 'TICKET-123 · Sample').status, 0);
  const later = (item) => new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, 'later', TASK, item], { env: { ...process.env, WORK_BRAIN_ROOT: root }, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; p.stderr.on('data', (c) => (err += c));
    p.on('close', (code) => resolve({ code, err }));
  });
  for (let round = 0; round < 8; round++) {
    const results = await Promise.all([later(`a${round}`), later(`b${round}`)]);
    for (const r of results) assert.equal(r.code, 0, r.err);
  }
  const items = JSON.parse(fs.readFileSync(path.join(root, TASK, 'card.json'), 'utf8')).later;
  assert.deepEqual([...items].sort(), Array.from({ length: 8 }, (_, i) => [`a${i}`, `b${i}`]).flat().sort());
});
