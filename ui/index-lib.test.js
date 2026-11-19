const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const lib = require('./index-lib');

const status = (o) => JSON.stringify({ attempts: 0, review_round: 0, awaiting: null, blocked_reason: null, ...o });
const card = (o) => JSON.stringify({ title: 't', where: '', next: '', waiting_on: null, later: [], questions: [], result: null, lead_session: null, closed: null, ...o });
const q = (id, text, answer = null) => ({ id, kind: 'question', q: text, suggested: '', why: '', file: null, asked: '2026-01-02', answer, answered: null });

// tasks: { folder: [statusJson, cardJson | undefined] }
function brain(tasks) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'index-ui-'));
  for (const [folder, [st, cd]] of Object.entries(tasks)) {
    fs.mkdirSync(path.join(root, 'tasks', folder), { recursive: true });
    fs.writeFileSync(path.join(root, 'tasks', folder, 'status.json'), st);
    if (cd !== undefined) fs.writeFileSync(path.join(root, 'tasks', folder, 'card.json'), cd);
  }
  return root;
}

const none = (title) => `## ${title}\n- none`;

test('index puts one card in each section and leaves closed cards out', () => {
  const root = brain({
    '2026-01-02-a': [status({ card: 'TICKET-1', lane: 'standard', stage: 'tdd', attempts: 1 }), card()],
    '2026-01-02-b': [status({ card: 'TICKET-2', lane: 'quick', stage: 'packet' }), card({ questions: [q('q1', 'Which variant?'), q('q2', 'Keep v1?'), q('q3', 'done', 'yes')] })],
    '2026-01-02-c': [status({ card: 'TICKET-3', lane: 'quick', stage: 'review' }), card({ waiting_on: 'QA in UAT' })],
    '2026-01-02-d': [status({ card: 'TICKET-4', lane: 'quick', stage: 'done' }), card({ where: 'merged, not deployed' })],
    '2026-01-02-e': [status({ card: 'TICKET-5', lane: 'quick', stage: 'review', parked: true }), card()],
    '2026-01-02-f': [status({ card: 'TICKET-6', lane: 'quick', stage: 'done' }), card({ closed: '2026-01-03' })],
  });
  assert.equal(lib.index(root),
    '## Needs you\n- TICKET-2 | 2 open | Which variant? | tasks/2026-01-02-b\n\n' +
    '## Working\n- TICKET-1 | standard | tdd | attempt 1 | round 0 | tasks/2026-01-02-a\n\n' +
    '## Waiting on someone else\n- TICKET-3 | QA in UAT | tasks/2026-01-02-c\n\n' +
    '## Done, not closed\n- TICKET-4 | merged, not deployed | tasks/2026-01-02-d\n\n' +
    '## Parked\n- TICKET-5 | quick | review | tasks/2026-01-02-e\n\n' +
    `${none('Pull requests')}\n\n${none('Faults')}\n`);
});

test('index renders every section as "- none" when there are no tasks', () => {
  assert.equal(lib.index(brain({})), ['Needs you', 'Working', 'Waiting on someone else', 'Done, not closed', 'Parked', 'Pull requests', 'Faults'].map(none).join('\n\n') + '\n');
});

test('index files a task with no readable card.json, a blocked task with no open question, and a card validate rejects under Faults, and still lists them in their own section', () => {
  const root = brain({
    '2026-01-02-nocard': [status({ card: 'TICKET-1', lane: 'quick', stage: 'tdd' })],
    '2026-01-02-badjson': [status({ card: 'TICKET-2', lane: 'quick', stage: 'tdd' }), '{nope'],
    '2026-01-02-donenocard': [status({ card: 'TICKET-3', lane: 'quick', stage: 'done' })],
    '2026-01-02-blocked': [status({ card: 'TICKET-4', lane: 'quick', stage: 'blocked' }), card()],
    '2026-01-02-long': [status({ card: 'TICKET-5', lane: 'quick', stage: 'tdd' }), card({ next: 'n'.repeat(130) })],
  });
  const out = lib.index(root);
  const faults = out.split('## Faults\n')[1];
  assert.match(faults, /^- tasks\/2026-01-02-nocard \| no readable card\.json \(no card\.json\)$/m);
  assert.match(faults, /^- tasks\/2026-01-02-badjson \| no readable card\.json \(.+$/m);
  assert.doesNotMatch(faults, /donenocard/);
  assert.match(faults, /^- tasks\/2026-01-02-blocked \| blocked with no open question$/m);
  assert.match(faults, /^- tasks\/2026-01-02-long \| next is 130 chars, cap 120$/m);
  assert.match(out.split('## Waiting on someone else')[0], /TICKET-5 \| quick \| tdd/);
});

test('index reports an unparsable status.json through warn instead of throwing', () => {
  const root = brain({ '2026-01-02-bad': ['{not json'] });
  const warnings = [];
  assert.equal(lib.index(root, (m) => warnings.push(m)), lib.renderIndex([]));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /status\.json/);
});

test('lines clip at 120 characters', () => {
  const root = brain({ '2026-01-02-a': [status({ card: 'TICKET-1', lane: 'quick', stage: 'review' }), card({ questions: [q('q1', 'x'.repeat(140))] })] });
  const line = lib.index(root).split('\n').find((l) => l.startsWith('- TICKET-1'));
  assert.equal(line.length, 120);
  assert.ok(line.endsWith('…'));
});

test('index lists a task with a readable pr.md under Pull requests, a queued re-review with its sha, and skips closed cards', () => {
  const pr = (stands) => `# widgets#12 — sample\nStands: ${stands} | Round: 1 | Url: https://example.test/pr/12\n`;
  const root = brain({
    '2026-01-02-pr': [status({ card: 'TICKET-1', lane: 'review', stage: 'done' }), card()],
    '2026-01-02-closed': [status({ card: 'TICKET-2', lane: 'review', stage: 'done' }), card({ closed: '2026-01-03' })],
  });
  fs.writeFileSync(path.join(root, 'tasks/2026-01-02-closed/pr.md'), pr('waiting on author'));
  fs.writeFileSync(path.join(root, 'tasks/2026-01-02-pr/pr.md'), pr('waiting on author'));
  fs.writeFileSync(path.join(root, 'pr-watch.json'), JSON.stringify([{ task: 'tasks/2026-01-02-pr', rereview: 'queued', rereviewSha: '0123456789abcdef' }]));
  const section = lib.index(root).split('## Pull requests\n')[1].split('\n\n')[0];
  assert.equal(section.split('\n').length, 1, section);
  assert.match(section, /^- tasks\/2026-01-02-pr \| widgets#12 \| .+ \| round 1 \| 0123456$/);
});

test('renderIndex lists the PR cards passed as its second argument, the ones that need the manager first', () => {
  const cards = [
    { task: 'tasks/2026-11-01-review-a', repo: 'widgets', number: 12, stands: 'waiting on author', round: 1, needsYou: false },
    { task: 'tasks/2026-11-03-review-c', repo: 'gizmos', number: 3, stands: 'comment ready', round: 1, needsYou: true },
  ];
  const out = lib.renderIndex([], cards);
  assert.match(out, /## Pull requests\n- tasks\/2026-11-03-review-c \| gizmos#3 \| comment ready \| round 1\n- tasks\/2026-11-01-review-a \| widgets#12 \| waiting on author \| round 1\n/);
});

test('index-lib no longer reads the inbox', () => {
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, 'index-lib.js'), 'utf8'), /inbox/);
});

test('a PR that needs the manager puts its card under Needs you as `<card> | PR | <where> | <folder>`, with no open question needed, in bin/index as in the Cards tab', () => {
  const root = brain({
    '2026-01-02-pr': [status({ card: 'TICKET-1', lane: 'review', stage: 'done' }), card({ where: 'comment ready: request changes' })],
    '2026-01-02-nocard': [status({ card: 'TICKET-2', lane: 'review', stage: 'review' }), undefined],
  });
  const pr = '# widgets#12 — sample\nStands: comment ready | Round: 1 | Url: https://example.test/pr/12\n';
  fs.writeFileSync(path.join(root, 'tasks/2026-01-02-pr/pr.md'), pr);
  fs.writeFileSync(path.join(root, 'tasks/2026-01-02-nocard/pr.md'), pr);
  const section = lib.index(root).split('## Needs you\n')[1].split('\n\n')[0];
  assert.equal(section, [
    '- TICKET-2 | PR | comment ready | tasks/2026-01-02-nocard',
    '- TICKET-1 | PR | comment ready: request changes | tasks/2026-01-02-pr',
  ].join('\n'));
});

test('a done task with no card.json is listed nowhere; a done task with a broken card.json is under Done, not Faults', () => {
  const root = brain({
    '2026-01-02-old': [status({ card: 'TICKET-1', lane: 'quick', stage: 'done' }), undefined],
    '2026-01-02-broken': [status({ card: 'TICKET-2', lane: 'quick', stage: 'done' }), '{ broken'],
  });
  const out = lib.index(root);
  assert.doesNotMatch(out, /2026-01-02-old/);
  assert.match(out.split('## Done, not closed\n')[1].split('\n\n')[0], /2026-01-02-broken/);
  assert.equal(out.split('## Faults\n')[1].trim(), '- none');
});
