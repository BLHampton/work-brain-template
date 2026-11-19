const { test } = require('node:test');
const assert = require('node:assert/strict');
const { STANDS } = require('./pr-card-lib');

// Required inside each test so a missing export fails that test alone, on an assertion.
function load() {
  try {
    return require('./pr-watch-lib');
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') throw err;
    return {};
  }
}

test('parsePrUrl reads owner, repo and number from a GitHub PR url and rejects a TFS url', () => {
  const lib = load();
  assert.equal(typeof lib.parsePrUrl, 'function', 'pr-watch-lib exports parsePrUrl(url)');

  assert.deepEqual(lib.parsePrUrl('https://github.com/octo-org/widget-api/pull/42'), {
    owner: 'octo-org',
    repo: 'widget-api',
    number: 42,
  });
  assert.equal(
    lib.parsePrUrl('https://tfs.example.com/tfs/DefaultCollection/Widgets/_git/widget-api/pullrequest/41365'),
    null,
    'a TFS url is not a GitHub PR',
  );
});

test('add stores the entry with its first snapshot, returns no cards and leaves the input list alone', () => {
  const lib = load();
  assert.equal(typeof lib.add, 'function', 'pr-watch-lib exports add(list, { url, task, as }, snapshot)');

  const existing = {
    url: 'https://github.com/octo-org/widget-api/pull/7',
    task: 'tasks/2026-01-05-older-card',
    as: 'ours',
    snapshot: { state: 'OPEN', headRefOid: 'aaa1111', comments: [], reviews: [] },
  };
  const before = Object.freeze([existing]);
  const snapshot = {
    state: 'OPEN',
    headRefOid: 'bbb2222',
    comments: [{ id: 'IC_1', author: 'octo-dev' }],
    reviews: [{ id: 'PRR_1', author: 'octo-lead', state: 'COMMENTED' }],
  };

  const result = lib.add(
    before,
    { url: 'https://github.com/octo-org/widget-api/pull/42', task: 'tasks/2026-01-06-example-review', as: 'reviewed' },
    snapshot,
  );

  assert.deepEqual(result, {
    list: [
      existing,
      {
        url: 'https://github.com/octo-org/widget-api/pull/42',
        task: 'tasks/2026-01-06-example-review',
        as: 'reviewed',
        snapshot,
      },
    ],
    cards: [],
  });
  assert.notEqual(result.list, before, 'add returns a new list');
  assert.deepEqual(before, [existing], 'the input list is unchanged');
});

// What `check` returns when there is nothing to tell: the card and `pr.md` are left alone.
const quiet = (entry) => ({ entry, stands: null, headline: null, timeline: [], events: [], remove: false });

// Every state the watcher reports must be one the PR card accepts.
function assertStands(actual, expected, message) {
  assert.ok(STANDS.includes(expected), `"${expected}" is one of the PR card states`);
  assert.equal(actual, expected, message);
}

test('check on an identical snapshot returns the same entry, no state, no headline, no timeline or events, and keeps the entry', () => {
  const lib = load();
  assert.equal(typeof lib.check, 'function', 'pr-watch-lib exports check(entry, current, me, today)');

  const makeSnapshot = () => ({
    state: 'OPEN',
    headRefOid: 'bbb2222',
    comments: [{ id: 'IC_1', author: 'octo-dev' }],
    reviews: [{ id: 'PRR_1', author: 'octo-lead', state: 'CHANGES_REQUESTED' }],
  });
  const makeEntry = () => ({
    url: 'https://github.com/octo-org/widget-api/pull/42',
    task: 'tasks/2026-01-06-example-review',
    as: 'reviewed',
    snapshot: makeSnapshot(),
  });
  const entry = makeEntry();
  const current = makeSnapshot();

  const result = lib.check(entry, current, 'octo-me', '2026-01-07');

  assert.deepEqual(result, quiet(makeEntry()));
  assert.deepEqual(entry, makeEntry(), 'the input entry is not mutated');
  assert.deepEqual(current, makeSnapshot(), 'the current snapshot is not mutated');
});

test('check on a new comment by another user says the PR is updated with one headline and one undated timeline text, then nothing on the next check', () => {
  const lib = load();
  assert.equal(typeof lib.check, 'function', 'pr-watch-lib exports check(entry, current, me, today)');

  const makeEntry = () => ({
    url: 'https://github.com/octo-org/widget-api/pull/42',
    task: 'tasks/2026-01-06-example-review',
    as: 'reviewed',
    snapshot: {
      state: 'OPEN',
      headRefOid: 'bbb2222',
      comments: [{ id: 'IC_1', author: 'octo-dev' }],
      reviews: [{ id: 'PRR_1', author: 'octo-lead', state: 'CHANGES_REQUESTED' }],
    },
  });
  const makeCurrent = () => ({
    state: 'OPEN',
    headRefOid: 'bbb2222',
    comments: [
      { id: 'IC_1', author: 'octo-dev' },
      { id: 'IC_2', author: 'octo-peer' },
    ],
    reviews: [{ id: 'PRR_1', author: 'octo-lead', state: 'CHANGES_REQUESTED' }],
  });
  const entry = makeEntry();
  const current = makeCurrent();

  const first = lib.check(entry, current, 'octo-me', '2026-01-07');

  assertStands(first.stands, 'updated', 'a comment by someone else moves the card to updated');
  assert.equal(first.headline, 'updated: octo-peer commented', 'the headline leads with the state word, then what happened');
  assert.deepEqual(first.timeline, ['octo-peer commented'], 'one timeline text, without a date: the caller adds it');
  assert.deepEqual(
    first,
    {
      entry: { ...makeEntry(), snapshot: makeCurrent() },
      stands: 'updated',
      headline: 'updated: octo-peer commented',
      timeline: ['octo-peer commented'],
      events: [],
      remove: false,
    },
    'check returns { entry, stands, headline, timeline, events, remove } and no card or log lines',
  );
  assert.deepEqual(entry, makeEntry(), 'the input entry is not mutated');
  assert.deepEqual(current, makeCurrent(), 'the current snapshot is not mutated');

  const second = lib.check(first.entry, makeCurrent(), 'octo-me', '2026-01-07');

  assert.deepEqual(second, quiet(first.entry));
});

test('check on a new review by another user says approved, requested changes or commented in the headline and the timeline text', () => {
  const lib = load();
  assert.equal(typeof lib.check, 'function', 'pr-watch-lib exports check(entry, current, me, today)');

  const seenReview = { id: 'PRR_1', author: 'octo-lead', state: 'COMMENTED' };
  const makeEntry = () => ({
    url: 'https://github.com/octo-org/widget-api/pull/42',
    task: 'tasks/2026-01-06-example-review',
    as: 'ours',
    snapshot: {
      state: 'OPEN',
      headRefOid: 'bbb2222',
      comments: [{ id: 'IC_1', author: 'octo-dev' }],
      reviews: [seenReview],
    },
  });
  const makeCurrent = (review) => ({
    state: 'OPEN',
    headRefOid: 'bbb2222',
    comments: [{ id: 'IC_1', author: 'octo-dev' }],
    reviews: [seenReview, review],
  });
  const cases = [
    { review: { id: 'PRR_2', author: 'octo-peer', state: 'APPROVED' }, change: 'octo-peer approved' },
    { review: { id: 'PRR_3', author: 'octo-lead', state: 'CHANGES_REQUESTED' }, change: 'octo-lead requested changes' },
    { review: { id: 'PRR_4', author: 'octo-dev', state: 'COMMENTED' }, change: 'octo-dev commented' },
  ];

  for (const { review, change } of cases) {
    const entry = makeEntry();
    const current = makeCurrent(review);

    const result = lib.check(entry, current, 'octo-me', '2026-01-07');

    assertStands(result.stands, 'updated', `a new ${review.state} review moves the card to updated`);
    assert.equal(result.headline, `updated: ${change}`, `a new ${review.state} review makes one headline`);
    assert.deepEqual(result.timeline, [change], `a new ${review.state} review makes one timeline text`);
    assert.deepEqual(result.events, []);
    assert.equal(result.remove, false);
    assert.deepEqual(result.entry, { ...makeEntry(), snapshot: makeCurrent(review) }, 'the returned entry carries the current snapshot');
    assert.deepEqual(entry, makeEntry(), 'the input entry is not mutated');
  }
});

test('check on a new comment and a new review by the signed-in user returns no state, headline, timeline or events and still takes the current snapshot', () => {
  const lib = load();
  assert.equal(typeof lib.check, 'function', 'pr-watch-lib exports check(entry, current, me, today)');

  const makeEntry = () => ({
    url: 'https://github.com/octo-org/widget-api/pull/42',
    task: 'tasks/2026-01-06-example-review',
    as: 'reviewed',
    snapshot: {
      state: 'OPEN',
      headRefOid: 'bbb2222',
      comments: [{ id: 'IC_1', author: 'octo-dev' }],
      reviews: [{ id: 'PRR_1', author: 'octo-lead', state: 'CHANGES_REQUESTED' }],
    },
  });
  const makeCurrent = () => ({
    state: 'OPEN',
    headRefOid: 'bbb2222',
    comments: [
      { id: 'IC_1', author: 'octo-dev' },
      { id: 'IC_2', author: 'octo-me' },
    ],
    reviews: [
      { id: 'PRR_1', author: 'octo-lead', state: 'CHANGES_REQUESTED' },
      { id: 'PRR_2', author: 'octo-me', state: 'APPROVED' },
    ],
  });
  const entry = makeEntry();
  const current = makeCurrent();

  const result = lib.check(entry, current, 'octo-me', '2026-01-07');

  assert.equal(result.stands, null, 'my own comment and review do not move the card');
  assert.equal(result.headline, null, 'my own comment and review write no headline');
  assert.deepEqual(result.timeline, [], 'my own comment and review write no timeline text');
  assert.deepEqual(
    result,
    quiet({ ...makeEntry(), snapshot: makeCurrent() }),
    'the returned entry carries the current snapshot, so my items are not re-examined next poll',
  );
  assert.deepEqual(entry, makeEntry(), 'the input entry is not mutated');
  assert.deepEqual(current, makeCurrent(), 'the current snapshot is not mutated');
});

test('check on a new head sha on a reviewed PR says re-review queued with one headline, one timeline text and one REREVIEW event', () => {
  const lib = load();
  assert.equal(typeof lib.check, 'function', 'pr-watch-lib exports check(entry, current, me, today)');

  const makeEntry = () => ({
    url: 'https://github.com/octo-org/widget-api/pull/42',
    task: 'tasks/2026-01-06-example-review',
    as: 'reviewed',
    snapshot: {
      state: 'OPEN',
      headRefOid: 'bbb2222',
      comments: [{ id: 'IC_1', author: 'octo-dev' }],
      reviews: [{ id: 'PRR_1', author: 'octo-lead', state: 'CHANGES_REQUESTED' }],
    },
  });
  const makeCurrent = () => ({
    state: 'OPEN',
    headRefOid: 'ccc3333',
    comments: [{ id: 'IC_1', author: 'octo-dev' }],
    reviews: [{ id: 'PRR_1', author: 'octo-lead', state: 'CHANGES_REQUESTED' }],
  });
  const entry = makeEntry();
  const current = makeCurrent();

  const result = lib.check(entry, current, 'octo-me', '2026-01-07');

  assertStands(result.stands, 're-review queued', 'new commits on a reviewed PR move the card to re-review queued');
  assert.equal(result.headline, 're-review queued: new commits', 'the headline leads with the state word, then what happened');
  assert.deepEqual(result.timeline, ['new commits'], 'new commits on a reviewed PR make one timeline text');
  assert.deepEqual(
    result.events,
    ['REREVIEW tasks/2026-01-06-example-review https://github.com/octo-org/widget-api/pull/42 ccc3333'],
    'one REREVIEW line names the task, the url and the new sha',
  );
  assert.equal(result.remove, false);
  assert.deepEqual(
    result.entry,
    { ...makeEntry(), snapshot: makeCurrent(), rereview: 'queued', rereviewSha: 'ccc3333' },
    'the returned entry is queued for a re-review at the new sha and carries the current snapshot',
  );
  assert.deepEqual(entry, makeEntry(), 'the input entry is not mutated');
  assert.deepEqual(current, makeCurrent(), 'the current snapshot is not mutated');
});

test('check on a second new head sha while a re-review is queued moves the queued sha and returns no state, headline, timeline or events', () => {
  const lib = load();
  assert.equal(typeof lib.check, 'function', 'pr-watch-lib exports check(entry, current, me, today)');

  const makeEntry = () => ({
    url: 'https://github.com/octo-org/widget-api/pull/42',
    task: 'tasks/2026-01-06-example-review',
    as: 'reviewed',
    snapshot: {
      state: 'OPEN',
      headRefOid: 'ccc3333',
      comments: [{ id: 'IC_1', author: 'octo-dev' }],
      reviews: [{ id: 'PRR_1', author: 'octo-lead', state: 'CHANGES_REQUESTED' }],
    },
    rereview: 'queued',
    rereviewSha: 'ccc3333',
  });
  const makeCurrent = () => ({
    state: 'OPEN',
    headRefOid: 'ddd4444',
    comments: [{ id: 'IC_1', author: 'octo-dev' }],
    reviews: [{ id: 'PRR_1', author: 'octo-lead', state: 'CHANGES_REQUESTED' }],
  });
  const entry = makeEntry();
  const current = makeCurrent();

  const result = lib.check(entry, current, 'octo-me', '2026-01-08');

  assert.equal(result.stands, null, 'a second push while queued does not move the card');
  assert.equal(result.headline, null, 'a second push while queued writes no headline');
  assert.deepEqual(result.timeline, [], 'a second push while queued writes no timeline text');
  assert.deepEqual(result.events, [], 'a second push while queued emits no REREVIEW line');
  assert.equal(result.remove, false);
  assert.deepEqual(
    result.entry,
    { ...makeEntry(), snapshot: makeCurrent(), rereview: 'queued', rereviewSha: 'ddd4444' },
    'the returned entry stays queued, at the newest sha, and carries the current snapshot',
  );
  assert.deepEqual(entry, makeEntry(), 'the input entry is not mutated');
  assert.deepEqual(current, makeCurrent(), 'the current snapshot is not mutated');
});

test('check on a new head sha on an ours PR returns no state, headline, timeline or events, queues no re-review and takes the current snapshot', () => {
  const lib = load();
  assert.equal(typeof lib.check, 'function', 'pr-watch-lib exports check(entry, current, me, today)');

  const makeEntry = () => ({
    url: 'https://github.com/octo-org/widget-api/pull/42',
    task: 'tasks/2026-01-06-example-review',
    as: 'ours',
    snapshot: {
      state: 'OPEN',
      headRefOid: 'bbb2222',
      comments: [{ id: 'IC_1', author: 'octo-dev' }],
      reviews: [{ id: 'PRR_1', author: 'octo-lead', state: 'CHANGES_REQUESTED' }],
    },
  });
  const makeCurrent = () => ({
    state: 'OPEN',
    headRefOid: 'ccc3333',
    comments: [{ id: 'IC_1', author: 'octo-dev' }],
    reviews: [{ id: 'PRR_1', author: 'octo-lead', state: 'CHANGES_REQUESTED' }],
  });
  const entry = makeEntry();
  const current = makeCurrent();

  const result = lib.check(entry, current, 'octo-me', '2026-01-07');

  assert.equal(result.stands, null, 'new commits on our own PR do not move the card');
  assert.equal(result.headline, null, 'new commits on our own PR write no headline');
  assert.deepEqual(result.timeline, [], 'new commits on our own PR write no timeline text');
  assert.deepEqual(result.events, [], 'new commits on our own PR emit no REREVIEW line');
  assert.equal(result.remove, false);
  assert.equal('rereview' in result.entry, false, 'our own PR is never queued for a re-review');
  assert.equal('rereviewSha' in result.entry, false, 'our own PR carries no queued sha');
  assert.deepEqual(
    result.entry,
    { ...makeEntry(), snapshot: makeCurrent() },
    'the returned entry carries the current snapshot and nothing else new',
  );
  assert.deepEqual(entry, makeEntry(), 'the input entry is not mutated');
  assert.deepEqual(current, makeCurrent(), 'the current snapshot is not mutated');
});

test('check on a PR that became merged or closed says so in the state, the headline and one timeline text, with no events, and keeps the entry on the list', () => {
  const lib = load();
  assert.equal(typeof lib.check, 'function', 'pr-watch-lib exports check(entry, current, me, today)');

  const makeEntry = (as) => ({
    url: 'https://github.com/octo-org/widget-api/pull/42',
    task: 'tasks/2026-01-06-example-review',
    as,
    snapshot: {
      state: 'OPEN',
      headRefOid: 'bbb2222',
      comments: [{ id: 'IC_1', author: 'octo-dev' }],
      reviews: [{ id: 'PRR_1', author: 'octo-lead', state: 'CHANGES_REQUESTED' }],
    },
  });
  const makeCurrent = (state, headRefOid) => ({
    state,
    headRefOid,
    comments: [{ id: 'IC_1', author: 'octo-dev' }],
    reviews: [{ id: 'PRR_1', author: 'octo-lead', state: 'CHANGES_REQUESTED' }],
  });
  const cases = [
    { as: 'ours', state: 'MERGED', head: 'bbb2222', word: 'merged' },
    { as: 'ours', state: 'CLOSED', head: 'bbb2222', word: 'closed' },
    { as: 'reviewed', state: 'MERGED', head: 'bbb2222', word: 'merged' },
    { as: 'reviewed', state: 'CLOSED', head: 'bbb2222', word: 'closed' },
    // The head moved in the same poll: a finished PR is never re-reviewed.
    { as: 'reviewed', state: 'MERGED', head: 'ccc3333', word: 'merged' },
    { as: 'reviewed', state: 'CLOSED', head: 'ccc3333', word: 'closed' },
  ];

  for (const { as, state, head, word } of cases) {
    const label = `${as} PR, ${state}, head ${head === 'bbb2222' ? 'unchanged' : 'changed'}`;
    const entry = makeEntry(as);
    const current = makeCurrent(state, head);

    const result = lib.check(entry, current, 'octo-me', '2026-01-07');

    assertStands(result.stands, word, `${label}: the card moves to ${word}`);
    assert.equal(result.headline, word, `${label}: the headline says ${word}`);
    assert.deepEqual(result.timeline, [word], `${label}: one timeline text says ${word}`);
    assert.deepEqual(result.events, [], `${label}: no REREVIEW line`);
    assert.equal(result.remove, false, `${label}: the entry stays on the watch list until the card is stamped Done`);
    assert.deepEqual(
      result.entry,
      { ...makeEntry(as), snapshot: makeCurrent(state, head) },
      `${label}: the returned entry carries the finished snapshot and no queued re-review`,
    );
    assert.deepEqual(entry, makeEntry(as), `${label}: the input entry is not mutated`);
    assert.deepEqual(current, makeCurrent(state, head), `${label}: the current snapshot is not mutated`);

    const again = lib.check(result.entry, makeCurrent(state, head), 'octo-me', '2026-01-08');

    assert.deepEqual(again, quiet(result.entry), `${label}: the kept entry says nothing more on a later check`);
  }
});

test('check on several changes in one poll returns one state, one headline naming them in order and one timeline text per change', () => {
  const lib = load();
  assert.equal(typeof lib.check, 'function', 'pr-watch-lib exports check(entry, current, me, today)');

  const makeEntry = () => ({
    url: 'https://github.com/octo-org/widget-api/pull/42',
    task: 'tasks/2026-01-06-example-review',
    as: 'reviewed',
    snapshot: {
      state: 'OPEN',
      headRefOid: 'bbb2222',
      comments: [{ id: 'IC_1', author: 'octo-dev' }],
      reviews: [{ id: 'PRR_1', author: 'octo-lead', state: 'COMMENTED' }],
    },
  });
  const makeCurrent = (newComments) => ({
    state: 'OPEN',
    headRefOid: 'ccc3333',
    comments: [{ id: 'IC_1', author: 'octo-dev' }, ...newComments],
    reviews: [
      { id: 'PRR_1', author: 'octo-lead', state: 'COMMENTED' },
      { id: 'PRR_2', author: 'octo-lead', state: 'CHANGES_REQUESTED' },
    ],
  });

  // Fixed order: new comments, then new reviews, then the new head.
  const changes = ['octo-peer commented', 'octo-lead requested changes', 'new commits'];
  const entry = makeEntry();
  const current = makeCurrent([{ id: 'IC_2', author: 'octo-peer' }]);

  const result = lib.check(entry, current, 'octo-me', '2026-01-07');

  assertStands(result.stands, 're-review queued', 'new commits on a reviewed PR win over the comment and the review');
  assert.equal(
    result.headline,
    `re-review queued: ${changes.join('; ')}`,
    'a comment, a review and new commits in one poll make one headline naming all three',
  );
  assert.deepEqual(result.timeline, changes, 'a comment, a review and new commits in one poll make one timeline text each, in the same order');
  assert.deepEqual(
    result.events,
    ['REREVIEW tasks/2026-01-06-example-review https://github.com/octo-org/widget-api/pull/42 ccc3333'],
    'the re-review is still queued exactly once',
  );
  assert.equal(result.remove, false);
  assert.deepEqual(
    result.entry,
    { ...makeEntry(), snapshot: current, rereview: 'queued', rereviewSha: 'ccc3333' },
    'the returned entry is queued at the new sha and carries the current snapshot',
  );
  assert.deepEqual(entry, makeEntry(), 'the input entry is not mutated');

  // Many changes: still one headline with the state word first. It is not cut here; the card line is cut where it is written.
  const logins = [
    'octo-long-login-reviewer-one',
    'octo-long-login-reviewer-two',
    'octo-long-login-reviewer-three',
    'octo-long-login-reviewer-four',
    'octo-long-login-reviewer-five',
    'octo-long-login-reviewer-six',
  ];
  const full = [...logins.map((login) => `${login} commented`), 'octo-lead requested changes', 'new commits'];
  const many = lib.check(
    makeEntry(),
    makeCurrent(logins.map((author, i) => ({ id: `IC_${i + 2}`, author }))),
    'octo-me',
    '2026-01-07',
  );

  assertStands(many.stands, 're-review queued', 'six comments, a review and new commits still make one state');
  assert.equal(many.headline, `re-review queued: ${full.join('; ')}`, 'six comments, a review and new commits still make one headline, whole');
  assert.deepEqual(many.timeline, full, 'six comments, a review and new commits make eight timeline texts');
  assert.equal(many.events.length, 1, 'six comments, a review and new commits still queue one re-review');
});

test('poll leaves an entry whose fetch throws untouched with no update and one error, still applies the other entries and keeps a merged PR on the list', () => {
  const lib = load();
  assert.equal(typeof lib.poll, 'function', 'pr-watch-lib exports poll(list, fetch, me, today)');

  const makeSnapshot = (head) => ({
    state: 'OPEN',
    headRefOid: head,
    comments: [{ id: 'IC_1', author: 'octo-dev' }],
    reviews: [{ id: 'PRR_1', author: 'octo-lead', state: 'COMMENTED' }],
  });
  const urlOf = (number) => `https://github.com/octo-org/widget-api/pull/${number}`;
  const makeEntry = (number, task, as) => ({ url: urlOf(number), task, as, snapshot: makeSnapshot(`head${number}`) });
  const makeList = () => [
    makeEntry(41, 'tasks/2026-01-05-first-card', 'ours'),
    makeEntry(42, 'tasks/2026-01-06-example-review', 'reviewed'),
    makeEntry(43, 'tasks/2026-01-07-third-card', 'reviewed'),
  ];
  const commented = () => ({
    ...makeSnapshot('head41'),
    comments: [
      { id: 'IC_1', author: 'octo-dev' },
      { id: 'IC_2', author: 'octo-peer' },
    ],
  });
  const asked = [];
  const fetch = (entry) => {
    asked.push(entry.url);
    if (entry.url === urlOf(41)) return commented();
    if (entry.url === urlOf(42)) throw new Error('gh: rate limit exceeded');
    return makeSnapshot('head43');
  };
  const list = makeList();

  const result = lib.poll(list, fetch, 'octo-me', '2026-01-08');

  assert.deepEqual(Object.keys(result).sort(), ['errors', 'events', 'list', 'updates'], 'poll returns { list, updates, events, errors }');
  assert.deepEqual(asked, [urlOf(41), urlOf(42), urlOf(43)], 'every entry is fetched once, in order, after one fetch throws');
  assert.deepEqual(
    result.list,
    [{ ...makeList()[0], snapshot: commented() }, makeList()[1], makeList()[2]],
    'all three entries stay in order: the first takes its new snapshot, the failed one and the unchanged one are as they were',
  );
  assertStands(result.updates[0]?.stands, 'updated', 'the changed PR is reported as updated');
  assert.deepEqual(
    result.updates,
    [
      {
        task: 'tasks/2026-01-05-first-card',
        url: urlOf(41),
        repo: 'widget-api',
        number: 41,
        stands: 'updated',
        headline: 'updated: octo-peer commented',
        timeline: ['octo-peer commented'],
      },
    ],
    'one update for the PR that changed; none for the failed fetch or the unchanged PR',
  );
  assert.deepEqual(result.events, []);
  assert.equal(result.errors.length, 1, `exactly one error is reported, got ${JSON.stringify(result.errors)}`);
  const [error] = result.errors;
  assert.equal(typeof error, 'string', 'an error is a string');
  assert.ok(!error.includes('\n'), `an error is one line: ${error}`);
  assert.ok(error.includes(urlOf(42)), `the error names the PR whose fetch failed: ${error}`);
  assert.ok(error.includes('gh: rate limit exceeded'), `the error carries the failure message: ${error}`);
  assert.notEqual(result.list, list, 'poll returns a new list');
  assert.deepEqual(list, makeList(), 'the input list is not mutated');

  // A merged PR updates its card and stays on the watch list with its new snapshot; its neighbour stays too.
  const merged = () => ({ ...makeSnapshot('head41'), state: 'MERGED' });
  const merging = [makeList()[0], makeList()[2]];
  const done = lib.poll(
    merging,
    (entry) => (entry.url === urlOf(41) ? merged() : makeSnapshot('head43')),
    'octo-me',
    '2026-01-08',
  );

  assert.deepEqual(
    done.list,
    [{ ...makeList()[0], snapshot: merged() }, makeList()[2]],
    'the merged PR stays on the returned list with its merged snapshot',
  );
  assertStands(done.updates[0]?.stands, 'merged', 'the merged PR is reported as merged');
  assert.deepEqual(done.updates, [
    {
      task: 'tasks/2026-01-05-first-card',
      url: urlOf(41),
      repo: 'widget-api',
      number: 41,
      stands: 'merged',
      headline: 'merged',
      timeline: ['merged'],
    },
  ]);
  assert.deepEqual(done.events, []);
  assert.deepEqual(done.errors, []);
  assert.deepEqual(merging, [makeList()[0], makeList()[2]], 'the input list is not mutated');
});

test('poll does not fetch an entry whose snapshot is already merged or closed and leaves it on the list as it is', () => {
  const lib = load();
  assert.equal(typeof lib.poll, 'function', 'pr-watch-lib exports poll(list, fetch, me, today)');

  const makeSnapshot = (state, head) => ({
    state,
    headRefOid: head,
    comments: [{ id: 'IC_1', author: 'octo-dev' }],
    reviews: [{ id: 'PRR_1', author: 'octo-lead', state: 'COMMENTED' }],
  });
  const urlOf = (number) => `https://github.com/octo-org/widget-api/pull/${number}`;
  const makeList = () => [
    { url: urlOf(41), task: 'tasks/2026-01-05-first-card', as: 'ours', snapshot: makeSnapshot('MERGED', 'head41') },
    { url: urlOf(42), task: 'tasks/2026-01-06-example-review', as: 'reviewed', snapshot: makeSnapshot('CLOSED', 'head42') },
    { url: urlOf(43), task: 'tasks/2026-01-07-third-card', as: 'reviewed', snapshot: makeSnapshot('OPEN', 'head43') },
  ];
  const asked = [];
  // A finished PR that was fetched anyway would show a new comment and a new head.
  const fetch = (entry) => {
    asked.push(entry.url);
    return {
      ...entry.snapshot,
      headRefOid: entry.url === urlOf(43) ? 'head43' : 'moved',
      comments: [
        { id: 'IC_1', author: 'octo-dev' },
        ...(entry.url === urlOf(43) ? [] : [{ id: 'IC_2', author: 'octo-peer' }]),
      ],
    };
  };
  const list = makeList();

  const result = lib.poll(list, fetch, 'octo-me', '2026-01-09');

  assert.deepEqual(asked, [urlOf(43)], 'only the open PR is fetched; merged and closed ones wait for their Done stamp');
  assert.deepEqual(result.list, makeList(), 'the merged and closed entries stay on the list, untouched and in order');
  assert.deepEqual(result.updates, [], 'a finished PR raises no further update');
  assert.deepEqual(result.events, []);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(list, makeList(), 'the input list is not mutated');
});

test('remove drops the entry with that url, leaves the others alone and ignores an unknown url', () => {
  const lib = load();
  assert.equal(typeof lib.remove, 'function', 'pr-watch-lib exports remove(list, url)');

  const urlOf = (number) => `https://github.com/octo-org/widget-api/pull/${number}`;
  const makeSnapshot = (state, head) => ({
    state,
    headRefOid: head,
    comments: [{ id: 'IC_1', author: 'octo-dev' }],
    reviews: [{ id: 'PRR_1', author: 'octo-lead', state: 'COMMENTED' }],
  });
  const makeList = () => [
    { url: urlOf(41), task: 'tasks/2026-01-05-first-card', as: 'ours', snapshot: makeSnapshot('OPEN', 'head41') },
    { url: urlOf(42), task: 'tasks/2026-01-06-example-review', as: 'reviewed', snapshot: makeSnapshot('MERGED', 'head42') },
    { url: urlOf(43), task: 'tasks/2026-01-07-third-card', as: 'reviewed', snapshot: makeSnapshot('OPEN', 'head43') },
  ];
  const list = makeList();

  const result = lib.remove(list, urlOf(42));

  assert.deepEqual(result, [makeList()[0], makeList()[2]], 'the entry with that url is gone; the others and their order are kept');
  assert.notEqual(result, list, 'remove returns a new list');
  assert.deepEqual(list, makeList(), 'the input list is not mutated');

  const unknown = lib.remove(list, urlOf(99));

  assert.deepEqual(unknown, makeList(), 'an unknown url changes nothing');
  assert.deepEqual(list, makeList(), 'the input list is not mutated by an unknown url');
});

test('done clears the queued re-review on the entry with that url, leaves the others alone and ignores an unknown url', () => {
  const lib = load();
  assert.equal(typeof lib.done, 'function', 'pr-watch-lib exports done(list, url)');

  const urlOf = (number) => `https://github.com/octo-org/widget-api/pull/${number}`;
  const makeSnapshot = (head) => ({
    state: 'OPEN',
    headRefOid: head,
    comments: [{ id: 'IC_1', author: 'octo-dev' }],
    reviews: [{ id: 'PRR_1', author: 'octo-lead', state: 'COMMENTED' }],
  });
  const makeList = () => [
    { url: urlOf(41), task: 'tasks/2026-01-05-first-card', as: 'ours', snapshot: makeSnapshot('head41') },
    {
      url: urlOf(42),
      task: 'tasks/2026-01-06-example-review',
      as: 'reviewed',
      snapshot: makeSnapshot('ccc3333'),
      rereview: 'queued',
      rereviewSha: 'ccc3333',
    },
    {
      url: urlOf(43),
      task: 'tasks/2026-01-07-third-card',
      as: 'reviewed',
      snapshot: makeSnapshot('ddd4444'),
      rereview: 'queued',
      rereviewSha: 'ddd4444',
    },
  ];
  const list = makeList();

  const result = lib.done(list, urlOf(42));

  assert.ok(Array.isArray(result), 'done returns the new watch list');
  assert.equal(result.length, 3, 'no entry is added or dropped');
  assert.equal('rereview' in result[1], false, 'the started re-review is no longer queued (key absent, not null)');
  assert.equal('rereviewSha' in result[1], false, 'the queued sha goes with it (key absent, not null)');
  assert.deepEqual(
    result,
    [
      makeList()[0],
      { url: urlOf(42), task: 'tasks/2026-01-06-example-review', as: 'reviewed', snapshot: makeSnapshot('ccc3333') },
      makeList()[2],
    ],
    'only the entry with that url changes: the others, the order and its own snapshot are kept',
  );
  assert.notEqual(result, list, 'done returns a new list');
  assert.deepEqual(list, makeList(), 'the input list is not mutated');

  const unknown = lib.done(list, urlOf(99));

  assert.deepEqual(unknown, makeList(), 'an unknown url changes nothing');
  assert.deepEqual(list, makeList(), 'the input list is not mutated by an unknown url');
});

// --- bin/pr-watch writes the card's `where`, run against a fake `gh` ---
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PR_URL = 'https://github.com/octo-org/widget-api/pull/42';
const FOLDER = '2026-01-06-example-review';

// A brain root with one watched PR (a new comment by someone else is waiting) and a `gh` that reports it.
function watched(cardText) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-watch-'));
  fs.mkdirSync(path.join(root, 'tasks', FOLDER), { recursive: true });
  if (cardText != null) fs.writeFileSync(path.join(root, 'tasks', FOLDER, 'card.json'), cardText);
  const entry = { url: PR_URL, task: `tasks/${FOLDER}`, as: 'ours', snapshot: { state: 'OPEN', headRefOid: 'aaa', comments: [], reviews: [] } };
  fs.writeFileSync(path.join(root, 'pr-watch.json'), `${JSON.stringify([entry])}\n`);
  const bin = path.join(root, 'fakebin');
  fs.mkdirSync(bin);
  const view = JSON.stringify({ state: 'OPEN', headRefOid: 'aaa', title: 'Add retry', comments: [{ id: 'c1', author: { login: 'octo-dev' } }], reviews: [] });
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\nif [ "$1" = api ]; then echo me; else echo '${view}'; fi\n`, { mode: 0o755 });
  return root;
}
const runOnce = (root) =>
  spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'pr-watch'), 'once'], {
    encoding: 'utf8',
    env: { ...process.env, WORK_BRAIN_ROOT: root, PATH: `${path.join(root, 'fakebin')}:${process.env.PATH}` },
  });
const cardOf = (root) => JSON.parse(fs.readFileSync(path.join(root, 'tasks', FOLDER, 'card.json'), 'utf8'));
const CARD_JSON = { title: 'T', where: 'old', next: '', waiting_on: null, later: [], questions: [], result: null, lead_session: null, closed: '2026-01-05' };

test('bin/pr-watch on a closed card writes where and the timeline line but leaves the card closed', () => {
  const root = watched(JSON.stringify(CARD_JSON));
  const run = runOnce(root);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(cardOf(root).where, 'updated: octo-dev commented');
  assert.equal(cardOf(root).closed, '2026-01-05', 'a closed card is never reopened');
  assert.match(fs.readFileSync(path.join(root, 'tasks', FOLDER, 'pr.md'), 'utf8'), /— octo-dev commented$/m);
  assert.equal(fs.existsSync(path.join(root, 'inbox.md')), false, 'inbox.md is not touched');
});

test('bin/pr-watch creates card.json titled with the PR when the task has none', () => {
  const root = watched(null);
  assert.equal(runOnce(root).status, 0);
  assert.deepEqual([cardOf(root).title, cardOf(root).where, cardOf(root).closed], ['widget-api#42 · Add retry', 'updated: octo-dev commented', null]);
});

test('bin/pr-watch keeps the old snapshot and says "will retry" when card.json cannot be written', () => {
  const root = watched('{nope');
  const run = runOnce(root);
  assert.match(run.stderr, /card\.json: not saved, will retry/);
  const saved = JSON.parse(fs.readFileSync(path.join(root, 'pr-watch.json'), 'utf8'));
  assert.deepEqual(saved[0].snapshot.comments, [], 'the snapshot is unchanged, so the next poll finds the comment again');
  assert.equal(fs.existsSync(path.join(root, 'tasks', FOLDER, 'pr.md')), false, 'pr.md waits for the card');
});
