const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Required inside each test so a missing export fails that test alone, on an assertion.
function load() {
  try {
    return require('./pr-card-lib');
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') throw err;
    return {};
  }
}

const TEMPLATE = fs.readFileSync(path.join(__dirname, '..', 'templates', 'pr.md'), 'utf8');

// templates/pr.md filled in for a fictional PR.
const PR_MD = [
  '<!-- pr.md · dispatcher (review lane, stamps) + bin/pr-watch (timeline) · cap: one screen above the timeline -->',
  '# widget-api#42 — Add retry to the export client',
  'Stands: comment ready | Round: 2 | Url: https://github.com/octo-org/widget-api/pull/42',
  '',
  '## Verdict',
  'Request changes: the retry loop never backs off and swallows the last error.',
  '',
  '## Still to do',
  '- [x] Read the diff against the export client tests',
  '- [ ] Post the review comment',
  '',
  '## Decisions',
  '### Block on the missing backoff, or let it through with a follow-up?',
  '- A. Request changes until backoff is added',
  '- B. Approve and ask for a follow-up PR',
  '- C. Comment only, leave the call to the author',
  'Default: A',
  'Chosen: B',
  '',
  '## Comment',
  'tasks/2026-01-06-example-review/pr-comment.md',
  '',
  '## Timeline',
  '- 2026-01-07 09:05 — octo-dev pushed 2 commits, re-review queued',
  '- 2026-01-06 15:40 — round 1 comment drafted',
  '- 2026-01-06 14:20 — review started',
  '',
].join('\n');

const sections = (text) => text.split('\n').filter((line) => line.startsWith('## '));

test('parsePr reads where a PR stands, its verdict, to-dos, decisions, comment path and timeline from pr.md', () => {
  const lib = load();
  assert.equal(typeof lib.parsePr, 'function', 'pr-card-lib exports parsePr(text)');

  assert.deepEqual(lib.parsePr(PR_MD), {
    repo: 'widget-api',
    number: 42,
    title: 'Add retry to the export client',
    stands: 'comment ready',
    round: 2,
    url: 'https://github.com/octo-org/widget-api/pull/42',
    verdict: 'Request changes: the retry loop never backs off and swallows the last error.',
    todo: [
      { text: 'Read the diff against the export client tests', done: true },
      { text: 'Post the review comment', done: false },
    ],
    decisions: [
      {
        question: 'Block on the missing backoff, or let it through with a follow-up?',
        options: [
          { letter: 'A', text: 'Request changes until backoff is added' },
          { letter: 'B', text: 'Approve and ask for a follow-up PR' },
          { letter: 'C', text: 'Comment only, leave the call to the author' },
        ],
        default: 'A',
        chosen: 'B',
      },
    ],
    comment: { path: 'tasks/2026-01-06-example-review/pr-comment.md', posted: null },
    timeline: [
      { at: '2026-01-07 09:05', text: 'octo-dev pushed 2 commits, re-review queued' },
      { at: '2026-01-06 15:40', text: 'round 1 comment drafted' },
      { at: '2026-01-06 14:20', text: 'review started' },
    ],
  });

  assert.deepEqual(
    lib.STANDS,
    [
      'reviewing',
      'comment ready',
      'waiting on author',
      'updated',
      're-review queued',
      're-reviewing',
      'approved',
      'merged',
      'closed',
    ],
    'pr-card-lib exports STANDS, the nine places a PR card can stand',
  );

  assert.deepEqual(
    sections(TEMPLATE),
    sections(PR_MD),
    'templates/pr.md carries the same sections, in the same order, as the file parsePr reads',
  );
  for (const state of lib.STANDS) {
    assert.ok(TEMPLATE.includes(state), `templates/pr.md names the "${state}" state`);
  }
});

test('setStands rewrites only the Stands value on the status line and refuses a state that is not one of the nine', () => {
  const lib = load();
  assert.equal(typeof lib.setStands, 'function', 'pr-card-lib exports setStands(text, state)');

  const before = PR_MD.split('\n');
  const after = lib.setStands(PR_MD, 'waiting on author').split('\n');
  assert.equal(
    after[2],
    'Stands: waiting on author | Round: 2 | Url: https://github.com/octo-org/widget-api/pull/42',
    'the status line carries the new state and keeps Round and Url as they were',
  );
  assert.deepEqual(
    after.filter((_, i) => i !== 2),
    before.filter((_, i) => i !== 2),
    'every line other than the status line is byte-identical',
  );

  assert.equal(
    lib.setStands(PR_MD, 're-review queued'),
    PR_MD.replace('Stands: comment ready |', 'Stands: re-review queued |'),
    'a second state lands the same way',
  );

  assert.equal(lib.setStands(PR_MD, 'comment ready'), PR_MD, 'setting the state it already has changes nothing');

  assert.throws(
    () => lib.setStands(PR_MD, 'needs coffee'),
    (err) => {
      assert.ok(err instanceof Error, 'an unknown state throws an Error');
      for (const state of lib.STANDS) {
        assert.ok(err.message.includes(state), `the error message names the allowed state "${state}"`);
      }
      return true;
    },
  );
});

test('addTimeline inserts one dated line first under Timeline and leaves every other byte alone', () => {
  const lib = load();
  assert.equal(typeof lib.addTimeline, 'function', 'pr-card-lib exports addTimeline(text, at, what)');

  const heading = '## Timeline\n';
  const added = '- 2026-01-07 11:30 — octo-dev replied to the review\n';
  const after = lib.addTimeline(PR_MD, '2026-01-07 11:30', 'octo-dev replied to the review');
  assert.equal(
    after,
    PR_MD.replace(heading, heading + added),
    'the new line is the first entry; everything above the timeline and the older entries are byte-identical',
  );
  assert.deepEqual(
    lib.parsePr(after).timeline,
    [
      { at: '2026-01-07 11:30', text: 'octo-dev replied to the review' },
      { at: '2026-01-07 09:05', text: 'octo-dev pushed 2 commits, re-review queued' },
      { at: '2026-01-06 15:40', text: 'round 1 comment drafted' },
      { at: '2026-01-06 14:20', text: 'review started' },
    ],
    'parsePr lists the new entry first',
  );

  const top = (text) => text.slice(0, text.indexOf(heading) + heading.length);

  const placeholder = TEMPLATE.slice(top(TEMPLATE).length);
  assert.ok(placeholder.startsWith('- <YYYY-MM-DD HH:MM>'), 'templates/pr.md ends in the timeline placeholder line');
  assert.equal(
    lib.addTimeline(TEMPLATE, '2026-01-06 14:20', 'review started'),
    `${top(TEMPLATE)}- 2026-01-06 14:20 — review started\n`,
    'the template placeholder is replaced: the timeline holds exactly the new line',
  );

  assert.equal(
    lib.addTimeline(top(PR_MD), '2026-01-06 14:20', 'review started'),
    `${top(PR_MD)}- 2026-01-06 14:20 — review started\n`,
    'an empty timeline section ends up with exactly the new line',
  );

  const flattened = lib.addTimeline(PR_MD, '2026-01-07 11:30', 'octo-dev replied:\nlooks fine\r\nto me');
  assert.equal(
    flattened.split('\n').length,
    PR_MD.split('\n').length + 1,
    'a what with line breaks still adds exactly one line',
  );
  const first = flattened.slice(top(PR_MD).length).split('\n')[0];
  assert.match(
    first,
    /^- 2026-01-07 11:30 — octo-dev replied:\s*looks fine\s*to me$/,
    'the whole what sits on the one new line',
  );
  assert.ok(!first.includes('\r'), 'no carriage return survives the flattening');
});

const os = require('node:os');
const TASK = '2026-01-06-example-review';

// A brain root with one task folder; `card` (an object, or null for none) becomes its card.json.
function brain(card) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-card-'));
  fs.mkdirSync(path.join(root, 'tasks', TASK), { recursive: true });
  if (card) fs.writeFileSync(path.join(root, 'tasks', TASK, 'card.json'), JSON.stringify(card));
  return root;
}
const CARD = { title: 'T', where: 'old', next: 'n', waiting_on: null, later: [], questions: [], result: null, lead_session: null, closed: null };
const readCard = (root) => JSON.parse(fs.readFileSync(path.join(root, 'tasks', TASK, 'card.json'), 'utf8'));

test('setWhere writes the headline into card.json where and leaves every other field alone, a closed card included', () => {
  const lib = load();
  assert.equal(typeof lib.setWhere, 'function', 'pr-card-lib exports setWhere(root, folder, headline, title)');
  const root = brain({ ...CARD, next: 'keep me', closed: '2026-01-05' });
  lib.setWhere(root, TASK, 'comment ready, request changes', 'ignored: the card exists');
  assert.deepEqual(readCard(root), { ...CARD, next: 'keep me', closed: '2026-01-05', where: 'comment ready, request changes' }, 'where is replaced, a closed card stays closed');
  lib.setWhere(root, TASK, 'waiting on author', 'x');
  assert.equal(readCard(root).where, 'waiting on author', 'a second headline replaces the first, no second card');
});

test('setWhere creates card.json titled with the PR when the folder has none', () => {
  const lib = load();
  const root = brain(null);
  lib.setWhere(root, TASK, 'comment ready: request changes', 'widget-api#42 · Add retry to the export client');
  const made = readCard(root);
  assert.equal(made.title, 'widget-api#42 · Add retry to the export client');
  assert.equal(made.where, 'comment ready: request changes');
  assert.equal(made.closed, null);
  assert.deepEqual(made.questions, []);
});

test('setWhere refuses a card.json it cannot read and writes nothing', () => {
  const lib = load();
  const root = brain(null);
  const file = path.join(root, 'tasks', TASK, 'card.json');
  fs.writeFileSync(file, '{nope');
  assert.throws(() => lib.setWhere(root, TASK, 'x', 'T'), /unreadable card/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{nope');
});

test('whereOf puts a headline on one line and cuts one over 120 characters to 119 plus … instead of refusing it', () => {
  const lib = load();
  assert.equal(lib.whereOf('updated: octo-dev replied:\nlooks fine\r\nto me'), 'updated: octo-dev replied: looks fine to me');
  const fits = 'x'.repeat(120);
  assert.equal(lib.whereOf(fits), fits, 'exactly 120 is written unchanged');
  const cut = lib.whereOf(`${fits}y`);
  assert.equal(cut, `${'x'.repeat(119)}…`, 'one over is cut to 119 plus …');
  const root = brain(CARD);
  lib.setWhere(root, TASK, `re-review queued: ${'z'.repeat(200)}`, 'T');
  assert.equal(readCard(root).where.length, 120, 'a long headline lands cut, not rejected');
});

test('needsYou is true when a comment is ready, the PR is merged or closed, or a decision has no choice; false while it waits on someone else', () => {
  const lib = load();
  assert.equal(typeof lib.needsYou, 'function', 'pr-card-lib exports needsYou');

  const decided = lib.parsePr(PR_MD);
  assert.equal(decided.decisions[0].chosen, 'B', 'the example PR has its one decision chosen');
  const open = lib.parsePr(PR_MD.replace('Chosen: B\n', ''));
  assert.equal(open.decisions[0].chosen, null, 'without a Chosen line the decision is open');
  const stands = (pr, state) => ({ ...pr, stands: state });

  for (const state of ['comment ready', 'merged', 'closed']) {
    assert.equal(lib.needsYou(stands(decided, state)), true, `"${state}" needs Manager: a post or a last stamp is pending`);
  }
  for (const state of ['reviewing', 'waiting on author', 're-review queued', 're-reviewing', 'approved', 'updated']) {
    assert.equal(lib.needsYou(stands(decided, state)), false, `"${state}" with every decision chosen is for awareness`);
    assert.equal(lib.needsYou(stands({ ...decided, decisions: [] }, state)), false, `"${state}" with no decisions is for awareness`);
  }
  assert.equal(lib.needsYou(stands(open, 'updated')), true, '"updated" with an open decision needs the manager');
  assert.equal(lib.needsYou(stands(open, 'waiting on author')), true, 'an open decision needs the manager whatever the state');
  const second = { question: 'Second question?', options: [], default: 'A', chosen: '' };
  assert.equal(
    lib.needsYou(stands({ ...decided, decisions: [...decided.decisions, second] }, 'reviewing')),
    true,
    'one open decision among chosen ones is enough; an empty Chosen is not a choice',
  );
  assert.deepEqual(lib.parsePr(PR_MD), decided, 'the parsed pr.md is not mutated');
});

test('applyPrStamp records a Post, Re-review or Changes stamp in pr.md and keeps the card open; Done closes it and returns its log line', () => {
  const lib = load();
  assert.equal(typeof lib.applyPrStamp, 'function', 'pr-card-lib exports applyPrStamp({ pr, task }, stamp, at)');

  const task = 'tasks/2026-01-06-example-review';
  const Q1 = 'Block on the missing backoff, or let it through with a follow-up?';
  const Q2 = 'Mention the flaky export test in the comment?';
  const secondDecision = ['', `### ${Q2}`, '- A. Yes, one line', '- B. No, separate issue', 'Default: A'].join('\n');
  const pr = PR_MD.replace('Chosen: B\n', `Chosen: B${secondDecision}\n`);
  assert.deepEqual(lib.parsePr(pr).decisions.map((d) => d.chosen), ['B', null], 'fixture: one decision chosen, one open');
  const state = Object.freeze({ pr, task });
  const base = { type: 'answer', tag: 'PR', task, file: 'pr.md' };
  const withTimeline = (text, at, what) => text.replace('## Timeline\n', `## Timeline\n- ${at} — ${what}\n`);

  // Post: the choices and one timeline line land in pr.md; Stands waits for the dispatcher to post (R6).
  const decisions = Object.freeze({ [Q1]: 'A', [Q2]: 'B' });
  const postStamp = Object.freeze({ kind: 'post', review: 'approve', decisions });
  const posted = lib.applyPrStamp(state, postStamp, '2026-01-08 10:15');
  assert.equal(
    posted.pr,
    withTimeline(pr.replace('Chosen: B\n', 'Chosen: A\n').replace(`${secondDecision}\n`, `${secondDecision}\nChosen: B\n`), '2026-01-08 10:15', 'Manager: post as approve'),
    'Post: an existing Chosen line is rewritten, a missing one is added under Default, one timeline line is added, nothing else changes',
  );
  assert.deepEqual(lib.parsePr(posted.pr).decisions.map((d) => d.chosen), ['A', 'B']);
  assert.equal(lib.parsePr(posted.pr).stands, 'comment ready', 'Post does not move Stands: the dispatcher does, after the post succeeds');
  assert.equal(posted.close, false, 'Post keeps the card open');
  assert.equal(posted.log ?? null, null, 'Post writes no answered-item log line');
  assert.deepEqual(posted.event, { ...base, answer: 'Post', review: 'approve', decisions: { [Q1]: 'A', [Q2]: 'B' } });

  const one = lib.applyPrStamp(state, { kind: 'post', review: 'comment', decisions: { [Q2]: 'A' } }, '2026-01-08 10:16');
  assert.deepEqual(lib.parsePr(one.pr).decisions.map((d) => d.chosen), ['B', 'A'], 'a decision the stamp does not name keeps its choice');
  assert.equal(lib.parsePr(one.pr).timeline[0].text, 'Manager: post as comment');
  assert.throws(
    () => lib.applyPrStamp(state, { kind: 'post', review: 'approve', decisions: { [Q2]: 'C' } }, '2026-01-08 10:17'),
    /C/,
    'a letter that is not one of that decision\'s options throws (Q2 has A and B only)',
  );

  // Re-review: a timeline line and an event, nothing else.
  const again = lib.applyPrStamp(state, { kind: 're-review' }, '2026-01-08 11:00');
  assert.equal(again.pr, withTimeline(pr, '2026-01-08 11:00', 'Manager: re-review requested'));
  assert.equal(again.close, false, 'Re-review keeps the card open');
  assert.equal(again.log ?? null, null);
  assert.deepEqual(again.event, { ...base, answer: 'Re-review' });

  // Changes: the note, flattened to one line, on the timeline and in the event.
  const changed = lib.applyPrStamp(state, { kind: 'changes', note: 'soften the tone\n\n  and drop point 3 ' }, '2026-01-08 11:30');
  assert.equal(changed.pr, withTimeline(pr, '2026-01-08 11:30', 'Manager: changes — soften the tone and drop point 3'));
  assert.equal(changed.close, false, 'Changes keeps the card open');
  assert.equal(changed.log ?? null, null);
  assert.deepEqual(changed.event, { ...base, answer: 'Changes', note: 'soften the tone and drop point 3' });

  // Done: the card closes; the log line names the PR.
  const done = lib.applyPrStamp(state, { kind: 'done' }, '2026-01-08 16:45');
  assert.equal(done.close, true, 'Done closes the card');
  assert.equal(done.pr, withTimeline(pr, '2026-01-08 16:45', 'Manager: done'));
  assert.equal(done.log, '- 2026-01-08 — card (PR): widget-api#42 → Done');
  assert.deepEqual(done.event, { ...base, answer: 'Done' });

  assert.throws(() => lib.applyPrStamp(state, { kind: 'approve' }, '2026-01-08 17:00'), /approve/, 'an unknown stamp kind throws and names it');
  assert.deepEqual(state, { pr, task }, 'the inputs are not mutated');
  assert.deepEqual(postStamp, { kind: 'post', review: 'approve', decisions: { [Q1]: 'A', [Q2]: 'B' } });
});

test('setReview writes a review round into pr.md: round 1 on the template, round + 1 on an existing file, and with setWhere never a second card', () => {
  const lib = load();
  assert.equal(typeof lib.setReview, 'function', 'pr-card-lib exports setReview(prText, review, at)');

  const task = 'tasks/2026-01-06-example-review';
  const url = 'https://github.com/octo-org/widget-api/pull/42';
  const letters = (texts) => texts.map((text, i) => ({ letter: 'ABCDEFGH'[i], text }));

  // First review: the bare template plus who the PR is.
  const first = Object.freeze({
    repo: 'widget-api',
    number: 42,
    title: 'Add retry to the export client',
    url,
    verdict: 'Request changes: the retry loop never backs off.',
    todo: Object.freeze(['Post the review comment', 'Check the author adds backoff']),
    decisions: Object.freeze([
      Object.freeze({
        question: 'Block on the missing backoff, or let it through with a follow-up?',
        options: Object.freeze(['Request changes until backoff is added', 'Approve and ask for a follow-up PR', 'Comment only']),
        default: 'B',
      }),
      Object.freeze({
        question: 'Mention the flaky export test in the comment?',
        options: Object.freeze(['Yes, one line', 'No, separate issue']),
        default: 'A',
      }),
    ]),
    comment: `${task}/pr-comment.md`,
  });
  const round1 = lib.setReview(TEMPLATE, first, '2026-01-06 15:40');
  assert.deepEqual(
    lib.parsePr(round1),
    {
      repo: 'widget-api',
      number: 42,
      title: 'Add retry to the export client',
      stands: 'comment ready',
      round: 1,
      url,
      verdict: first.verdict,
      todo: [
        { text: 'Post the review comment', done: false },
        { text: 'Check the author adds backoff', done: false },
      ],
      decisions: [
        { question: first.decisions[0].question, options: letters(first.decisions[0].options), default: 'B', chosen: null },
        { question: first.decisions[1].question, options: letters(first.decisions[1].options), default: 'A', chosen: null },
      ],
      comment: { path: `${task}/pr-comment.md`, posted: null },
      timeline: [{ at: '2026-01-06 15:40', text: `round 1: ${first.verdict}` }],
    },
    'a first review on the template: round 1, comment ready, to-dos unchecked, lettered options, no Chosen or Posted, one timeline line',
  );
  assert.deepEqual(sections(round1), sections(TEMPLATE), 'the result keeps the template sections, in order');

  // A later review: PR_MD is at round 2 with a Chosen line; give it a Posted line and a state that is not "comment ready".
  const before = PR_MD.replace('Stands: comment ready |', 'Stands: re-reviewing |').replace(
    'pr-comment.md\n',
    'pr-comment.md\nPosted: https://github.com/octo-org/widget-api/pull/42#pullrequestreview-1\n',
  );
  const was = lib.parsePr(before);
  assert.deepEqual(
    [was.stands, was.round, was.decisions[0].chosen, was.comment.posted !== null],
    ['re-reviewing', 2, 'B', true],
    'fixture: round 2, re-reviewing, a chosen decision and a posted comment',
  );
  const next = Object.freeze({
    verdict: 'Approve: backoff added, one nit left on the changelog.',
    todo: Object.freeze(['Post the approval']),
    decisions: Object.freeze([
      Object.freeze({
        question: 'Raise the changelog nit, or leave it?',
        options: Object.freeze(['Leave it', 'Raise it as a comment']),
        default: 'A',
      }),
    ]),
    comment: `${task}/pr-comment-3.md`,
  });
  const round3 = lib.setReview(before, next, '2026-01-07 13:10');
  assert.deepEqual(
    lib.parsePr(round3),
    {
      repo: 'widget-api',
      number: 42,
      title: 'Add retry to the export client',
      stands: 'comment ready',
      round: 3,
      url,
      verdict: next.verdict,
      todo: [{ text: 'Post the approval', done: false }],
      decisions: [{ question: next.decisions[0].question, options: letters(next.decisions[0].options), default: 'A', chosen: null }],
      comment: { path: `${task}/pr-comment-3.md`, posted: null },
      timeline: [{ at: '2026-01-07 13:10', text: `round 3: ${next.verdict}` }, ...was.timeline],
    },
    'a later review: round + 1, comment ready again, verdict, to-dos, decisions and comment replaced (old Chosen and Posted gone), every earlier timeline line kept under the new one, title and url unchanged',
  );
  assert.ok(!round3.includes(was.verdict), 'the previous verdict is gone from the file');
  assert.ok(!round3.includes('Read the diff against the export client tests'), 'the previous to-dos are gone from the file');
  assert.deepEqual(sections(round3), sections(PR_MD), 'a later round adds no section');

  // Two rounds on one task folder, through setWhere: one card.json, its headline at round 2.
  const headline = (text) => {
    const pr = lib.parsePr(text);
    return `${pr.stands}, round ${pr.round}`;
  };
  const root = brain(null);
  lib.setWhere(root, TASK, headline(round1), 'widget-api#42 · Add retry to the export client');
  const afterOne = readCard(root);
  lib.setWhere(root, TASK, headline(lib.setReview(round1, next, '2026-01-07 13:10')), 'ignored');
  assert.equal(readCard(root).where, 'comment ready, round 2', 'after two review rounds the card says round 2');
  assert.deepEqual({ ...readCard(root), where: afterOne.where }, afterOne, 'the second round changes nothing but where');
  assert.equal(fs.readdirSync(path.join(root, 'tasks')).length, 1);

  assert.throws(
    () => lib.setReview(before, { ...next, decisions: [{ ...next.decisions[0], default: 'Z' }] }, '2026-01-07 13:11'),
    /Z/,
    'a default that is not one of the option letters throws and names it (the decision has A and B only)',
  );
});

test('postCommand builds the exact gh pr review command for a stamp, refuses a TFS url and a missing comment file; markPosted records the link and moves the card to waiting on author', () => {
  const lib = load();
  assert.equal(typeof lib.postCommand, 'function', 'pr-card-lib exports postCommand(pr, review, commentExists)');
  assert.equal(typeof lib.markPosted, 'function', 'pr-card-lib exports markPosted(prText, link, at)');

  const url = 'https://github.com/octo-org/widget-api/pull/42';
  const file = 'tasks/2026-01-06-example-review/pr-comment.md';
  const pr = Object.freeze(lib.parsePr(PR_MD));
  assert.deepEqual([pr.url, pr.comment.path], [url, file], 'fixture: a GitHub PR with a draft comment path');

  // One flag per review type; argv is an array so the caller can execFile it with no shell.
  const flags = { approve: '--approve', 'request-changes': '--request-changes', comment: '--comment' };
  for (const [review, flag] of Object.entries(flags)) {
    const built = lib.postCommand(pr, review, true);
    assert.deepEqual(
      built.argv,
      ['gh', 'pr', 'review', url, flag, '--body-file', file],
      `"${review}" builds gh pr review <url> ${flag} --body-file <path>, nothing more`,
    );
    assert.equal(
      built.display,
      `gh pr review ${url} ${flag} --body-file ${file}`,
      `"${review}" displays as one pasteable line; a plain url and path are not quoted`,
    );
  }

  // Quoting is for the pasted line only: argv always carries the raw values.
  const spaced = lib.parsePr(
    PR_MD.replace(`Url: ${url}`, `Url: ${url}?w=1`).replace(file, 'tasks/2026-01-06 example review/pr-comment.md'),
  );
  const quoted = lib.postCommand(spaced, 'comment', true);
  assert.deepEqual(
    quoted.argv,
    ['gh', 'pr', 'review', `${url}?w=1`, '--comment', '--body-file', 'tasks/2026-01-06 example review/pr-comment.md'],
    'argv holds the url and path as they are, never quoted',
  );
  assert.equal(
    quoted.display,
    `gh pr review '${url}?w=1' --comment --body-file 'tasks/2026-01-06 example review/pr-comment.md'`,
    'display single-quotes a url with a shell-special character and a path with a space',
  );
  assert.ok(!quoted.display.includes('\n'), 'display is one line');

  // TFS / Azure DevOps: nothing is posted for him (R6).
  const tfs = lib.parsePr(PR_MD.replace(url, 'https://dev.azure.com/octo-org/widgets/_git/widget-api/pullrequest/42'));
  assert.equal(tfs.comment.path, file, 'fixture: the TFS PR has a comment path, only the url differs');
  assert.throws(
    () => lib.postCommand(tfs, 'approve', true),
    (err) => {
      assert.ok(err instanceof Error, 'a url parsePrUrl rejects throws an Error');
      assert.match(err.message, /by hand/i, 'the message says the comment has to be pasted by hand');
      return true;
    },
  );

  // Never without the comment file.
  assert.throws(
    () => lib.postCommand(pr, 'approve', false),
    (err) => {
      assert.ok(err instanceof Error, 'a comment file that is not on disk throws an Error');
      assert.ok(err.message.includes(file), 'the message names the missing file');
      return true;
    },
  );
  const noPath = lib.parsePr(PR_MD.replace(`${file}\n`, ''));
  assert.equal(noPath.comment.path, null, 'fixture: pr.md with no comment path');
  assert.throws(
    () => lib.postCommand(noPath, 'approve', true),
    (err) => {
      assert.ok(err instanceof Error, 'no comment path in pr.md throws an Error, whatever the caller found on disk');
      assert.match(err.message, /comment/i, 'the message says the comment file is what is missing');
      return true;
    },
  );

  assert.throws(() => lib.postCommand(pr, 'merge', true), /merge/, 'an unknown review type throws and names it');
  assert.throws(() => lib.postCommand(pr, '--approve', true), Error, 'a flag is not a review type');
  assert.deepEqual(pr, lib.parsePr(PR_MD), 'the parsed pr.md is not mutated');

  // markPosted: what the dispatcher writes once the command has succeeded.
  const link = `${url}#pullrequestreview-2`;
  const after = lib.markPosted(PR_MD, link, '2026-01-08 10:20');
  assert.equal(
    after,
    PR_MD.replace('Stands: comment ready |', 'Stands: waiting on author |')
      .replace(`${file}\n`, `${file}\nPosted: ${link}\n`)
      .replace('## Timeline\n', `## Timeline\n- 2026-01-08 10:20 — posted: ${link}\n`),
    'a Posted line under the comment path, Stands waiting on author, one timeline line; every other byte identical',
  );
  assert.equal(lib.parsePr(after).comment.posted, link, 'parsePr reads the link back');

  const again = `${url}#pullrequestreview-3`;
  const reposted = lib.markPosted(lib.setStands(after, 'comment ready'), again, '2026-01-09 08:00');
  assert.equal(
    reposted,
    after
      .replace(`Posted: ${link}\n`, `Posted: ${again}\n`)
      .replace('## Timeline\n', `## Timeline\n- 2026-01-09 08:00 — posted: ${again}\n`),
    'an existing Posted line is replaced, never doubled; the earlier timeline line stays',
  );
  assert.equal(reposted.split('\n').filter((line) => line.startsWith('Posted: ')).length, 1, 'exactly one Posted line');
});

test('standsAfter lets a comment or review move only a card that waits on the author; a card that waits on the manager or on a review keeps its state; re-review queued, merged and closed always apply', () => {
  const lib = load();
  assert.equal(typeof lib.standsAfter, 'function', 'pr-card-lib exports standsAfter(was, next)');

  for (const was of ['waiting on author', 'approved', 'updated']) {
    assert.equal(lib.standsAfter(was, 'updated'), 'updated', `a comment or review moves a card at "${was}" to "updated"`);
  }
  for (const was of ['comment ready', 'reviewing', 're-reviewing', 're-review queued']) {
    assert.equal(lib.standsAfter(was, 'updated'), was, `a comment or review leaves a card at "${was}" where it stands`);
  }
  const every = ['reviewing', 'comment ready', 'waiting on author', 'updated', 're-review queued', 're-reviewing', 'approved', 'merged', 'closed'];
  for (const next of ['re-review queued', 'merged', 'closed']) {
    for (const was of every) {
      assert.equal(lib.standsAfter(was, next), next, `"${next}" always applies, also to a card at "${was}"`);
    }
  }
});

test('postState says where a post is: refused when the newest timeline entry is the ! command, requested when it is the Post stamp, ready when a comment or a decision waits, otherwise none', () => {
  const lib = load();
  assert.equal(typeof lib.postState, 'function', 'pr-card-lib exports postState(pr)');

  const command = '! gh pr review https://github.com/octo-org/widget-api/pull/42 --request-changes --body-file tasks/2026-01-06-example-review/pr-comment.md';
  const ready = Object.freeze(lib.parsePr(PR_MD));
  assert.deepEqual(
    [ready.stands, ready.decisions.every((d) => d.chosen), ready.timeline[0].text],
    ['comment ready', true, 'octo-dev pushed 2 commits, re-review queued'],
    'fixture: comment ready, every decision chosen, an ordinary newest timeline entry',
  );
  assert.equal(lib.postState(ready), 'ready', 'a card at "comment ready" is ready to post');
  assert.equal(lib.postState({ ...ready, timeline: [] }), 'ready', 'a card at "comment ready" with an empty timeline is ready to post');

  const stamped = lib.parsePr(lib.addTimeline(PR_MD, '2026-01-08 10:15', 'Manager: post as request-changes'));
  assert.equal(lib.postState(stamped), 'requested', 'the newest entry is the Post stamp: requested, the dispatcher has not answered yet');

  const refused = lib.parsePr(lib.addTimeline(lib.addTimeline(PR_MD, '2026-01-08 10:15', 'Manager: post as request-changes'), '2026-01-08 10:16', command));
  assert.equal(lib.postState(refused), 'refused', 'the newest entry starts with "! ": the post was refused');
  assert.equal(refused.timeline[0].text, command, 'the command to run by hand is the newest timeline text, whole');

  const retried = lib.parsePr(lib.addTimeline(lib.addTimeline(PR_MD, '2026-01-08 10:16', command), '2026-01-08 10:30', 'Manager: post as approve'));
  assert.equal(lib.postState(retried), 'requested', 'only the newest entry counts: a Post stamped after a refusal is requested again');
  const moved = lib.parsePr(lib.addTimeline(lib.addTimeline(PR_MD, '2026-01-08 10:15', 'Manager: post as approve'), '2026-01-08 11:00', 'Manager: changes — soften the tone'));
  assert.equal(lib.postState(moved), 'ready', 'an older Post stamp under a newer entry is not a pending request');

  const open = lib.parsePr(lib.setStands(PR_MD.replace('Chosen: B\n', ''), 'updated'));
  assert.deepEqual([open.stands, open.decisions[0].chosen], ['updated', null], 'fixture: not at comment ready, one decision open');
  assert.equal(lib.postState(open), 'ready', 'an open decision makes the card ready whatever the state');

  for (const state of ['reviewing', 'waiting on author', 'updated', 're-review queued', 're-reviewing', 'approved', 'merged', 'closed']) {
    const idle = lib.parsePr(lib.setStands(PR_MD, state));
    assert.equal(lib.postState(idle), 'none', `a card at "${state}" with every decision chosen has nothing to post`);
    assert.equal(lib.postState({ ...idle, decisions: [] }), 'none', `a card at "${state}" with no decisions has nothing to post`);
  }
  assert.deepEqual(ready, lib.parsePr(PR_MD), 'the parsed pr.md is not mutated');
});

test('postState keeps a Post stamp or a refusal under newer watcher lines, until a posted: or round line answers it', () => {
  const lib = load();
  assert.equal(typeof lib.postState, 'function', 'pr-card-lib exports postState(pr)');

  const command = '! gh pr review https://github.com/octo-org/widget-api/pull/42 --approve --body-file tasks/2026-01-06-example-review/pr-comment.md';
  // Timeline lines oldest first, each one minute after the last, on the "comment ready" fixture.
  const card = (...texts) => Object.freeze(lib.parsePr(texts.reduce((md, text, n) => lib.addTimeline(md, `2026-01-08 10:${10 + n}`, text), PR_MD)));
  const newestFirst = (pr) => pr.timeline.slice(0, 3).map((t) => t.text);

  const stamped = card('Manager: post as approve', 'octo-peer commented');
  assert.deepEqual(
    [stamped.stands, ...newestFirst(stamped).slice(0, 2)],
    ['comment ready', 'octo-peer commented', 'Manager: post as approve'],
    'fixture: comment ready, a watcher line on top of the Post stamp',
  );
  assert.equal(lib.postState(stamped), 'requested', 'a watcher line on top of the Post stamp does not answer it: still requested');
  assert.equal(lib.postState(card('Manager: post as approve', 'octo-peer commented', 'octo-dev pushed 1 commit')), 'requested', 'two watcher lines on top of the Post stamp: still requested');

  const refused = card('Manager: post as approve', command, 'octo-peer commented');
  assert.deepEqual(newestFirst(refused), ['octo-peer commented', command, 'Manager: post as approve'], 'fixture: a watcher line on top of the refusal');
  assert.equal(lib.postState(refused), 'refused', 'a watcher line on top of the "! " command does not clear the refusal: still refused');

  assert.equal(lib.postState(card(command, 'Manager: post as approve', 'octo-peer commented')), 'requested', 'a Post stamped after a refusal wins under a watcher line: requested');
  assert.equal(lib.postState(card('Manager: post as approve', command, 'Manager: post as comment', command, 'octo-peer commented')), 'refused', 'a second refusal after a second Post wins under a watcher line: refused');

  const link = 'posted: https://github.com/octo-org/widget-api/pull/42#pullrequestreview-7';
  assert.equal(lib.postState(card('Manager: post as approve', link)), 'ready', 'a posted: line newer than the Post stamp answers it: not requested');
  assert.equal(lib.postState(card('Manager: post as approve', link, 'octo-peer commented')), 'ready', 'an answered Post stamp stays answered under a watcher line');
  assert.equal(lib.postState(card('Manager: post as approve', 'round 3: Approve, the backoff is in.')), 'ready', 'a new review round newer than the Post stamp answers it: not requested');
  assert.equal(lib.postState(card('Manager: post as approve', command, 'round 3: Approve, the backoff is in.', 'octo-peer commented')), 'ready', 'a new review round newer than the refusal clears it: not refused');

  assert.equal(lib.postState({ ...stamped, stands: 'waiting on author' }), 'none', 'a card that is not at "comment ready" with every decision chosen has nothing to post, whatever the timeline holds');
});

test('applyPrStamp records the decisions of a Posted stamp as Chosen lines, as Post does, and keeps the card; markPosted on the result leaves nothing that needs the manager', () => {
  const lib = load();
  assert.equal(typeof lib.applyPrStamp, 'function', 'pr-card-lib exports applyPrStamp({ pr, task }, stamp, at)');

  const task = 'tasks/2026-01-06-example-review';
  const Q1 = 'Block on the missing backoff, or let it through with a follow-up?';
  const Q2 = 'Mention the flaky export test in the comment?';
  const secondDecision = ['', `### ${Q2}`, '- A. Yes, one line', '- B. No, separate issue', 'Default: A'].join('\n');
  // A card whose comment is pasted by hand (TFS): no Post stamp ever records the choices.
  const pr = PR_MD
    .replace('https://github.com/octo-org/widget-api/pull/42', 'https://tfs.example.com/tfs/Main/_git/widget-api/pullrequest/42')
    .replace('Chosen: B\n', `Chosen: B${secondDecision}\n`);
  assert.deepEqual(lib.parsePr(pr).decisions.map((d) => d.chosen), ['B', null], 'fixture: one decision chosen, one open');
  const state = Object.freeze({ pr, task });
  const base = { type: 'answer', tag: 'PR', task, file: 'pr.md' };
  const withTimeline = (text, at, what) => text.replace('## Timeline\n', `## Timeline\n- ${at} — ${what}\n`);

  const plain = lib.applyPrStamp(state, { kind: 'posted' }, '2026-01-08 10:00');
  assert.equal(plain.pr, withTimeline(pr, '2026-01-08 10:00', 'Manager: posted by hand'), 'without decisions: one timeline line, nothing else');
  assert.deepEqual(plain.event, { ...base, answer: 'Posted' });

  const stamp = Object.freeze({ kind: 'posted', decisions: Object.freeze({ [Q1]: 'A', [Q2]: 'B' }) });
  const posted = lib.applyPrStamp(state, stamp, '2026-01-08 10:15');
  assert.equal(
    posted.pr,
    withTimeline(pr.replace('Chosen: B\n', 'Chosen: A\n').replace(`${secondDecision}\n`, `${secondDecision}\nChosen: B\n`), '2026-01-08 10:15', 'Manager: posted by hand'),
    'Posted: an existing Chosen line is rewritten, a missing one is added under Default, one timeline line is added, nothing else changes',
  );
  assert.equal(posted.close, false, 'Posted keeps the card open');
  assert.equal(posted.log ?? null, null, 'Posted writes no answered-item log line');
  assert.equal(posted.event.answer, 'Posted');
  assert.throws(
    () => lib.applyPrStamp(state, { kind: 'posted', decisions: { [Q2]: 'C' } }, '2026-01-08 10:17'),
    /C/,
    'a letter that is not one of that decision\'s options throws (Q2 has A and B only)',
  );

  const after = lib.parsePr(lib.markPosted(posted.pr, 'https://tfs.example.com/tfs/Main/_git/widget-api/pullrequest/42?discussionId=7', '2026-01-08 10:20'));
  assert.deepEqual([after.stands, after.decisions.map((d) => d.chosen)], ['waiting on author', ['A', 'B']]);
  assert.equal(lib.needsYou(after), false, 'posted by hand with every decision chosen: the card is for awareness');
  assert.deepEqual(state, { pr, task }, 'the inputs are not mutated');
});
