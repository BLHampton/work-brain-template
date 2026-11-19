const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createServer } = require('./server');

function brain() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-'));
  fs.mkdirSync(path.join(root, 'tasks', '2026-01-02-demo'), { recursive: true });
  fs.mkdirSync(path.join(root, 'repos'));
  fs.writeFileSync(path.join(root, 'tasks', '2026-01-02-demo', 'log.md'), '# log\n');
  return root;
}

const get = (port, p) => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path: p }, resolve).on('error', reject));
function post(port, p, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => resolve(JSON.parse(raw)));
    });
    req.on('error', reject); req.end(JSON.stringify(body));
  });
}

test('an answer is broadcast on /api/events as one JSON data line', async () => {
  const root = brain();
  const server = createServer(root, { notify: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const stream = await get(port, '/api/events');
  assert.equal(stream.headers['content-type'], 'text/event-stream');
  const firstData = new Promise((resolve) => {
    let buf = '';
    stream.on('data', (c) => { buf += c; const m = buf.match(/^data: (.*)$/m); if (m) resolve(JSON.parse(m[1])); });
  });
  addTask(root, '2026-01-04-ev', { card: { questions: [q('q1')] } });
  const reply = await post(port, '/api/card/answer', { task: '2026-01-04-ev', id: 'q1', answer: 'Approve: ship it' });
  assert.equal(reply.ok, true);
  const ev = await firstData;
  assert.deepEqual({ ...ev, date: undefined }, { type: 'answer', task: 'tasks/2026-01-04-ev', id: 'q1', kind: 'question', q: 'Q q1?', answer: 'Approve: ship it', date: undefined });
  assert.match(ev.date, /^\d{4}-\d{2}-\d{2}$/);
  stream.destroy();
  await new Promise((r) => server.close(r));
});

const getJson = (port, p) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: p }, (res) => {
    let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
  }).on('error', reject);
});

test('GET /api/roster lists one entry per agent file plus lead', async () => {
  const root = brain();
  fs.mkdirSync(path.join(root, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'agents', 'x.md'), '# x\n');
  fs.writeFileSync(path.join(root, '.claude', 'agents', 'y.md'), '# y\n');
  fs.writeFileSync(path.join(root, 'task-log.md'), '# Task log\n\ndate | ticket | what | lane | status\n');
  const server = createServer(root, { notify: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const { status, body } = await getJson(port, '/api/roster');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body.data.map((e) => e.name), ['x', 'y', 'lead']);
  assert.deepEqual(body.data.map((e) => e.status), ['idle', 'idle', 'idle']);
  await new Promise((r) => server.close(r));
});

// Queue of parsed `data:` events so a test can await them one at a time, with a timeout.
function eventQueue(stream) {
  const events = []; const waiters = []; let buf = '';
  stream.on('data', (c) => {
    buf += c;
    let m;
    while ((m = buf.match(/^data: (.*)\n\n/m))) { buf = buf.slice(m.index + m[0].length); const ev = JSON.parse(m[1]); waiters.length ? waiters.shift()(ev) : events.push(ev); }
  });
  return (ms) => Promise.race([
    events.length ? Promise.resolve(events.shift()) : new Promise((r) => waiters.push(r)),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`no event on /api/events within ${ms} ms`)), ms).unref()),
  ]);
}

test('GET /api/file rejects traversal with 400, serves suggestion-box.md, and GET /api/files returns the brain tree', async () => {
  const root = brain();
  fs.writeFileSync(path.join(root, 'suggestion-box.md'), '# Suggestion box\n\n- 2026-01-02: split app.js\n');
  const server = createServer(root, { notify: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const bad = await getJson(port, '/api/file?path=' + encodeURIComponent('../CLAUDE.md'));
    assert.equal(bad.status, 400);
    assert.equal(bad.body.ok, false);
    assert.equal(bad.body.data, null);
    assert.equal(typeof bad.body.error, 'string');

    const good = await getJson(port, '/api/file?path=suggestion-box.md');
    assert.equal(good.status, 200);
    assert.deepEqual(good.body, { ok: true, data: { path: 'suggestion-box.md', text: '# Suggestion box\n\n- 2026-01-02: split app.js\n' }, error: null });

    const tree = await getJson(port, '/api/files');
    assert.equal(tree.status, 200);
    assert.equal(tree.body.ok, true);
    assert.equal(tree.body.data.suggestionBox, 'suggestion-box.md');
    assert.ok(Array.isArray(tree.body.data.tasks));
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('GET /api/board returns one entry per task-log row with folder resolved by date and openItems counted from the card open questions', async () => {
  const root = brain(); // has tasks/2026-01-02-demo
  fs.writeFileSync(path.join(root, 'task-log.md'), [
    '# Task log',
    '',
    'date | ticket | what | lane | status',
    '2026-01-02 | TICKET-1 | demo work | quick | in-progress',
    '2026-01-05 | none | no folder yet | standard | pr-open',
    '',
  ].join('\n'));
  addTask(root, '2026-01-02-demo', { card: { questions: [q('q1'), q('q2'), q('q3', 'done', '2026-01-03')] } });
  const server = createServer(root, { notify: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const { status, body } = await getJson(port, '/api/board');
    assert.equal(status, 200);
    assert.deepEqual(body, {
      ok: true,
      data: [
        { date: '2026-01-02', ticket: 'TICKET-1', what: 'demo work', lane: 'quick', status: 'in-progress', folder: 'tasks/2026-01-02-demo', openItems: 2 },
        { date: '2026-01-05', ticket: 'none', what: 'no folder yet', lane: 'standard', status: 'pr-open', folder: null, openItems: 0 },
      ],
      error: null,
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// Like post() but keeps the status so a 404 envelope can be asserted alongside its code.
function postJson(port, p, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
    });
    req.on('error', reject); req.end(JSON.stringify(body));
  });
}

test('GET /api/index answers 200 with { text } equal to index-lib index(root) for a brain with one status.json', async () => {
  const { index } = require('./index-lib');
  const root = brain(); // has tasks/2026-01-02-demo
  fs.writeFileSync(path.join(root, 'tasks', '2026-01-02-demo', 'status.json'), JSON.stringify({
    card: 'TICKET-1', folder: 'tasks/2026-01-02-demo', lane: 'standard', stage: 'plan', repo: '/tmp/x',
    attempts: 0, review_round: 0, awaiting: 'plan approval', look_flags: [], blocked_reason: null, updated: '2026-01-02T09:00:00-06:00',
  }));
  const server = createServer(root, { notify: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const { status, body } = await getJson(port, '/api/index');
    assert.equal(status, 200, `GET /api/index answers 200, got ${status} ${JSON.stringify(body)}`);
    assert.deepEqual(body, { ok: true, data: { text: index(root) }, error: null });
    assert.match(body.data.text, /TICKET-1 \| standard \| plan \| attempt 0 \| round 0 \| tasks\/2026-01-02-demo/, 'the text is the rendered thin index, not an empty string');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('POST /api/park, /api/unpark and /api/drop with { task } write the new status, answer 200 with it, and broadcast an event of the same name', async () => {
  const root = brain(); // tasks/2026-01-02-demo
  const folder = '2026-01-02-demo';
  const statusPath = path.join(root, 'tasks', folder, 'status.json');
  fs.writeFileSync(statusPath, JSON.stringify({ card: 'TICKET-1', folder: `tasks/${folder}`, lane: 'standard', stage: 'tdd' }, null, 2));
  const readStatus = () => JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  const server = createServer(root, { notify: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const stream = await get(port, '/api/events');
  const next = eventQueue(stream);
  try {
    // route → the field the helper sets
    const cases = [
      { route: '/api/park', field: 'parked', value: true },
      { route: '/api/unpark', field: 'parked', value: false },
      { route: '/api/drop', field: 'stage', value: 'done' },
    ];
    for (const { route, field, value } of cases) {
      const name = route.slice('/api/'.length);
      const { status, body } = await postJson(port, route, { task: folder });
      assert.equal(status, 200, `POST ${route} answers 200, got ${status} ${JSON.stringify(body)}`);
      assert.equal(body.ok, true);
      assert.equal(body.error, null);
      assert.equal(body.data[field], value, `POST ${route} returns a status with ${field} = ${JSON.stringify(value)}`);
      assert.equal(body.data.stage, name === 'drop' ? 'done' : 'tdd', `${name} ${name === 'drop' ? 'ends' : 'keeps'} the stage`);
      assert.deepEqual(body.data, readStatus(), `POST ${route} returns the status.json it wrote`);
      const ev = await next(1500);
      assert.equal(ev.type, name, `POST ${route} broadcasts { type: ${JSON.stringify(name)} } on /api/events`);
      assert.equal(ev.task, `tasks/${folder}`, 'the event names the task as tasks/<folder>, like answer / close / reopen');
    }
    assert.match(readStatus().dropped, /^\d{4}-\d{2}-\d{2}$/, 'drop stamps the dropped date as YYYY-MM-DD');
  } finally {
    stream.destroy();
    await new Promise((r) => server.close(r));
  }
});

test('GET /api/stats answers 200 with { cards, generatedAt }, cards sorted by agent + dispatcher seconds descending, folders without dispatches absent', async () => {
  const { readStatuses } = require('./index-lib');
  const { readDispatches } = require('./roster-lib');
  const { pairDispatches, statsByCard } = require('./stats-lib');
  const root = brain(); // has tasks/2026-01-02-demo
  const status = (folder, card, extra = {}) => {
    fs.mkdirSync(path.join(root, 'tasks', folder), { recursive: true });
    fs.writeFileSync(path.join(root, 'tasks', folder, 'status.json'), JSON.stringify({ card, folder: `tasks/${folder}`, lane: 'standard', stage: 'tdd', awaiting: null, ...extra }));
  };
  status('2026-01-02-demo', 'TICKET-1');
  status('2026-01-03-big', 'TICKET-2');
  status('2026-01-04-quiet', 'TICKET-3'); // a status with no dispatches must not appear
  // demo: one 60 s dispatch, no gap. big: 300 s + 180 s of agent time with a 120 s dispatcher gap between.
  // demo is written first so insertion order and the required sort order disagree.
  const rows = [
    { ts: '2026-01-02T09:00:00.000Z', id: 'toolu_1', agent: 'implementer', mission: 'make test 1 green', task: 'tasks/2026-01-02-demo' },
    { ts: '2026-01-02T09:01:00.000Z', id: 'toolu_1', agent: 'implementer', done: true, seconds: 60 },
    { ts: '2026-01-03T09:00:00.000Z', id: 'toolu_2', agent: 'test-writer', mission: 'write test 1', task: 'tasks/2026-01-03-big' },
    { ts: '2026-01-03T09:05:00.000Z', id: 'toolu_2', agent: 'test-writer', done: true, seconds: 300 },
    { ts: '2026-01-03T09:07:00.000Z', id: 'toolu_3', agent: 'implementer', mission: 'make test 1 green', task: 'tasks/2026-01-03-big' },
    { ts: '2026-01-03T09:10:00.000Z', id: 'toolu_3', agent: 'implementer', done: true, seconds: 180 },
  ];
  fs.mkdirSync(path.join(root, 'ui'));
  fs.writeFileSync(path.join(root, 'ui', 'dispatch.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const server = createServer(root, { notify: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const { status: code, body } = await getJson(port, '/api/stats');
    assert.equal(code, 200, `GET /api/stats answers 200, got ${code} ${JSON.stringify(body)}`);
    assert.equal(body.ok, true);
    assert.equal(body.error, null);
    assert.deepEqual(Object.keys(body.data).sort(), ['cards', 'generatedAt']);
    assert.match(body.data.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, 'generatedAt is an ISO timestamp');

    const expected = statsByCard(pairDispatches(readDispatches(root)), readStatuses(root))
      .sort((a, b) => (b.agentSeconds + b.dispatcherSeconds) - (a.agentSeconds + a.dispatcherSeconds));
    assert.deepEqual(body.data.cards, expected, 'cards are statsByCard over the live dispatch.jsonl and status files');
    assert.deepEqual(body.data.cards.map((c) => c.folder), ['tasks/2026-01-03-big', 'tasks/2026-01-02-demo'], 'slowest card first, not file order');
    assert.deepEqual(body.data.cards.map((c) => c.agentSeconds + c.dispatcherSeconds), [600, 60]);
    assert.deepEqual(body.data.cards.map((c) => c.card), ['TICKET-2', 'TICKET-1'], 'card names come from status.json');
    assert.ok(!body.data.cards.some((c) => c.folder === 'tasks/2026-01-04-quiet'), 'a folder with a status but no dispatches is absent');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// Raw response (status, headers, body text) for routes that send a file instead of the JSON envelope.
const getRaw = (port, p) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: p }, (res) => {
    let raw = ''; res.setEncoding('utf8'); res.on('data', (c) => (raw += c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: raw }));
  }).on('error', reject);
});

test('GET /api/task-file serves research/mockups.html raw as text/html; a `..` path 400s and a missing file 404s with the JSON envelope', async () => {
  const root = brain(); // has tasks/2026-01-02-demo
  const html = '<!doctype html>\n<html><body><h1>Variant A · recommended</h1></body></html>\n';
  fs.mkdirSync(path.join(root, 'tasks', '2026-01-02-demo', 'research'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tasks', '2026-01-02-demo', 'research', 'mockups.html'), html);
  const server = createServer(root, { notify: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const good = await getRaw(port, '/api/task-file?folder=2026-01-02-demo&path=' + encodeURIComponent('research/mockups.html'));
    assert.equal(good.status, 200, `GET /api/task-file on an existing mockups.html answers 200, got ${good.status} ${good.body}`);
    assert.match(good.headers['content-type'], /^text\/html/, 'the body is sent as text/html, not the JSON envelope');
    assert.equal(good.body, html, 'the response body is the file verbatim');

    const cases = [
      { path: '../inbox.md', status: 400, why: 'a `..` segment is refused before any read' },
      { path: 'research/missing.html', status: 404, why: 'a well-formed path to a file that is not there' },
    ];
    for (const c of cases) {
      const res = await getRaw(port, '/api/task-file?folder=2026-01-02-demo&path=' + encodeURIComponent(c.path));
      assert.equal(res.status, c.status, `${c.why}: path=${c.path} answers ${c.status}, got ${res.status} ${res.body}`);
      assert.match(res.headers['content-type'], /^application\/json/, `${c.why}: errors keep the JSON envelope`);
      const body = JSON.parse(res.body);
      assert.equal(body.ok, false);
      assert.equal(body.data, null);
      assert.equal(typeof body.error, 'string');
    }
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('GET /api/task-file sandboxes the served file with `Content-Security-Policy: sandbox` so an inline script cannot reach /api/card/answer as the UI origin', async () => {
  const root = brain();
  const html = '<!doctype html>\n<html><body><script>fetch("/api/card/answer", { method: "POST" })</script></body></html>\n';
  fs.mkdirSync(path.join(root, 'tasks', '2026-01-02-demo', 'research'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tasks', '2026-01-02-demo', 'research', 'mockups.html'), html);
  const server = createServer(root, { notify: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const res = await getRaw(port, '/api/task-file?folder=2026-01-02-demo&path=' + encodeURIComponent('research/mockups.html'));
    assert.equal(res.status, 200, `the file is still served, got ${res.status} ${res.body}`);
    assert.equal(res.headers['content-security-policy'], 'sandbox', 'a worker-written mockups.html is served from the UI origin, so the 200 must carry CSP `sandbox` (opaque origin, no scripts, no fetch to the UI)');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('a curl subscriber on /api/events counts as a listener and broadcasts the change; a browser subscriber does not count', async () => {
  const root = brain();
  const server = createServer(root, { notify: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const subscribeAs = (ua) => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path: '/api/events', headers: { 'user-agent': ua } }, resolve).on('error', reject));
  try {
    const browser = await subscribeAs('Mozilla/5.0 (Windows NT 10.0)');
    const next = eventQueue(browser);
    assert.deepEqual((await getJson(port, '/api/listening')).body, { ok: true, data: { listeners: 0 }, error: null }, 'a browser tab is not a listener');
    const curl = await subscribeAs('curl/8.5.0');
    assert.deepEqual(await next(2000), { type: 'listening', listeners: 1 });
    assert.equal((await getJson(port, '/api/listening')).body.data.listeners, 1);
    curl.destroy();
    assert.deepEqual(await next(2000), { type: 'listening', listeners: 0 });
    assert.equal((await getJson(port, '/api/listening')).body.data.listeners, 0);
    browser.destroy();
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('POST /api/card/pr-stamp: a Post stamp records it in pr.md, keeps the card open and broadcasts { type: answer, tag: PR }; a Done stamp closes the card', async () => {
  const root = brain();
  const dir = path.join(root, 'tasks', '2026-01-02-demo');
  const question = 'Block on the missing backoff?';
  addTask(root, '2026-01-02-demo', { card: { title: 'Demo PR', where: 'comment ready' } });
  const cardJson = () => JSON.parse(fs.readFileSync(path.join(dir, 'card.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'pr.md'), [
    '# widget-api#42 — Add retry to the export client',
    'Stands: comment ready | Round: 1 | Url: https://github.com/octo-org/widget-api/pull/42',
    '',
    '## Verdict',
    'Comment: fine once the backoff is in.',
    '',
    '## Still to do',
    '- [ ] Post the review comment',
    '',
    '## Decisions',
    `### ${question}`,
    '- A. Request changes',
    '- B. Comment only',
    'Default: A',
    '',
    '## Comment',
    'tasks/2026-01-02-demo/pr-comment.md',
    '',
    '## Timeline',
    '- 2026-01-02 09:00 — round 1 comment drafted',
    '',
  ].join('\n'));
  const server = createServer(root, { notify: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const stream = await get(port, '/api/events');
  const next = eventQueue(stream);
  const nextAnswer = async () => { for (;;) { const ev = await next(2500); if (ev.type === 'answer') return ev; } }; // skips { type: cards } file-watch events
  const task = '2026-01-02-demo';
  try {
    const posted = await postJson(port, '/api/card/pr-stamp', { task, answer: 'Post', review: 'comment', decisions: { [question]: 'B' } });
    assert.equal(posted.status, 200);
    assert.equal(posted.body.data.folder, task, 'the reply is the card row');
    assert.equal(posted.body.data.state, 'needs you', 'a comment ready on the PR keeps the card on the manager');
    assert.equal(cardJson().closed, null, 'a Post stamp leaves the card open');
    const pr = fs.readFileSync(path.join(dir, 'pr.md'), 'utf8');
    assert.match(pr, /^Default: A\nChosen: B$/m, 'pr.md records the chosen option');
    assert.match(pr, /^## Timeline\n- \d{4}-\d{2}-\d{2} \d{2}:\d{2} — Manager: post as comment\n- 2026-01-02 09:00 — /m, 'pr.md gains one timeline line, newest first');
    assert.match(pr, /^Stands: comment ready \| /m, 'Stands is left for the dispatcher to move once the post succeeds');
    const ev = await nextAnswer();
    assert.deepEqual(
      { tag: ev.tag, answer: ev.answer, review: ev.review, decisions: ev.decisions, task: ev.task, file: ev.file },
      { tag: 'PR', answer: 'Post', review: 'comment', decisions: { [question]: 'B' }, task: 'tasks/2026-01-02-demo', file: 'pr.md' },
    );

    const done = await postJson(port, '/api/card/pr-stamp', { task, answer: 'Done' });
    assert.equal(done.status, 200);
    assert.equal(done.body.data.state, 'closed');
    assert.match(cardJson().closed, /^\d{4}-\d{2}-\d{2}$/, 'a Done stamp closes the card');
    assert.equal((await nextAnswer()).answer, 'Done');
    assert.match(fs.readFileSync(path.join(dir, 'log.md'), 'utf8'), /^- \d{4}-\d{2}-\d{2} — card \(PR\): widget-api#42 → Done$/m, 'Done is logged');
  } finally {
    stream.destroy();
    await new Promise((r) => server.close(r));
  }
});

test('POST /api/card/pr-stamp refuses a second Post with 409 and one line, writes nothing more to pr.md and broadcasts nothing; Changes and Done are still accepted', async () => {
  const root = brain();
  const dir = path.join(root, 'tasks', '2026-01-02-demo');
  const prPath = path.join(dir, 'pr.md');
  addTask(root, '2026-01-02-demo', { card: {} });
  fs.writeFileSync(prPath, [
    '# widget-api#42 — Add retry to the export client',
    'Stands: comment ready | Round: 1 | Url: https://github.com/octo-org/widget-api/pull/42',
    '',
    '## Verdict',
    'Comment: fine once the backoff is in.',
    '',
    '## Still to do',
    '- [ ] Post the review comment',
    '',
    '## Decisions',
    '',
    '## Comment',
    'tasks/2026-01-02-demo/pr-comment.md',
    '',
    '## Timeline',
    '- 2026-01-02 09:00 — round 1 comment drafted',
    '',
  ].join('\n'));
  const server = createServer(root, { notify: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const stream = await get(port, '/api/events');
  const next = eventQueue(stream);
  const nextAnswer = async () => { for (;;) { const ev = await next(2500); if (ev.type === 'answer') return ev; } }; // skips { type: cards } file-watch events
  const prText = () => fs.readFileSync(prPath, 'utf8');
  const stamps = () => prText().split('\n').filter((line) => line.includes(' — Manager: '));
  try {
    const task = '2026-01-02-demo';
    const first = await postJson(port, '/api/card/pr-stamp', { task, answer: 'Post', review: 'comment' });
    assert.equal(first.status, 200, 'the first Post is accepted');
    assert.equal((await nextAnswer()).answer, 'Post');
    const afterFirst = prText();
    assert.equal(stamps().length, 1, 'fixture: one Post stamp on the timeline');

    const second = await postJson(port, '/api/card/pr-stamp', { task, answer: 'Post', review: 'comment' });
    assert.equal(second.status, 409, 'a second Post while the first waits on the dispatcher is refused');
    assert.equal(second.body.ok, false);
    assert.match(second.body.error, /^[^\n]*post[^\n]*$/i, 'the refusal is one line that names the pending Post');
    assert.equal(prText(), afterFirst, 'the refused Post writes nothing to pr.md');

    const changed = await postJson(port, '/api/card/pr-stamp', { task, answer: 'Changes: soften the tone' });
    assert.equal(changed.status, 200, 'Changes is still accepted after a Post');
    assert.equal((await nextAnswer()).answer, 'Changes', 'the refused Post broadcast no event: the next answer event is the Changes stamp');
    assert.deepEqual(stamps().map((line) => line.replace(/^- \d{4}-\d{2}-\d{2} \d{2}:\d{2} — /, '')), ['Manager: changes — soften the tone', 'Manager: post as comment']);

    const done = await postJson(port, '/api/card/pr-stamp', { task, answer: 'Done' });
    assert.equal(done.status, 200, 'Done is still accepted after a Post');
    assert.equal((await nextAnswer()).answer, 'Done');
    assert.equal(done.body.data.state, 'closed');
  } finally {
    stream.destroy();
    await new Promise((r) => server.close(r));
  }
});

// --- cards ---
const DEMO = '2026-01-02-demo';
const q = (id, answer = null, answered = null) => ({ id, kind: 'question', q: `Q ${id}?`, suggested: 'Yes', why: 'w', file: null, asked: '2026-01-02', answer, answered });
function addTask(root, name, { stage = 'tdd', updated = '2026-01-02T10:00', card } = {}) {
  const dir = path.join(root, 'tasks', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({ card: 'TICKET-123', lane: 'standard', stage, updated }));
  if (card !== undefined) fs.writeFileSync(path.join(dir, 'card.json'), typeof card === 'string' ? card : JSON.stringify({ title: 'T', where: 'w', next: 'n', waiting_on: null, later: [], questions: [], result: null, lead_session: null, closed: null, ...card }));
  return dir;
}
async function withServer(root, fn) {
  const server = createServer(root, { notify: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try { await fn(server.address().port); } finally { await new Promise((r) => server.close(r)); }
}

test('GET /api/cards lists needs-you before working, newest first within a state', async () => {
  const root = brain();
  addTask(root, '2026-01-03-work', { updated: '2026-01-03T10:00', card: { title: 'Working' } });
  addTask(root, '2026-01-04-ask', { updated: '2026-01-01T10:00', card: { title: 'Asking', questions: [q('q1')] } });
  addTask(root, '2026-01-05-work2', { updated: '2026-01-05T10:00', card: { title: 'Working 2' } });
  await withServer(root, async (port) => {
    const { status, body } = await getJson(port, '/api/cards');
    assert.equal(status, 200);
    const rows = body.data.filter((r) => r.folder !== DEMO);
    assert.deepEqual(rows.map((r) => [r.folder, r.state]), [['2026-01-04-ask', 'needs you'], ['2026-01-05-work2', 'working'], ['2026-01-03-work', 'working']]);
    assert.equal(rows[0].title, 'Asking');
    assert.equal(rows[0].lane, 'standard');
    assert.equal(rows[0].questions.length, 1);
  });
});

test('a broken card.json is a row with unreadable, still HTTP 200', async () => {
  const root = brain();
  addTask(root, '2026-01-03-bad', { card: '{nope' });
  await withServer(root, async (port) => {
    const { status, body } = await getJson(port, '/api/cards');
    assert.equal(status, 200);
    const row = body.data.find((r) => r.folder === '2026-01-03-bad');
    assert.ok(row.unreadable);
    assert.equal(row.title, 'TICKET-123');
  });
});

test('five open questions show three and queue two', async () => {
  const root = brain();
  addTask(root, '2026-01-03-many', { card: { questions: ['q1', 'q2', 'q3', 'q4', 'q5'].map((id) => q(id)) } });
  await withServer(root, async (port) => {
    const row = (await getJson(port, '/api/cards')).body.data.find((r) => r.folder === '2026-01-03-many');
    assert.deepEqual(row.questions.map((x) => x.id), ['q1', 'q2', 'q3']);
    assert.equal(row.queued, 2);
  });
});

test('POST /api/card/answer returns the row, logs it, broadcasts, and a repeat is 409 with the file untouched', async () => {
  const root = brain();
  const dir = addTask(root, '2026-01-03-ask', { card: { questions: [q('q1')] } });
  await withServer(root, async (port) => {
    const stream = await get(port, '/api/events');
    const next = eventQueue(stream);
    const r = await post(port, '/api/card/answer', { task: '2026-01-03-ask', id: 'q1', answer: ' Yes please ' });
    assert.equal(r.ok, true);
    assert.equal(r.data.state, 'working');
    assert.equal(r.data.decided[0].id, 'q1');
    assert.equal(r.data.decided[0].answer, 'Yes please');
    assert.match(fs.readFileSync(path.join(dir, 'log.md'), 'utf8'), /^- \d{4}-\d{2}-\d{2} — card: Q q1\? → Yes please$/m);
    let ev = await next(2000);
    while (ev.type !== 'answer') ev = await next(2000);
    assert.deepEqual({ ...ev, date: undefined }, { type: 'answer', task: 'tasks/2026-01-03-ask', id: 'q1', kind: 'question', q: 'Q q1?', answer: 'Yes please', date: undefined });
    assert.match(ev.date, /^\d{4}-\d{2}-\d{2}$/);
    const before = fs.readFileSync(path.join(dir, 'card.json'), 'utf8');
    const again = await post(port, '/api/card/answer', { task: '2026-01-03-ask', id: 'q1', answer: 'Yes please' });
    assert.equal(again.ok, false);
    assert.equal(fs.readFileSync(path.join(dir, 'card.json'), 'utf8'), before);
    stream.destroy();
  });
});

test('card answer errors: 409 for answered, 404 unknown question/task, 400 bad answer or folder', async () => {
  const root = brain();
  addTask(root, '2026-01-03-ask', { card: { questions: [q('q1', 'done', '2026-01-02')] } });
  addTask(root, '2026-01-03-nocard');
  const status = async (body) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api/card/answer', method: 'POST' }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end(JSON.stringify(body));
  });
  let PORT;
  await withServer(root, async (port) => {
    PORT = port;
    assert.equal(await status({ task: '2026-01-03-ask', id: 'q1', answer: 'x' }), 409);
    assert.equal(await status({ task: '2026-01-03-ask', id: 'q9', answer: 'x' }), 404);
    assert.equal(await status({ task: '2026-01-09-none', id: 'q1', answer: 'x' }), 404);
    assert.equal(await status({ task: '2026-01-03-nocard', id: 'q1', answer: 'x' }), 404);
    assert.equal(await status({ task: '../etc', id: 'q1', answer: 'x' }), 400);
    assert.equal(await status({ task: '2026-01-03-ask', id: 'q1', answer: '' }), 400);
    assert.equal(await status({ task: '2026-01-03-ask', id: 'q1', answer: 'x'.repeat(2001) }), 400);
  });
});

test('close then reopen flips state to closed and back, with events', async () => {
  const root = brain();
  addTask(root, '2026-01-03-work', { card: {} });
  await withServer(root, async (port) => {
    const stream = await get(port, '/api/events');
    const next = eventQueue(stream);
    const closed = await post(port, '/api/card/close', { task: '2026-01-03-work' });
    assert.equal(closed.data.state, 'closed');
    let ev = await next(2000);
    while (ev.type !== 'close') ev = await next(2000);
    assert.equal(ev.task, 'tasks/2026-01-03-work');
    const reopened = await post(port, '/api/card/reopen', { task: '2026-01-03-work' });
    assert.equal(reopened.data.state, 'working');
    ev = await next(2000);
    while (ev.type !== 'reopen') ev = await next(2000);
    stream.destroy();
  });
});

test('a pr.md that needs the manager makes the row needs you; one that fails to parse gives pr null', async () => {
  const root = brain();
  const a = addTask(root, '2026-01-03-pr', { card: {} });
  fs.writeFileSync(path.join(a, 'pr.md'), '# repo#1 — Title\nStands: comment ready | Round: 1 | Url: https://github.com/o/r/pull/1\n\n## Timeline\n- 2026-01-02 10:00 — x\n');
  const b = addTask(root, '2026-01-03-badpr', { card: {} });
  fs.mkdirSync(path.join(b, 'pr.md')); // unreadable as a file
  await withServer(root, async (port) => {
    const rows = (await getJson(port, '/api/cards')).body.data;
    const row = rows.find((r) => r.folder === '2026-01-03-pr');
    assert.equal(row.needsYou, true);
    assert.equal(row.state, 'needs you');
    assert.equal(row.pr.stands, 'comment ready');
    assert.equal(rows.find((r) => r.folder === '2026-01-03-badpr').pr, null);
  });
});

test('a card.json or status.json change broadcasts { type: cards }, but not on the first tick', async () => {
  const root = brain();
  const dir = addTask(root, '2026-01-03-work', { card: {} });
  await withServer(root, async (port) => {
    const stream = await get(port, '/api/events');
    let seen = '';
    stream.on('data', (c) => { seen += c; });
    await new Promise((r) => setTimeout(r, 1500));
    assert.doesNotMatch(seen, /"type":"cards"/);
    const f = path.join(dir, 'card.json');
    fs.utimesSync(f, new Date(), new Date(Date.now() + 5000));
    await new Promise((r) => setTimeout(r, 1500));
    assert.match(seen, /data: \{"type":"cards"\}/);
    stream.destroy();
  });
});

test('POST /api/card/pr-stamp: 409 without a pr.md (Done still closes the card), 404 unknown folder, 400 bad stamp', async () => {
  const root = brain();
  addTask(root, '2026-01-03-nopr', { card: {} });
  await withServer(root, async (port) => {
    const missing = await postJson(port, '/api/card/pr-stamp', { task: '2026-01-03-nopr', answer: 'Post', review: 'comment' });
    assert.equal(missing.status, 409);
    assert.equal((await postJson(port, '/api/card/pr-stamp', { task: '2026-01-09-none', answer: 'Done' })).status, 404);
    assert.equal((await postJson(port, '/api/card/pr-stamp', { task: '../etc', answer: 'Done' })).status, 400);
    assert.equal((await postJson(port, '/api/card/pr-stamp', { task: '2026-01-03-nopr', answer: '' })).status, 400);
    assert.equal((await postJson(port, '/api/card/pr-stamp', { task: '2026-01-03-nopr', answer: 'Changes' })).status, 409, 'no pr.md is refused before the stamp is read');
    const done = await postJson(port, '/api/card/pr-stamp', { task: '2026-01-03-nopr', answer: 'Done' });
    assert.equal(done.status, 200, 'a broken card can always be cleared');
    assert.equal(done.body.data.state, 'closed');
    assert.match(fs.readFileSync(path.join(root, 'tasks', '2026-01-03-nopr', 'log.md'), 'utf8'), /card \(PR\): tasks\/2026-01-03-nopr → Done/);
  });
});

test('a card row falls back to the status card name when card.title is empty', async () => {
  const root = brain();
  addTask(root, '2026-01-03-untitled', { card: { title: '' } });
  await withServer(root, async (port) => {
    const row = (await getJson(port, '/api/cards')).body.data.find((r) => r.folder === '2026-01-03-untitled');
    assert.equal(row.title, 'TICKET-123');
  });
});

test('answer, close and reopen on a folder with card.json but no status.json are 404 no such card and write nothing', async () => {
  const root = brain();
  const dir = addTask(root, '2026-01-03-nostatus', { card: { questions: [q('q1')] } });
  fs.rmSync(path.join(dir, 'status.json'));
  const before = fs.readFileSync(path.join(dir, 'card.json'), 'utf8');
  await withServer(root, async (port) => {
    for (const [route, extra] of [['answer', { id: 'q1', answer: 'x' }], ['close', {}], ['reopen', {}]]) {
      const r = await postJson(port, `/api/card/${route}`, { task: '2026-01-03-nostatus', ...extra });
      assert.equal(r.status, 404, route);
      assert.equal(r.body.error, 'no such card', route);
    }
    assert.equal(fs.readFileSync(path.join(dir, 'card.json'), 'utf8'), before);
    assert.equal(fs.existsSync(path.join(dir, 'log.md')), false, 'no log line was written');
  });
});

test('the log line for a card answer holds the answer on one line; the stored answer keeps its breaks', async () => {
  const root = brain();
  const dir = addTask(root, '2026-01-03-ask', { card: { questions: [q('q1')] } });
  await withServer(root, async (port) => {
    assert.equal((await post(port, '/api/card/answer', { task: '2026-01-03-ask', id: 'q1', answer: 'first\n\n  second\r\nthird' })).ok, true);
    assert.match(fs.readFileSync(path.join(dir, 'log.md'), 'utf8'), /^- \d{4}-\d{2}-\d{2} — card: Q q1\? → first second third$/m);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'card.json'), 'utf8')).questions[0].answer, 'first\n\n  second\r\nthird');
  });
});

const assumed = (id, text) => ({ id, kind: 'assumed', q: text, suggested: '', why: '', file: null, asked: '2026-01-02', answer: text, answered: '2026-01-02' });

test('POST /api/card/answer with change: true overwrites an assumed answer and broadcasts the answer event; on any other kind it is 409 and writes nothing', async () => {
  const root = brain();
  const dir = addTask(root, '2026-01-03-assume', { card: { questions: [assumed('q1', 'keep v1'), q('q2', 'Yes', '2026-01-02'), q('q3')] } });
  await withServer(root, async (port) => {
    const stream = await get(port, '/api/events');
    const next = eventQueue(stream);
    try {
    const before = fs.readFileSync(path.join(dir, 'card.json'), 'utf8');
    for (const id of ['q2', 'q3']) {
      const r = await postJson(port, '/api/card/answer', { task: '2026-01-03-assume', id, answer: 'drop v1', change: true });
      assert.equal(r.status, 409, id);
    }
    assert.equal(fs.readFileSync(path.join(dir, 'card.json'), 'utf8'), before);
    const r = await postJson(port, '/api/card/answer', { task: '2026-01-03-assume', id: 'q1', answer: 'drop v1', change: true });
    assert.equal(r.status, 200);
    const changed = r.body.data.decided.find((x) => x.id === 'q1');
    assert.equal(changed.answer, 'drop v1');
    assert.equal(changed.kind, 'assumed');
    assert.match(changed.answered, /^\d{4}-\d{2}-\d{2}$/);
    let ev = await next(2000);
    while (ev.type !== 'answer') ev = await next(2000);
    assert.deepEqual({ ...ev, date: undefined }, { type: 'answer', task: 'tasks/2026-01-03-assume', id: 'q1', kind: 'assumed', q: 'keep v1', answer: 'drop v1', date: undefined });
    assert.equal((await postJson(port, '/api/card/answer', { task: '2026-01-03-assume', id: 'q9', answer: 'x', change: true })).status, 404);
    } finally { stream.destroy(); }
  });
});

test('a PR row carries post and postable for the pane; a ship approval question carries the parsed packet', async () => {
  const root = brain();
  const a = addTask(root, '2026-01-03-pr', { card: {} });
  fs.writeFileSync(path.join(a, 'pr.md'), '# repo#1 — Title\nStands: comment ready | Round: 1 | Url: https://github.com/o/r/pull/1\n\n## Timeline\n- 2026-01-02 10:00 — x\n');
  const b = addTask(root, '2026-01-03-ship', { card: { questions: [{ ...q('q1'), kind: 'ship approval', file: 'packet.md' }, q('q2')] } });
  fs.writeFileSync(path.join(b, 'packet.md'), '# Ship the widget\n\n## LOOK\n- new UI\n\n## Ship\n```\ngit push origin feat/x\n```\n');
  await withServer(root, async (port) => {
    const rows = (await getJson(port, '/api/cards')).body.data;
    const pr = rows.find((r) => r.folder === '2026-01-03-pr');
    assert.equal(pr.post, 'ready');
    assert.equal(pr.postable, true);
    const ship = rows.find((r) => r.folder === '2026-01-03-ship');
    assert.deepEqual(ship.questions[0].packet, { title: 'Ship the widget', look: ['new UI'], ship: 'git push origin feat/x' });
    assert.equal(ship.questions[1].packet, undefined);
  });
});

test('the notifier is handed the card rows on the first poll tick and again when a card.json changes, not on a quiet tick', async () => {
  const root = brain();
  const dir = addTask(root, '2026-01-03-work', { card: {} });
  const notified = [];
  // Injected notifier replaces the real toast so no Windows toast fires from the suite.
  const server = createServer(root, { notify: (rows) => notified.push(rows) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await new Promise((r) => setTimeout(r, 2300));
    assert.equal(notified.length, 1, 'first tick only');
    assert.equal(notified[0].find((r) => r.folder === '2026-01-03-work').state, 'working');
    fs.writeFileSync(path.join(dir, 'card.json'), JSON.stringify({ title: 'T', where: '', next: '', waiting_on: null, later: [], questions: [q('q1')], result: null, lead_session: null, closed: null }));
    fs.utimesSync(path.join(dir, 'card.json'), new Date(), new Date(Date.now() + 5000));
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(notified.length, 2);
    assert.equal(notified[1].find((r) => r.folder === '2026-01-03-work').state, 'needs you');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// --- the lead: a stateful fake herdr. `down` makes every call fail like a stopped herdr server.
function fakeHerdr({ down = false } = {}) {
  const calls = []; const agents = []; let panes = 0;
  const ok = (result) => ({ stdout: JSON.stringify({ result }), status: 0 });
  const h = {
    calls, agents, down,
    run(args) {
      calls.push(args);
      if (h.down) return { stdout: '', stderr: 'herdr server is not running', status: 1 };
      const cmd = args.slice(0, 2).join(' ');
      if (cmd === 'agent list') return ok({ agents });
      if (cmd === 'workspace list') return ok({ workspaces: [{ workspace_id: 'w9', label: 'leads' }] });
      if (cmd === 'tab create') { panes += 1; return ok({ root_pane: { pane_id: `w9:p${panes}` } }); }
      if (cmd === 'agent start') {
        const claude = args.slice(args.indexOf('--') + 1);
        if (h.failResume && claude[0] === '--resume') return { stdout: JSON.stringify({ error: { message: 'No conversation found with session ID' } }), status: 1 };
        agents.push({ pane_id: args[args.indexOf('--pane') + 1], agent_status: 'working', agent_session: { value: claude[1] } });
        return ok({});
      }
      if (cmd === 'agent focus' && h.failFocus) return { stdout: '', stderr: 'pane w9:p1 is gone', status: 1 };
      if (cmd === 'pane close') { const i = agents.findIndex((a) => a.pane_id === args[2]); if (i >= 0) agents.splice(i, 1); }
      return ok({});
    },
  };
  return h;
}
async function withLeadServer(root, herdr, fn) {
  const server = createServer(root, { notify: () => {}, run: herdr.run });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try { await fn(server.address().port); } finally { await new Promise((r) => server.close(r)); }
}
const threadText = (dir) => fs.readFileSync(path.join(dir, 'threads', 'card.md'), 'utf8');
const cardJson = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'card.json'), 'utf8'));

test('POST /api/card/chat with herdr down answers 200 with error set, their line saved and no lead session stored', async () => {
  const root = brain();
  const dir = addTask(root, '2026-01-03-chat', { card: { title: 'Chat card' } });
  const herdr = fakeHerdr({ down: true });
  await withLeadServer(root, herdr, async (port) => {
    const r = await postJson(port, '/api/card/chat', { task: '2026-01-03-chat', text: 'Where does it stand?' });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.match(r.body.data.error, /herdr server is not running/);
    assert.equal(r.body.data.lead, 'none');
    assert.deepEqual(r.body.data.lines.map((l) => [l.who, l.text]), [['Manager', 'Where does it stand?']]);
    assert.match(threadText(dir), /^# Thread · Chat card\n\n- \d{4}-\d{2}-\d{2} \d{2}:\d{2} — Manager: Where does it stand\?\n$/);
    assert.equal(cardJson(dir).lead_session, null);
    assert.equal((await postJson(port, '/api/card/chat', { task: '2026-01-03-chat', text: ' ' })).status, 400);
    assert.equal((await postJson(port, '/api/card/chat', { task: '../etc', text: 'x' })).status, 400);
  });
});

test('the first chat message starts a lead with a new session id and prompts it; the next one reuses the live pane; after the pane goes it resumes', async () => {
  const root = brain();
  const dir = addTask(root, '2026-01-03-chat', { card: { title: 'Chat card' } });
  const herdr = fakeHerdr();
  await withLeadServer(root, herdr, async (port) => {
    const first = await postJson(port, '/api/card/chat', { task: '2026-01-03-chat', text: 'hi' });
    assert.equal(first.body.data.error, undefined);
    assert.equal(first.body.data.lead, 'replying');
    const session = cardJson(dir).lead_session;
    assert.match(session, /^[0-9a-f-]{36}$/);
    const start = herdr.calls.find((a) => a[1] === 'start');
    assert.deepEqual(start.slice(start.indexOf('--') + 1, start.indexOf('--') + 3), ['--session-id', session]);
    assert.ok(herdr.calls.some((a) => a.join(' ') === `tab create --workspace w9 --cwd ${root} --label Chat card --env CARD=tasks/2026-01-03-chat --no-focus`));
    assert.deepEqual(herdr.calls.at(-2).slice(0, 4), ['agent', 'prompt', 'w9:p1', 'hi']);

    herdr.calls.length = 0;
    await postJson(port, '/api/card/chat', { task: '2026-01-03-chat', text: 'again' });
    assert.equal(herdr.calls.some((a) => a[1] === 'start'), false);
    assert.ok(herdr.calls.some((a) => a.slice(0, 4).join(' ') === 'agent prompt w9:p1 again'));

    herdr.agents.length = 0; // the pane was closed
    herdr.calls.length = 0;
    await postJson(port, '/api/card/chat', { task: '2026-01-03-chat', text: 'remember?' });
    const resumed = herdr.calls.find((a) => a[1] === 'start');
    assert.deepEqual(resumed.slice(resumed.indexOf('--') + 1, resumed.indexOf('--') + 3), ['--resume', session]);
    assert.equal(cardJson(dir).lead_session, session);
  });
});

test('POST /api/card/chat/retry re-sends the last manager line that has no lead line after it, and is 409 when there is none', async () => {
  const root = brain();
  const dir = addTask(root, '2026-01-03-chat', { card: { title: 'Chat card' } });
  const herdr = fakeHerdr({ down: true });
  await withLeadServer(root, herdr, async (port) => {
    await postJson(port, '/api/card/chat', { task: '2026-01-03-chat', text: 'lost one' });
    herdr.down = false;
    const r = await postJson(port, '/api/card/chat/retry', { task: '2026-01-03-chat' });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.error, undefined);
    assert.ok(herdr.calls.some((a) => a.slice(0, 4).join(' ') === 'agent prompt w9:p1 lost one'));
    assert.equal(threadText(dir).match(/Manager:/g).length, 1, 'retry does not write the line again');
    fs.appendFileSync(path.join(dir, 'threads', 'card.md'), '- 2026-01-03 10:00 — lead: answered\n');
    assert.equal((await postJson(port, '/api/card/chat/retry', { task: '2026-01-03-chat' })).status, 409);
  });
});

test('GET /api/card/thread gives lines and the lead state; focus focuses its pane; closing the card closes the pane', async () => {
  const root = brain();
  addTask(root, '2026-01-03-chat', { card: { title: 'Chat card' } });
  const herdr = fakeHerdr();
  await withLeadServer(root, herdr, async (port) => {
    const empty = await getJson(port, '/api/card/thread?task=2026-01-03-chat');
    assert.deepEqual(empty.body.data, { lines: [], lead: 'none' });
    assert.equal((await postJson(port, '/api/card/lead/focus', { task: '2026-01-03-chat' })).status, 409);
    await postJson(port, '/api/card/chat', { task: '2026-01-03-chat', text: 'hi' });
    herdr.agents[0].agent_status = 'blocked';
    const t = await getJson(port, '/api/card/thread?task=2026-01-03-chat');
    assert.equal(t.body.data.lead, 'waiting on you');
    assert.equal(t.body.data.lines.length, 1);
    assert.equal((await postJson(port, '/api/card/lead/focus', { task: '2026-01-03-chat' })).status, 200);
    assert.deepEqual(herdr.calls.at(-1), ['agent', 'focus', 'w9:p1']);
    const closed = await postJson(port, '/api/card/close', { task: '2026-01-03-chat' });
    assert.equal(closed.body.data.state, 'closed');
    assert.ok(herdr.calls.some((a) => a.join(' ') === 'pane close w9:p1'));
    assert.equal(herdr.agents.length, 0);
  });
});

test('closing a card whose lead cannot be reached still closes the card', async () => {
  const root = brain();
  addTask(root, '2026-01-03-chat', { card: { title: 'Chat card', lead_session: '9d810f02-3eae-4894-bdc4-cc2fb1c4e239' } });
  await withLeadServer(root, fakeHerdr({ down: true }), async (port) => {
    const closed = await postJson(port, '/api/card/close', { task: '2026-01-03-chat' });
    assert.equal(closed.status, 200);
    assert.equal(closed.body.data.state, 'closed');
  });
});

test('closeIdleLeads closes an idle lead whose last thread line is older than the limit, and leaves a recent or busy one', () => {
  const routes = require('./routes');
  const root = brain();
  const old = addTask(root, '2026-01-03-old', { card: { lead_session: 's-old' } });
  const recent = addTask(root, '2026-01-03-new', { card: { lead_session: 's-new' } });
  const busy = addTask(root, '2026-01-03-busy', { card: { lead_session: 's-busy' } });
  const line = (dir, ts) => { fs.mkdirSync(path.join(dir, 'threads'), { recursive: true }); fs.writeFileSync(path.join(dir, 'threads', 'card.md'), `# Thread · T\n\n- ${ts} — lead: x\n`); };
  line(old, '2026-01-03 09:00'); line(recent, '2026-01-03 09:50'); line(busy, '2026-01-03 09:00');
  const herdr = fakeHerdr();
  herdr.agents.push(
    { pane_id: 'w9:p1', agent_status: 'done', agent_session: { value: 's-old' } },
    { pane_id: 'w9:p2', agent_status: 'done', agent_session: { value: 's-new' } },
    { pane_id: 'w9:p3', agent_status: 'working', agent_session: { value: 's-busy' } },
  );
  routes.closeIdleLeads(root, herdr.run, new Date(2026, 0, 3, 10, 0), 30);
  assert.deepEqual(herdr.calls.filter((a) => a[0] === 'pane'), [['pane', 'close', 'w9:p1']]);
  assert.equal(herdr.calls.filter((a) => a.join(' ') === 'agent list').length, 1, 'one agent list per tick, not per card');
});

test('POST /api/card/decided raises a decided event for a real card and refuses an unknown one or empty text', async () => {
  const root = brain();
  addTask(root, '2026-01-03-dec', { card: {} });
  await withServer(root, async (port) => {
    const stream = http.get({ host: '127.0.0.1', port, path: '/api/events' });
    const seen = new Promise((resolve) => stream.on('response', (res) => { let buf = ''; res.on('data', (c) => { buf += c; for (const m of buf.matchAll(/^data: (.*)$/gm)) { const e = JSON.parse(m[1]); if (e.type === 'decided') resolve(e); } }); }));
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((await postJson(port, '/api/card/decided', { task: 'tasks/2026-01-03-nope', text: 'x' })).status, 404);
    assert.equal((await postJson(port, '/api/card/decided', { task: 'tasks/2026-01-03-dec', text: ' ' })).status, 400);
    assert.equal((await postJson(port, '/api/card/decided', { task: 'tasks/2026-01-03-dec', text: 'Base it on card-to-pr' })).status, 200);
    assert.deepEqual(await seen, { type: 'decided', task: 'tasks/2026-01-03-dec', text: 'Base it on card-to-pr' });
    stream.destroy();
  });
});

test('windDown closes every card lead, a busy one included, and leaves other agents alone', () => {
  const routes = require('./routes');
  const root = brain();
  addTask(root, '2026-01-03-a', { card: { lead_session: 's-a' } });
  addTask(root, '2026-01-03-b', { card: { lead_session: 's-b' } });
  const herdr = fakeHerdr();
  herdr.agents.push(
    { pane_id: 'w9:p1', agent_status: 'done', agent_session: { value: 's-a' } },
    { pane_id: 'w9:p2', agent_status: 'working', agent_session: { value: 's-b' } },
    { pane_id: 'w1:p1', agent_status: 'working', agent_session: { value: 's-dispatcher' } },
  );
  assert.deepEqual(routes.windDown(root, herdr.run), { leads: 2 });
  assert.deepEqual(herdr.calls.filter((a) => a[0] === 'pane'), [['pane', 'close', 'w9:p1'], ['pane', 'close', 'w9:p2']]);
});

test('a ship approval question whose file is not a bare file name gets no packet read from outside the task folder', async () => {
  const root = brain();
  addTask(root, '2026-01-03-ship', { card: { questions: [{ ...q('q1'), kind: 'ship approval', file: '../2026-01-03-other/packet.md' }] } });
  const other = addTask(root, '2026-01-03-other', { card: {} });
  fs.writeFileSync(path.join(other, 'packet.md'), '# Other packet\n\n## Ship\n```\ngit push\n```\n');
  await withServer(root, async (port) => {
    const ship = (await getJson(port, '/api/cards')).body.data.find((r) => r.folder === '2026-01-03-ship');
    assert.equal(ship.questions[0].packet, undefined);
  });
});

test('a ship approval question reads a packet at a path inside the task folder, never one whose path leaves it', async () => {
  const root = brain();
  const bad = ['/etc/passwd', 'a/../packet.md'];
  const dir = addTask(root, '2026-01-03-ship', { card: { questions: [{ ...q('q1'), kind: 'ship approval', file: 'research/packet.md' }, ...bad.map((file, i) => ({ ...q(`q${i + 2}`), kind: 'ship approval', file }))] } });
  fs.mkdirSync(path.join(dir, 'research'));
  fs.writeFileSync(path.join(dir, 'research', 'packet.md'), '# Nested packet\n\n## Ship\n```\ngit push\n```\n');
  fs.writeFileSync(path.join(dir, 'packet.md'), '# Root packet\n\n## Ship\n```\ngit push\n```\n');
  await withServer(root, async (port) => {
    const ship = (await getJson(port, '/api/cards')).body.data.find((r) => r.folder === '2026-01-03-ship');
    assert.equal(ship.questions[0].packet.title, 'Nested packet');
    assert.deepEqual(ship.questions.slice(1).map((x) => x.packet), [undefined, undefined]);
  });
});

test('a chat message is not sent to a lead that waits at a permission prompt; the line is saved for Retry', async () => {
  const root = brain();
  addTask(root, '2026-01-03-chat', { card: { title: 'Chat card' } });
  const herdr = fakeHerdr();
  await withLeadServer(root, herdr, async (port) => {
    await postJson(port, '/api/card/chat', { task: '2026-01-03-chat', text: 'hi' });
    herdr.agents[0].agent_status = 'blocked';
    herdr.calls.length = 0;
    const r = await postJson(port, '/api/card/chat', { task: '2026-01-03-chat', text: 'yes' });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.error, 'lead is waiting on you in its pane — use Go to lead');
    assert.equal(r.body.data.lead, 'waiting on you');
    assert.equal(herdr.calls.some((a) => a[1] === 'prompt'), false, 'a "yes" must never answer the prompt');
    assert.equal(r.body.data.lines.at(-1).text, 'yes');
  });
});

test('newlines in a message become single spaces before the prompt, on the first send and on Retry alike', async () => {
  const root = brain();
  addTask(root, '2026-01-03-chat', { card: { title: 'Chat card' } });
  const herdr = fakeHerdr({ down: true });
  await withLeadServer(root, herdr, async (port) => {
    await postJson(port, '/api/card/chat', { task: '2026-01-03-chat', text: 'line one\n\n  line two' });
    herdr.down = false;
    await postJson(port, '/api/card/chat/retry', { task: '2026-01-03-chat' });
    assert.ok(herdr.calls.some((a) => a.slice(0, 4).join('|') === 'agent|prompt|w9:p1|line one line two'));
    herdr.calls.length = 0;
    await postJson(port, '/api/card/chat', { task: '2026-01-03-chat', text: 'a\r\nb' });
    assert.ok(herdr.calls.some((a) => a.slice(0, 4).join('|') === 'agent|prompt|w9:p1|a b'));
  });
});

test('when --resume fails the lead is started once more with --session-id and the same id', async () => {
  const root = brain();
  const session = '9d810f02-3eae-4894-bdc4-cc2fb1c4e239';
  const dir = addTask(root, '2026-01-03-chat', { card: { title: 'Chat card', lead_session: session } });
  const herdr = fakeHerdr();
  herdr.failResume = true;
  await withLeadServer(root, herdr, async (port) => {
    const r = await postJson(port, '/api/card/chat', { task: '2026-01-03-chat', text: 'hi' });
    assert.equal(r.body.data.error, undefined);
    const starts = herdr.calls.filter((a) => a[1] === 'start').map((a) => a.slice(a.indexOf('--') + 1, a.indexOf('--') + 3));
    assert.deepEqual(starts, [['--resume', session], ['--session-id', session]]);
    assert.equal(cardJson(dir).lead_session, session);
  });
});

test('Go to lead answers 502 with herdr\'s message when the focus call fails', async () => {
  const root = brain();
  addTask(root, '2026-01-03-chat', { card: { title: 'Chat card' } });
  const herdr = fakeHerdr();
  await withLeadServer(root, herdr, async (port) => {
    await postJson(port, '/api/card/chat', { task: '2026-01-03-chat', text: 'hi' });
    herdr.failFocus = true;
    const r = await postJson(port, '/api/card/lead/focus', { task: '2026-01-03-chat' });
    assert.equal(r.status, 502);
    assert.match(r.body.error, /pane w9:p1 is gone/);
  });
});

test('the inbox routes are gone: /api/inbox, /api/thread, /api/answer and /api/ask answer 404', async () => {
  const root = brain();
  await withServer(root, async (port) => {
    assert.equal((await getJson(port, '/api/inbox')).status, 404);
    assert.equal((await getJson(port, '/api/thread?id=deadbeef')).status, 404);
    assert.equal((await postJson(port, '/api/answer', { id: 'deadbeef', answer: 'Approve' })).status, 404);
    assert.equal((await postJson(port, '/api/ask', { id: 'deadbeef', text: 'hi' })).status, 404);
  });
});

test('GET /api/pipeline gives a row\'s awaiting as the kind of its first open question, null without one, whatever status.json says', async () => {
  const root = brain();
  const kinded = (id, kind) => ({ ...q(id), kind });
  addTask(root, '2026-01-03-asks', { card: { questions: [kinded('q1', 'plan approval'), kinded('q2', 'question')] } });
  fs.writeFileSync(path.join(root, 'tasks', '2026-01-03-asks', 'status.json'), JSON.stringify({ card: 'TICKET-123', folder: 'tasks/2026-01-03-asks', lane: 'standard', stage: 'plan', awaiting: 'stale' }));
  addTask(root, '2026-01-04-quiet', { card: {} });
  addTask(root, '2026-01-05-nocard');
  await withServer(root, async (port) => {
    const { status, body } = await getJson(port, '/api/pipeline');
    assert.equal(status, 200);
    assert.equal(body.data.rows.length, 3);
    const asks = body.data.rows.find((r) => r.card === 'TICKET-123' && r.awaiting === 'plan approval');
    assert.ok(asks, JSON.stringify(body.data.rows));
    assert.equal(asks.stages.find((s) => s.state === 'awaiting').label, 'plan approval');
    assert.equal(body.data.rows.filter((r) => r.awaiting === null).length, 2);
  });
});

test('task routes accept the folder bare or as tasks/<folder>', async () => {
  const root = brain();
  addTask(root, '2026-01-03-work', { card: {} });
  await withServer(root, async (port) => {
    assert.equal((await postJson(port, '/api/park', { task: 'tasks/2026-01-03-work' })).status, 200);
    assert.equal((await postJson(port, '/api/unpark', { task: '2026-01-03-work' })).status, 200);
    const closed = await post(port, '/api/card/close', { task: 'tasks/2026-01-03-work' });
    assert.equal(closed.data.state, 'closed');
    assert.equal((await getJson(port, '/api/task/tasks%2F2026-01-03-work')).status, 400, 'a path segment still takes the bare folder only');
    assert.equal((await postJson(port, '/api/park', { task: 'tasks/../x' })).status, 400);
  });
});

test('reopen on a dropped card clears dropped and keeps the stage, so the card leaves Closed', async () => {
  const root = brain();
  const dir = addTask(root, '2026-01-03-work', { card: {} });
  await withServer(root, async (port) => {
    assert.equal((await postJson(port, '/api/drop', { task: '2026-01-03-work' })).status, 200);
    const before = (await getJson(port, '/api/cards')).body.data.find((r) => r.folder === '2026-01-03-work');
    assert.equal(before.state, 'closed');
    const reopened = await post(port, '/api/card/reopen', { task: '2026-01-03-work' });
    assert.equal(reopened.data.state, 'done');
    const status = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));
    assert.equal(status.dropped, null);
    assert.equal(status.stage, 'done');
  });
});

// A raw request with exact headers: { status, body } (body parsed as JSON when it is).
function raw(port, { method = 'GET', p, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => {
      let text = ''; res.on('data', (c) => (text += c)); res.on('end', () => {
        let parsed = text; try { parsed = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject); req.end(body);
  });
}

test('a request whose Host is not 127.0.0.1:<port> or localhost:<port> is 403', async () => {
  const root = brain();
  await withServer(root, async (port) => {
    for (const host of ['evil.test', `evil.test:${port}`, '127.0.0.1:1', `127.0.0.1.evil.test:${port}`]) {
      const r = await raw(port, { p: '/api/cards', headers: { host } });
      assert.equal(r.status, 403, host);
      assert.equal(r.body.ok, false);
    }
    assert.equal((await raw(port, { p: '/api/cards', headers: { host: `127.0.0.1:${port}` } })).status, 200);
    assert.equal((await raw(port, { p: '/api/cards', headers: { host: `localhost:${port}` } })).status, 200);
  });
});

test('a POST with an Origin from another site is 403 and writes nothing; same-origin and no-Origin POSTs go through', async () => {
  const root = brain();
  const dir = addTask(root, '2026-01-03-ask', { card: { questions: [q('q1'), q('q2'), q('q3')] } });
  const before = fs.readFileSync(path.join(dir, 'card.json'), 'utf8');
  await withServer(root, async (port) => {
    const answer = (id, origin) => raw(port, {
      method: 'POST', p: '/api/card/answer', body: JSON.stringify({ task: '2026-01-03-ask', id, answer: 'Yes' }),
      headers: { host: `127.0.0.1:${port}`, 'content-type': 'text/plain', ...(origin ? { origin } : {}) },
    });
    for (const origin of ['https://evil.test', `http://evil.test:${port}`, 'null', `http://127.0.0.1:${port + 1}`]) {
      assert.equal((await answer('q1', origin)).status, 403, origin);
    }
    assert.equal(fs.readFileSync(path.join(dir, 'card.json'), 'utf8'), before);
    assert.equal((await answer('q1', `http://127.0.0.1:${port}`)).status, 200);
    assert.equal((await answer('q2', `http://localhost:${port}`)).status, 200);
    assert.equal((await answer('q3')).status, 200, 'no Origin (curl, the dispatcher) is allowed');
  });
});

test('/api/events still streams to curl through the Host check', async () => {
  const root = brain();
  await withServer(root, async (port) => {
    const stream = await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path: '/api/events', headers: { 'user-agent': 'curl/8.5.0' } }, resolve).on('error', reject));
    assert.equal(stream.statusCode, 200);
    assert.equal(stream.headers['content-type'], 'text/event-stream');
    const first = await new Promise((r) => stream.once('data', (c) => r(String(c))));
    assert.match(first, /^: listening/);
    stream.destroy();
  });
});

test('every row carries a type from its lane: PR review, Research, else Feature', async () => {
  const root = brain();
  for (const [name, lane] of [['2026-01-03-a', 'review'], ['2026-01-03-b', 'research'], ['2026-01-03-c', 'quick'], ['2026-01-03-d', undefined]]) {
    const dir = addTask(root, name, { card: {} });
    const file = path.join(dir, 'status.json');
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), lane }));
  }
  await withServer(root, async (port) => {
    const rows = (await getJson(port, '/api/cards')).body.data;
    const type = (f) => rows.find((r) => r.folder === f).type;
    assert.deepEqual(['a', 'b', 'c', 'd'].map((x) => type(`2026-01-03-${x}`)), ['PR review', 'Research', 'Feature', 'Feature']);
  });
});

test('POST /api/card/new makes the task folder (status, card, log), answers with its row and broadcasts { type: new }', async () => {
  const root = brain();
  await withServer(root, async (port) => {
    const stream = await get(port, '/api/events');
    const seen = new Promise((resolve) => {
      let buf = '';
      stream.on('data', (c) => { buf += c; for (const m of buf.matchAll(/^data: (.*)$/gm)) { const e = JSON.parse(m[1]); if (e.type === 'new') resolve(e); } });
    });
    const r = await postJson(port, '/api/card/new', { type: 'research', title: 'Why is the Send button slow?', details: 'Seen on\nthe iPad.' });
    assert.equal(r.status, 200);
    const row = r.body.data;
    assert.match(row.folder, /^\d{4}-\d{2}-\d{2}-why-is-the-send-button-slow$/);
    assert.deepEqual([row.type, row.state, row.title, row.stage], ['Research', 'working', 'Why is the Send button slow?', 'brief']);
    const dir = path.join(root, 'tasks', row.folder);
    const status = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));
    assert.deepEqual([status.lane, status.stage, status.folder, status.card], ['research', 'brief', `tasks/${row.folder}`, 'Why is the Send button slow?']);
    assert.match(fs.readFileSync(path.join(dir, 'log.md'), 'utf8'), /— Manager raised this card \(Research\): Why is the Send button slow\? · Seen on the iPad\.\n$/);
    const ev = await seen;
    stream.destroy();
    assert.deepEqual([ev.task, ev.lane, ev.title, ev.details], [`tasks/${row.folder}`, 'research', 'Why is the Send button slow?', 'Seen on\nthe iPad.']);
    // the same title again gets its own folder
    const again = await postJson(port, '/api/card/new', { type: 'research', title: 'Why is the Send button slow?' });
    assert.equal(again.body.data.folder, `${row.folder}-2`);
  });
});

test('POST /api/card/new refuses an unknown type, an empty or over-long title and a title with no letters or digits', async () => {
  const root = brain();
  await withServer(root, async (port) => {
    for (const body of [{ type: 'bug', title: 'x' }, { type: 'feature', title: '  ' }, { type: 'feature', title: 'x'.repeat(81) }, { type: 'feature', title: '???' }, { type: 'feature', title: 'ok', details: 'x'.repeat(2001) }, null]) {
      assert.equal((await postJson(port, '/api/card/new', body)).status, 400, JSON.stringify(body));
    }
    assert.deepEqual(fs.readdirSync(path.join(root, 'tasks')), ['2026-01-02-demo']);
  });
});

test('GET /api/cards gives each row its agent (lead state from one herdr agent list, helpers from open dispatches)', async () => {
  const root = brain();
  addTask(root, '2026-01-03-live', { card: { lead_session: 's-live' } });
  addTask(root, '2026-01-03-stuck', { card: { lead_session: 's-stuck' } });
  addTask(root, '2026-01-03-asleep', { card: { lead_session: 's-gone' } });
  addTask(root, '2026-01-03-none', { card: {} });
  addTask(root, '2026-01-03-finished', { stage: 'done', card: {} });
  fs.mkdirSync(path.join(root, 'ui'));
  fs.writeFileSync(path.join(root, 'ui', 'dispatch.jsonl'), [{ id: 'a', ts: new Date().toISOString(), agent: 'implementer', task: 'tasks/2026-01-03-none' }, { id: 'b', ts: new Date().toISOString(), agent: 'qa', task: 'tasks/2026-01-03-live' }, { id: 'b', done: true },
    { id: 'c', ts: '2026-01-01T00:00:00Z', agent: 'qa', task: 'tasks/2026-01-03-live' }, { id: 'd', ts: new Date().toISOString(), agent: 'qa', task: 'tasks/2026-01-03-finished' }].map((x) => JSON.stringify(x)).join('\n'));
  const herdr = fakeHerdr();
  herdr.agents.push({ pane_id: 'w9:p1', agent_status: 'working', agent_session: { value: 's-live' } }, { pane_id: 'w9:p2', agent_status: 'blocked', agent_session: { value: 's-stuck' } });
  await withLeadServer(root, herdr, async (port) => {
    const rows = (await getJson(port, '/api/cards')).body.data;
    const agent = (f) => rows.find((r) => r.folder === `2026-01-03-${f}`).agent;
    assert.deepEqual(agent('live'), { lead: 'replying', helpers: 0 });
    assert.deepEqual(agent('stuck'), { lead: 'waiting on you', helpers: 0 });
    assert.deepEqual(agent('asleep'), { lead: 'asleep', helpers: 0 });
    assert.deepEqual(agent('none'), { lead: 'none', helpers: 1 });
    assert.deepEqual(agent('finished'), { lead: 'none', helpers: 0 }); // a start row left open on finished work is not a helper
    assert.equal(herdr.calls.filter((a) => a.join(' ') === 'agent list').length, 1);
    herdr.down = true; // herdr unreachable: the list still answers
    const down = (await getJson(port, '/api/cards')).body.data.find((r) => r.folder === '2026-01-03-live').agent;
    assert.deepEqual(down, { lead: 'asleep', helpers: 0 });
  });
});

test('each row names its gate: the open approval it waits at, else the next one for its lane and stage', async () => {
  const root = brain();
  const set = (name, patch, card = {}) => {
    const dir = addTask(root, name, { card });
    const file = path.join(dir, 'status.json');
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), ...patch }));
    return dir;
  };
  set('2026-01-03-a', { lane: 'standard', stage: 'plan' });
  set('2026-01-03-b', { lane: 'standard', stage: 'tdd' });
  set('2026-01-03-c', { lane: 'quick', stage: 'brief' });
  set('2026-01-03-d', { lane: 'standard', stage: 'scribe' });
  set('2026-01-03-e', { lane: 'standard', stage: 'packet' }, { questions: [q('q1'), { ...q('q2'), kind: 'ship approval' }] });
  set('2026-01-03-f', { lane: 'standard', stage: 'blocked', blocked_reason: 'x' });
  set('2026-01-03-g', { lane: 'research', stage: 'research' });
  set('2026-01-03-h', { lane: 'standard', stage: 'done' });
  const pr = set('2026-01-03-i', { lane: 'review', stage: 'review' });
  fs.writeFileSync(path.join(pr, 'pr.md'), '# repo#1 — Title\nStands: comment ready | Round: 1 | Url: https://github.com/o/r/pull/1\n\n## Timeline\n- 2026-01-02 10:00 — x\n');
  await withServer(root, async (port) => {
    const rows = (await getJson(port, '/api/cards')).body.data;
    const gate = (x) => rows.find((r) => r.folder === `2026-01-03-${x}`).gate;
    assert.deepEqual(gate('a'), { name: 'plan approval', at: false });
    assert.deepEqual(gate('b'), { name: 'ship approval', at: false });
    assert.deepEqual(gate('c'), { name: 'ship approval', at: false });
    assert.deepEqual(gate('d'), { name: 'ticket approval', at: false });
    assert.deepEqual(gate('e'), { name: 'ship approval', at: true });
    assert.deepEqual(gate('f'), { name: 'blocked', at: true });
    assert.equal(gate('g'), null);
    assert.equal(gate('h'), null);
    assert.deepEqual(gate('i'), { name: 'comment ready', at: true });
  });
});
