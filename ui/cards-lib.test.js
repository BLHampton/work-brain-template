const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  newCard, ask, assume, answer, withdraw, openQuestions, validate, stateOf,
  readCard, writeCard, change, listCards, safeRelFile, CAPS, KINDS, SHOWN,
} = require('./cards-lib');

const FOLDER = '2026-01-02-sample';

function tmpRoot(stage = 'tdd') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-lib-'));
  fs.mkdirSync(path.join(root, 'tasks', FOLDER), { recursive: true });
  fs.writeFileSync(path.join(root, 'tasks', FOLDER, 'status.json'), JSON.stringify({ card: 'TICKET-123', stage }));
  return root;
}

test('constants', () => {
  assert.deepEqual(CAPS, { where: 120, next: 120, q: 140, suggested: 100, why: 400, later: 80 });
  assert.deepEqual(KINDS, ['question', 'plan approval', 'ship approval', 'ticket approval', 'next step', 'assumed']);
  assert.equal(SHOWN, 3);
});

test('ask numbers questions and refuses over-cap text', () => {
  let c = ask(newCard({ title: 'TICKET-123 · Sample' }), { q: 'Ship behind a flag?', suggested: 'Yes', why: 'Small blast radius.' }, '2026-01-02');
  c = ask(c, { q: 'Second?', suggested: 'No', why: 'x' }, '2026-01-02');
  assert.deepEqual(c.questions.map((x) => x.id), ['q1', 'q2']);
  assert.match(validate(ask(c, { q: 'x'.repeat(141), suggested: 'a', why: 'b' }, '2026-01-02'))[0], /q is 141 chars, cap 140/);
});

test('ask does not mutate its input and validates kind', () => {
  const base = newCard({ title: 't' });
  ask(base, { q: 'A?', suggested: 'Y', why: 'w' }, '2026-01-02');
  assert.deepEqual(base.questions, []);
  const bad = ask(base, { q: 'A?', suggested: 'Y', why: 'w', kind: 'fyi' }, '2026-01-02');
  assert.match(validate(bad)[0], /kind 'fyi' is not one of/);
});

test('answer keeps the question and moves the card to working', () => {
  const c = answer(ask(newCard({ title: 't' }), { q: 'A?', suggested: 'Yes', why: 'w' }, '2026-01-02'), 'q1', 'Yes', '2026-01-03');
  assert.equal(c.questions.length, 1);
  assert.equal(c.questions[0].answer, 'Yes');
  assert.equal(stateOf({ stage: 'tdd' }, c), 'working');
  assert.throws(() => answer(c, 'q1', 'again', '2026-01-03'), /already answered/);
  assert.throws(() => answer(c, 'q9', 'x', '2026-01-03'), /unknown question/);
});

test('withdraw answers with withdrawn; openQuestions lists the unanswered', () => {
  let c = ask(newCard({ title: 't' }), { q: 'A?', suggested: 'Y', why: 'w' }, '2026-01-02');
  c = ask(c, { q: 'B?', suggested: 'Y', why: 'w' }, '2026-01-02');
  c = withdraw(c, 'q1', '2026-01-03');
  assert.equal(c.questions[0].answer, 'withdrawn');
  assert.deepEqual(openQuestions(c).map((x) => x.id), ['q2']);
});

test('assumed never makes the card need him', () => {
  const c = assume(newCard({ title: 't' }), 'Keep v1 compatibility', '2026-01-02');
  assert.equal(c.questions[0].kind, 'assumed');
  assert.equal(c.questions[0].answer, 'Keep v1 compatibility');
  assert.equal(stateOf({ stage: 'tdd' }, c), 'working');
});

test('stateOf: every state', () => {
  const open = ask(newCard({ title: 't' }), { q: 'A?', suggested: 'Y', why: 'w' }, '2026-01-02');
  assert.equal(stateOf({ stage: 'tdd' }, open), 'needs you');
  assert.equal(stateOf({ stage: 'tdd', parked: true }, open), 'parked');
  assert.equal(stateOf({ stage: 'done' }, newCard({ title: 't' })), 'done');
  assert.equal(stateOf({ stage: 'done' }, open), 'needs you');
  assert.equal(stateOf({ stage: 'review' }, { ...newCard({ title: 't' }), waiting_on: 'PR author' }), 'waiting on someone else');
  assert.equal(stateOf({ stage: 'done', dropped: '2026-01-02' }, open), 'closed');
  assert.equal(stateOf({ stage: 'tdd' }, { ...open, closed: '2026-01-02' }), 'closed');
});

test('unreadable card file is reported, not thrown', () => {
  const root = tmpRoot();
  assert.equal(readCard(root, FOLDER).unreadable, 'no card.json');
  fs.writeFileSync(path.join(root, 'tasks', FOLDER, 'card.json'), '{');
  assert.equal(typeof readCard(root, FOLDER).unreadable, 'string');
  const rows = listCards(root);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, 'working');
  assert.equal(rows[0].open, 0);
  assert.equal(typeof rows[0].card.unreadable, 'string');
});

test('change re-reads before writing', () => {
  const root = tmpRoot();
  const file = path.join(root, 'tasks', FOLDER, 'card.json');
  writeCard(root, FOLDER, newCard({ title: 't' }));
  fs.writeFileSync(file, JSON.stringify({ ...newCard({ title: 't' }), where: 'first' }));
  change(root, FOLDER, (c) => ask(c, { q: 'A?', suggested: 'Y', why: 'w' }, '2026-01-02'));
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(onDisk.where, 'first');
  assert.equal(onDisk.questions.length, 1);
});

test('change refuses an invalid result and bad folder names', () => {
  const root = tmpRoot();
  writeCard(root, FOLDER, newCard({ title: 't' }));
  assert.throws(() => change(root, FOLDER, (c) => ({ ...c, where: 'x'.repeat(121) })), /where is 121 chars, cap 120/);
  assert.equal(readCard(root, FOLDER).where, '');
  assert.throws(() => readCard(root, '../etc'), /bad task folder/);
  assert.throws(() => writeCard(root, '../etc', newCard({ title: 't' })), /bad task folder/);
  assert.throws(() => change(root, '../etc', (c) => c), /bad task folder/);
});

test('listCards reports state and open count', () => {
  const root = tmpRoot();
  writeCard(root, FOLDER, ask(newCard({ title: 't' }), { q: 'A?', suggested: 'Y', why: 'w' }, '2026-01-02'));
  const [row] = listCards(root);
  assert.equal(row.folder, 'tasks/' + FOLDER);
  assert.equal(row.state, 'needs you');
  assert.equal(row.open, 1);
  assert.equal(row.status.stage, 'tdd');
});

test('listCards does not throw on a task folder name safeTaskFolder rejects', () => {
  const root = tmpRoot();
  const bad = path.join(root, 'tasks', 'Bad Folder');
  fs.mkdirSync(bad, { recursive: true });
  fs.writeFileSync(path.join(bad, 'status.json'), JSON.stringify({ card: 'TICKET-123', stage: 'tdd' }));
  const rows = listCards(root);
  const row = rows.find((r) => r.folder === 'tasks/Bad Folder');
  assert.deepEqual(row.card, { unreadable: 'bad task folder' });
  assert.equal(row.open, 0);
  assert.equal(rows.length, 2);
});

test('change on a missing or unreadable card throws unreadable card: <reason>', () => {
  const root = tmpRoot();
  assert.throws(() => change(root, FOLDER, (c) => c), (e) => e instanceof Error && e.constructor === Error && e.message === 'unreadable card: no card.json');
  fs.writeFileSync(path.join(root, 'tasks', FOLDER, 'card.json'), '{');
  assert.throws(() => change(root, FOLDER, (c) => c), /^Error: unreadable card: /);
});

test('readCard reports JSON that is not a card object as unreadable', () => {
  const root = tmpRoot();
  for (const text of ['[]', '"x"', 'null', '3']) {
    fs.writeFileSync(path.join(root, 'tasks', FOLDER, 'card.json'), text);
    assert.deepEqual(readCard(root, FOLDER), { unreadable: 'not a card object' }, text);
  }
});

test('safeRelFile accepts a path inside the task folder and refuses anything that leaves it', () => {
  for (const ok of ['plan.md', 'research/synthesis.md', 'research/mockups.html']) assert.equal(safeRelFile(ok), true, ok);
  for (const bad of ['../x.md', '/etc/passwd', 'a/../b.md', '', '.', 'a//b.md', 'a/b c.md', null, 7]) assert.equal(safeRelFile(bad), false, String(bad));
});

test('validate refuses a question file or a result outside the task folder', () => {
  const asked = ask(newCard({ title: 't' }), { q: 'A?', suggested: 'Y', why: 'w', file: 'research/mockups.html' }, '2026-01-02');
  assert.deepEqual(validate({ ...asked, result: 'research/synthesis.md' }), []);
  assert.deepEqual(validate(ask(newCard({ title: 't' }), { q: 'A?', suggested: 'Y', why: 'w', file: '../x.md' }, '2026-01-02')), ["file '../x.md' is not a path inside the task folder"]);
  assert.deepEqual(validate({ ...newCard({ title: 't' }), result: '/etc/passwd' }), ["result '/etc/passwd' is not a path inside the task folder"]);
});

test('listCards: a pr.md that needs the manager gives the row pr and needsYou and makes it needs you, unreadable card included; parked and closed stay', () => {
  const root = tmpRoot('review');
  const prText = (stands) => `# widgets#12 — sample\nStands: ${stands} | Round: 1 | Url: https://example.test/pr/12\n`;
  fs.writeFileSync(path.join(root, 'tasks', FOLDER, 'pr.md'), prText('comment ready'));
  let [row] = listCards(root);
  assert.equal(row.card.unreadable, 'no card.json');
  assert.equal(row.pr.stands, 'comment ready');
  assert.equal(row.needsYou, true);
  assert.equal(row.state, 'needs you');
  writeCard(root, FOLDER, { ...newCard({ title: 't' }), closed: '2026-01-03' });
  assert.equal(listCards(root)[0].state, 'closed');
  writeCard(root, FOLDER, newCard({ title: 't' }));
  fs.writeFileSync(path.join(root, 'tasks', FOLDER, 'status.json'), JSON.stringify({ card: 'TICKET-123', stage: 'done', parked: true }));
  assert.equal(listCards(root)[0].state, 'parked');
  fs.writeFileSync(path.join(root, 'tasks', FOLDER, 'status.json'), JSON.stringify({ card: 'TICKET-123', stage: 'done' }));
  fs.writeFileSync(path.join(root, 'tasks', FOLDER, 'pr.md'), prText('waiting on author'));
  [row] = listCards(root);
  assert.equal(row.needsYou, false);
  assert.equal(row.state, 'done');
  fs.rmSync(path.join(root, 'tasks', FOLDER, 'pr.md'));
  [row] = listCards(root);
  assert.equal(row.pr, undefined);
  assert.equal(row.needsYou, false);
  fs.mkdirSync(path.join(root, 'tasks', FOLDER, 'pr.md'));
  assert.equal(listCards(root)[0].pr, null, 'a pr.md that cannot be read gives pr null');
});

test('cards-lib does not require pr-card-lib (pr-card-lib requires cards-lib)', () => {
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, 'cards-lib.js'), 'utf8'), /require\('\.\/pr-card-lib'\)/);
});

test('a done task with no card.json file predates cards and is closed; a broken card file on a done task stays done and unreadable; a PR that needs him does not change that', () => {
  const root = tmpRoot('done');
  let [row] = listCards(root);
  assert.equal(row.state, 'closed');
  fs.writeFileSync(path.join(root, 'tasks', FOLDER, 'card.json'), '{ broken');
  [row] = listCards(root);
  assert.equal(row.state, 'done');
  assert.ok(row.card.unreadable);
  fs.rmSync(path.join(root, 'tasks', FOLDER, 'card.json'));
  fs.writeFileSync(path.join(root, 'tasks', FOLDER, 'pr.md'), '# widgets#12 — sample\nStands: comment ready | Round: 1 | Url: https://example.test/pr/12\n');
  [row] = listCards(root);
  assert.equal(row.state, 'closed', 'a PR that needs him does not bring back a done task with no card file');
});
