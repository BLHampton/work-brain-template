// Pure helpers for tasks/<folder>/card.json: where a task stands, what it needs from the manager, its questions.
const fs = require('node:fs');
const path = require('node:path');
const { safeTaskFolder } = require('./inbox-lib');
const { parsePr, needsYou } = require('./pr-parse');

const CAPS = { where: 120, next: 120, q: 140, suggested: 100, why: 400, later: 80 };
const KINDS = ['question', 'plan approval', 'ship approval', 'ticket approval', 'next step', 'assumed'];
const SHOWN = 3;

// [{ folder: 'tasks/<name>', ...status }] for every parsable status.json; unparsable ones are reported, not thrown.
function readStatuses(root, warn = () => {}) {
  const dir = path.join(root, 'tasks');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().flatMap((name) => {
    const file = path.join(dir, name, 'status.json');
    if (!fs.existsSync(file)) return [];
    try {
      return [{ folder: `tasks/${name}`, ...JSON.parse(fs.readFileSync(file, 'utf8')) }];
    } catch (e) {
      warn(`${file}: ${e.message}`);
      return [];
    }
  });
}

function cardFile(root, folder) {
  const safe = safeTaskFolder(folder);
  if (!safe) throw new Error('bad task folder');
  return path.join(root, 'tasks', safe, 'card.json');
}

function readCard(root, folder) {
  const file = cardFile(root, folder);
  if (!fs.existsSync(file)) return { unreadable: 'no card.json' };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { unreadable: 'not a card object' };
  } catch (e) {
    return { unreadable: e.message };
  }
}

function writeCard(root, folder, card) {
  const file = cardFile(root, folder);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(card, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return card;
}

// True when `name` is a relative path inside a task folder: `/`-separated segments of [\w.-], none `.` or `..`.
function safeRelFile(name) {
  if (typeof name !== 'string' || name === '' || name.startsWith('/')) return false;
  return name.split('/').every((s) => /^[\w.-]+$/.test(s) && s !== '.' && s !== '..');
}

function validate(card) {
  const problems = [];
  const cap = (field, value, max) => {
    if (typeof value === 'string' && value.length > max) problems.push(`${field} is ${value.length} chars, cap ${max}`);
  };
  cap('where', card.where, CAPS.where);
  cap('next', card.next, CAPS.next);
  (card.later ?? []).forEach((l) => cap('later', l, CAPS.later));
  (card.questions ?? []).forEach((x) => {
    if (!KINDS.includes(x.kind)) problems.push(`kind '${x.kind}' is not one of ${KINDS.join(', ')}`);
    cap('q', x.q, CAPS.q);
    cap('suggested', x.suggested, CAPS.suggested);
    cap('why', x.why, CAPS.why);
    if (x.file != null && !safeRelFile(x.file)) problems.push(`file '${x.file}' is not a path inside the task folder`);
  });
  if (card.result != null && !safeRelFile(card.result)) problems.push(`result '${card.result}' is not a path inside the task folder`);
  return problems;
}

const LOCK_WAIT_MS = 3000;
const LOCK_STALE_MS = 10000;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Runs fn while holding card.json.lock (created with 'wx', so one holder at a time across processes). A lock older than
// LOCK_STALE_MS is a crashed writer's and is taken over; waiting past LOCK_WAIT_MS throws.
function withLock(file, fn) {
  const lock = `${file}.lock`;
  const until = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.closeSync(fs.openSync(lock, 'wx'));
      break;
    } catch (e) {
      if (e.code === 'ENOENT') return fn(); // no task folder: fn's readCard reports the missing card
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.rmSync(lock, { force: true }); } catch { /* gone meanwhile */ }
      if (Date.now() > until) throw new Error('card.json is locked by another writer');
      sleep(10);
    }
  }
  try { return fn(); } finally { fs.rmSync(lock, { force: true }); }
}

// Read, apply fn, validate, write, under the card's lock: two writers at once (the server, bin/card) both land.
function change(root, folder, fn) {
  return withLock(cardFile(root, folder), () => {
    const current = readCard(root, folder);
    if (current.unreadable) throw new Error(`unreadable card: ${current.unreadable}`);
    const next = fn(current);
    const problems = validate(next);
    if (problems.length) throw new Error(problems.join('; '));
    return writeCard(root, folder, next);
  });
}

const newCard = ({ title }) => ({
  title, where: '', next: '', waiting_on: null, later: [], questions: [], result: null, lead_session: null, closed: null,
});

function ask(card, { q, suggested, why, kind = 'question', file = null }, today) {
  const n = Math.max(0, ...card.questions.map((x) => Number(x.id.slice(1)))) + 1;
  const question = { id: `q${n}`, kind, q, suggested, why, file, asked: today, answer: null, answered: null };
  return { ...card, questions: [...card.questions, question] };
}

function assume(card, text, today) {
  const n = Math.max(0, ...card.questions.map((x) => Number(x.id.slice(1)))) + 1;
  const question = { id: `q${n}`, kind: 'assumed', q: text, suggested: '', why: '', file: null, asked: today, answer: text, answered: today };
  return { ...card, questions: [...card.questions, question] };
}

function answer(card, id, text, today) {
  const target = card.questions.find((x) => x.id === id);
  if (!target) throw new Error('unknown question');
  if (target.answer !== null) throw new Error('already answered');
  return { ...card, questions: card.questions.map((x) => (x === target ? { ...x, answer: text, answered: today } : x)) };
}

const withdraw = (card, id, today) => answer(card, id, 'withdrawn', today);

const openQuestions = (card) => (card.questions ?? []).filter((x) => x.answer === null);

function stateOf(status, card) {
  if (card.closed || status.dropped) return 'closed';
  if (status.parked) return 'parked';
  if (openQuestions(card).length) return 'needs you';
  if (status.stage === 'done') return 'done';
  if (card.waiting_on) return 'waiting on someone else';
  return 'working';
}

// The task's pr.md: {} without one, { pr: null } when it cannot be read, else { pr, needsYou }.
function prOf(root, folder) {
  const file = path.join(root, folder, 'pr.md');
  if (!fs.existsSync(file)) return {};
  try {
    const pr = parsePr(fs.readFileSync(file, 'utf8'));
    return { pr, needsYou: needsYou(pr) };
  } catch {
    return { pr: null };
  }
}

// One row per status.json. A PR that needs the manager makes the row `needs you` unless it is parked or closed.
function listCards(root, warn) {
  return readStatuses(root, warn).map((status) => {
    const name = status.folder.replace(/^tasks\//, '');
    const card = safeTaskFolder(name) ? readCard(root, name) : { unreadable: 'bad task folder' };
    const readable = !card.unreadable;
    const pr = prOf(root, status.folder);
    // A done task with no card.json file predates cards: closed, so nobody has to close it, even with a pr.md.
    const predates = card.unreadable === 'no card.json' && status.stage === 'done';
    const state = predates ? 'closed' : stateOf(status, readable ? card : {});
    const own = pr.needsYou && !['closed', 'parked'].includes(state) ? 'needs you' : state;
    return { folder: status.folder, status, card, state: own, open: readable ? openQuestions(card).length : 0, ...pr, needsYou: Boolean(pr.needsYou) };
  });
}

module.exports = {
  CAPS, KINDS, SHOWN, safeRelFile, readStatuses, readCard, writeCard, change, validate, newCard, ask, assume, answer, withdraw, openQuestions, stateOf, listCards,
};
