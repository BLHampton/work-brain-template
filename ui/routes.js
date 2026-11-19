// Route handlers for ui/server.js. Each returns { status, body } (JSON envelope payload) or throws HttpError.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const lib = require('./inbox-lib');
const { rosterFor, readDispatches } = require('./roster-lib');
const { pipelineRow, openAgentCount } = require('./pipeline-lib');
const { safeBrainPath, brainTree, taskFile: readTaskFile, taskFiles } = require('./files-lib');
const { parseTaskLog, folderForDate } = require('./board-lib');
const { threadFile, appendLine, parseThread } = require('./thread-lib');
const leadLib = require('./lead-lib');
const indexLib = require('./index-lib');
const cardLib = require('./card-lib');
const cardsLib = require('./cards-lib');
const { applyPrStamp, parsePr, postState } = require('./pr-card-lib');
const { parsePrUrl } = require('./pr-watch-lib');
const { pairDispatches, statsByCard } = require('./stats-lib');

const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const PATCH_CAP = 400 * 1024;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// A task folder given bare (2026-01-02-sample) or as tasks/2026-01-02-sample -> the bare name; 400 otherwise.
function folderOr400(name) {
  const folder = lib.safeTaskFolder(typeof name === 'string' ? name.replace(/^tasks\//, '') : name);
  if (!folder) throw new HttpError(400, 'bad task folder');
  return folder;
}

function shotFile(root, folder, which) {
  const dir = path.join(root, 'tasks', folder, 'shots');
  if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir).find((n) => path.basename(n, path.extname(n)) === which && IMAGE_TYPES[path.extname(n).toLowerCase()]);
  return f ? path.join(dir, f) : null;
}

function task(root, name) {
  const folder = folderOr400(name);
  const dir = path.join(root, 'tasks', folder);
  if (!fs.existsSync(dir)) throw new HttpError(404, 'no such task');
  const { md, other } = taskFiles(dir);
  const files = Object.fromEntries(md.map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
  const mmd = path.join(dir, 'diagram.mmd');
  const shot = (w) => (shotFile(root, folder, w) ? `/api/task/${folder}/shot/${w}` : null);
  return {
    files,
    others: other,
    diagram: fs.existsSync(mmd) ? fs.readFileSync(mmd, 'utf8') : null,
    shots: { before: shot('before'), after: shot('after') },
    repo: lib.repoForTask(root, folder),
  };
}

function shot(root, name, which) {
  const folder = folderOr400(name);
  if (!['before', 'after'].includes(which)) throw new HttpError(400, 'shot must be before|after');
  const file = shotFile(root, folder, which);
  if (!file) throw new HttpError(404, 'no such shot');
  return { file, type: IMAGE_TYPES[path.extname(file).toLowerCase()] };
}

const git = (repoPath, args) => execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

function diff(root, name) {
  const repo = lib.readRepos(root).find((r) => r.name === name);
  if (!repo) throw new HttpError(404, 'unknown repo');
  const status = git(repo.path, ['status', '--porcelain', '--branch']).split('\n')[0];
  const branch = git(repo.path, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  let stat = git(repo.path, ['diff', '--stat']);
  let patch = git(repo.path, ['diff']);
  if (branch !== repo.defaultBranch) {
    const range = `${repo.defaultBranch}...HEAD`;
    const heading = `\n### committed on ${branch} vs ${repo.defaultBranch}\n`;
    stat += heading + git(repo.path, ['diff', '--stat', range]);
    patch += heading + git(repo.path, ['diff', range]);
  }
  if (patch.length > PATCH_CAP) patch = `${patch.slice(0, PATCH_CAP)}\n...truncated`;
  return { status, stat: stat.trim(), patch: patch.trim() };
}

const files = (root) => brainTree(root);

const index = (root) => ({ text: indexLib.index(root) });

// Pipeline view: one row per task that is not done (dropped cards are done) or parked, plus the parked cards.
// A row's `awaiting` is the kind of the card's first open question, or null.
function pipeline(root) {
  const live = cardsLib.listCards(root).filter((c) => c.status.stage !== 'done');
  const dispatches = readDispatches(root);
  const awaiting = ({ card }) => (card.unreadable ? null : cardsLib.openQuestions(card)[0]?.kind ?? null);
  return {
    rows: live.filter((c) => !c.status.parked).map((c) => pipelineRow({ ...c.status, awaiting: awaiting(c) }, dispatches)),
    parked: live.filter((c) => c.status.parked).map(({ status: { card, folder, lane, stage } }) => ({ card, folder, lane, stage })),
  };
}

// Agent stats: one row per card that has dispatches, slowest (agent + dispatcher seconds) first.
function stats(root) {
  const total = (c) => c.agentSeconds + c.dispatcherSeconds;
  const cards = statsByCard(pairDispatches(readDispatches(root)), indexLib.readStatuses(root))
    .sort((a, b) => total(b) - total(a));
  return { cards, generatedAt: new Date().toISOString() };
}

// Open questions on a task's card; 0 when it has no readable card.json.
function openCount(root, name) {
  const card = cardsLib.readCard(root, name);
  return card.unreadable ? 0 : cardsLib.openQuestions(card).length;
}

function board(root) {
  const log = path.join(root, 'task-log.md');
  if (!fs.existsSync(log)) return [];
  return parseTaskLog(fs.readFileSync(log, 'utf8')).map((row) => {
    const folder = folderForDate(root, row.date);
    return { ...row, folder, openItems: folder ? openCount(root, folder.replace(/^tasks\//, '')) : 0 };
  });
}

// A task-folder file served raw (research/mockups.html, shots): { type, body }. 400 on a malformed folder/path, 404 when missing.
function taskFile(root, folder, relPath) {
  const r = readTaskFile(root, folder, relPath);
  if (r.status === 400) throw new HttpError(400, 'folder must be a task folder and path a relative .html/.md/.svg/.png under it');
  if (r.status === 404) throw new HttpError(404, 'no such file');
  return { type: r.type, body: r.body };
}

function file(root, requested) {
  const abs = typeof requested === 'string' ? safeBrainPath(root, requested) : null;
  if (!abs) throw new HttpError(400, 'path must be under tasks/, retros/ or be suggestion-box.md, misses.md or answers.md');
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new HttpError(404, 'no such file');
  return { path: requested, text: fs.readFileSync(abs, 'utf8') };
}

// Park / unpark / drop a task by folder name; each returns tasks/<folder> and the status.json it wrote.
function moveTask(root, body, write) {
  const folder = folderOr400((body || {}).task);
  return { task: `tasks/${folder}`, status: write(folder) };
}
const park = (root, body) => moveTask(root, body, (f) => lib.parkItems(root, f));
const unpark = (root, body) => moveTask(root, body, (f) => lib.restoreItems(root, f));
const drop = (root, body, today) => moveTask(root, body, (f) => lib.dropItems(root, f, today));

// --- cards: tasks/<folder>/card.json + status.json, one row per task ---
const STATE_ORDER = ['needs you', 'working', 'waiting on someone else', 'done', 'parked', 'closed'];
// The label on a card, from its lane: every lane that changes code is a Feature.
const TYPES = { review: 'PR review', research: 'Research' };
const HELPER_FRESH_MS = 2 * 60 * 60 * 1000;
const typeOf = (lane) => TYPES[lane] ?? 'Feature';
// What the manager picks when they raise a card in the UI -> the lane it starts in (the dispatcher may re-lane a feature to quick).
const NEW_LANES = { feature: 'standard', review: 'review', research: 'research' };

// The PR fields of a row (pr / needsYou come from listCards). post / postable: where a pending post is, and whether
// the url is a GitHub PR the dispatcher can post to (else pasted by hand).
function prOf({ pr, needsYou }) {
  if (pr === undefined) return {};
  if (pr === null) return { pr: null };
  return { pr, needsYou, post: postState(pr), postable: Boolean(parsePrUrl(pr.url)) };
}

// A ship approval question gains `packet` (title, LOOK flags, Ship block of its packet.md) so the card shows what Approve runs.
function withPacket(root, name, x) {
  if (x.kind !== 'ship approval') return x;
  const base = x.file || 'packet.md';
  if (!cardsLib.safeRelFile(base)) return x; // never join a path from card.json that leaves the task folder
  const file = path.join(root, 'tasks', name, base);
  return fs.existsSync(file) ? { ...x, packet: cardLib.parsePacket(fs.readFileSync(file, 'utf8')) } : x;
}

// The gate a card is at or heading for: { name, at } (at = it waits there now), null when no gate is ahead.
// An open approval question wins; a PR's gate is where the PR stands; else the next approval for the lane and stage.
function gateOf(status, card, pr) {
  if (status.stage === 'blocked') return { name: 'blocked', at: true };
  const open = card.unreadable ? [] : cardsLib.openQuestions(card).find((x) => x.kind.endsWith('approval'));
  if (open && open.kind) return { name: open.kind, at: true };
  if (pr.pr) return { name: pr.pr.stands, at: Boolean(pr.needsYou) };
  if (!['quick', 'standard'].includes(status.lane) || status.stage === 'done') return null;
  if (status.stage === 'scribe') return { name: 'ticket approval', at: false };
  return { name: status.lane === 'standard' && ['brief', 'plan'].includes(status.stage) ? 'plan approval' : 'ship approval', at: false };
}

// Who is on the card: its lead (asleep = it has a session but no pane; the next chat message resumes it) and its open helpers.
function agentOf(status, card, live) {
  const hit = card.lead_session ? live.leads.find((a) => a.session === card.lead_session) : null;
  const lead = !card.lead_session ? 'none' : !hit ? 'asleep' : ({ working: 'replying', blocked: 'waiting on you' }[hit.agent_status] ?? 'idle');
  // A helper stopped without `bin/dispatch done` leaves its start row open for good: count only fresh rows on unfinished work.
  const fresh = live.dispatches.filter((d) => d.done || Date.parse(d.ts) > live.now - HELPER_FRESH_MS);
  return { lead, helpers: status.stage === 'done' ? 0 : openAgentCount(fresh, status.folder) };
}

function cardRow(root, c, live) {
  const { status, card, state } = c;
  const name = status.folder.replace(/^tasks\//, '');
  const pr = prOf(c);
  const base = { folder: name, title: status.card, lane: status.lane, type: typeOf(status.lane), stage: status.stage, updated: status.updated, gate: gateOf(status, card, pr), ...(live && { agent: agentOf(status, card, live) }) };
  if (card.unreadable) return { ...base, state, unreadable: card.unreadable, where: '', next: '', later: [], result: null, waiting_on: null, questions: [], queued: 0, decided: [], ...pr };
  const open = cardsLib.openQuestions(card);
  const decided = card.questions.filter((x) => x.answer !== null).reverse().sort((a, b) => (a.answered < b.answered ? 1 : a.answered > b.answered ? -1 : 0));
  return {
    ...base, title: card.title || status.card, state, where: card.where, next: card.next, later: card.later, result: card.result, waiting_on: card.waiting_on,
    questions: open.slice(0, cardsLib.SHOWN).map((x) => withPacket(root, name, x)), queued: Math.max(0, open.length - cardsLib.SHOWN), decided, ...pr,
  };
}

// With `run` (the card list itself), each row gains `agent`; a row answered from a POST leaves it out and the UI keeps the one it has.
// shortcut: one blocking `herdr agent list` per list request, cache it for a few seconds if the list feels slow
function cards(root, run) {
  let live;
  if (run) {
    let leads = [];
    try { leads = leadLib.listLeads(run); } catch { leads = []; }
    live = { leads, dispatches: readDispatches(root), now: Date.now() };
  }
  const rows = cardsLib.listCards(root).map((c) => cardRow(root, c, live));
  const rank = (r) => STATE_ORDER.indexOf(r.state);
  return rows.sort((a, b) => rank(a) - rank(b) || (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));
}

// The row for one task; 404 when the folder or a readable card.json is missing.
function oneCard(root, name) {
  const folder = folderOr400(name);
  if (!fs.existsSync(path.join(root, 'tasks', folder))) throw new HttpError(404, 'no such task');
  if (cardsLib.readCard(root, folder).unreadable) throw new HttpError(404, 'no readable card.json');
  if (!fs.existsSync(path.join(root, 'tasks', folder, 'status.json'))) throw new HttpError(404, 'no such card');
  return folder;
}

const rowFor = (root, folder) => cards(root).find((r) => r.folder === folder);

// the manager raises a card from the UI: a new task folder at stage brief with its status, card and first log line.
// The dispatcher hears the `new` event (or finds the card under Working at session start) and writes the brief.
function cardNew(root, body, today) {
  const { type, title: rawTitle, details: rawDetails = '' } = body || {};
  const lane = Object.hasOwn(NEW_LANES, type) ? NEW_LANES[type] : null;
  if (!lane) throw new HttpError(400, `type must be one of ${Object.keys(NEW_LANES).join(', ')}`);
  if (typeof rawTitle !== 'string' || typeof rawDetails !== 'string') throw new HttpError(400, 'title and details must be strings');
  const title = rawTitle.trim().replace(/\s+/g, ' ');
  const details = rawDetails.trim();
  if (!title || title.length > 80) throw new HttpError(400, 'title must be 1 to 80 chars');
  if (details.length > 2000) throw new HttpError(400, 'details must be at most 2000 chars');
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  if (!slug) throw new HttpError(400, 'title needs a letter or a digit');
  let folder = `${today}-${slug}`;
  for (let n = 2; fs.existsSync(path.join(root, 'tasks', folder)); n += 1) folder = `${today}-${slug}-${n}`;
  fs.mkdirSync(path.join(root, 'tasks', folder), { recursive: true });
  lib.writeStatus(root, folder, { card: title, folder: `tasks/${folder}`, lane, stage: 'brief', repo: null, attempts: 0, review_round: 0, look_flags: [], blocked_reason: null });
  cardsLib.writeCard(root, folder, { ...cardsLib.newCard({ title }), where: 'Raised by you. Not started yet.' });
  lib.appendLog(root, folder, `- ${today} — Manager raised this card (${typeOf(lane)}): ${[title, details.replace(/\s+/g, ' ')].filter(Boolean).join(' · ')}`);
  return { row: rowFor(root, folder), raised: { task: `tasks/${folder}`, lane, title, details } };
}

function cardAnswer(root, body, today) {
  const { task: name, id, answer: text, change } = body || {};
  if (typeof text !== 'string' || text.trim() === '' || text.length > 2000) {
    throw new HttpError(400, 'answer must be a non-empty string of at most 2000 chars');
  }
  const folder = oneCard(root, name);
  const reply = text.trim();
  let target;
  try {
    cardsLib.change(root, folder, (c) => {
      target = c.questions.find((x) => x.id === id);
      if (change !== true) return cardsLib.answer(c, id, reply, today);
      // Change on an assumption: their note replaces the assumed answer
      if (!target) throw new Error('unknown question');
      if (target.kind !== 'assumed') throw new Error('only an assumption can be changed');
      return { ...c, questions: c.questions.map((x) => (x === target ? { ...x, answer: reply, answered: today } : x)) };
    });
  } catch (e) {
    if (e.message === 'unknown question') throw new HttpError(404, e.message);
    throw new HttpError(['already answered', 'only an assumption can be changed'].includes(e.message) ? 409 : 400, e.message);
  }
  lib.appendLog(root, folder, `- ${today} — card: ${target.q} → ${reply.replace(/\s*[\r\n]+\s*/g, ' ')}`);
  return { row: rowFor(root, folder), answered: { task: `tasks/${folder}`, id, kind: target.kind, q: target.q, answer: reply, date: today } };
}

// A stamp on a PR's card: `Post` (+ review, decisions), `Re-review`, `Changes: <note>`, `Done` or `Posted`. Everything is worked out before anything is written; Done also closes the card.
function cardPrStamp(root, body, today) {
  const { task: name, answer: text } = body || {};
  if (typeof text !== 'string' || text.trim() === '' || text.length > 2000) {
    throw new HttpError(400, 'answer must be a non-empty string of at most 2000 chars');
  }
  const folder = oneCard(root, name);
  const task = `tasks/${folder}`;
  const prFile = path.join(root, task, 'pr.md');
  const prText = fs.existsSync(prFile) ? fs.readFileSync(prFile, 'utf8') : null;
  const [kind, ...note] = text.trim().split(':');
  const stamp = { kind: kind.trim().toLowerCase(), review: body.review, decisions: body.decisions, note: note.join(':') };
  const state = { pr: prText, task };
  const at = `${today} ${new Date().toTimeString().slice(0, 5)}`;
  let next;
  try {
    if (prText == null) throw new HttpError(409, 'this card has no pr.md in its task folder');
    if (stamp.kind === 'post' && postState(parsePr(prText)) === 'requested') throw new HttpError(409, 'Post already requested, waiting on the dispatcher');
    next = applyPrStamp(state, stamp, at);
  } catch (e) {
    // A broken card can always be cleared: Done on a missing or unparsable pr.md closes it and logs it, the file is left alone.
    if (stamp.kind !== 'done') throw e instanceof HttpError ? e : new HttpError(400, e.message);
    next = { ...applyPrStamp({ ...state, pr: '## Timeline\n' }, stamp, at), pr: null };
  }
  if (next.pr != null) fs.writeFileSync(prFile, next.pr);
  if (next.close) cardsLib.change(root, folder, (c) => ({ ...c, closed: c.closed || today }));
  if (next.log) lib.appendLog(root, folder, next.log);
  return { row: rowFor(root, folder), answered: next.event };
}

function setClosed(root, body, value) {
  const folder = oneCard(root, (body || {}).task);
  try {
    cardsLib.change(root, folder, (c) => ({ ...c, closed: value }));
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  return { task: `tasks/${folder}`, row: rowFor(root, folder) };
}
// Closing a card closes its lead's pane; a lead herdr cannot reach does not keep the card open.
function cardClose(root, body, today, run) {
  const result = setClosed(root, body, today);
  const session = cardsLib.readCard(root, result.task.slice('tasks/'.length)).lead_session;
  try {
    const lead = session && leadLib.findLead(run, session);
    if (lead) leadLib.closeLead(run, lead.pane_id);
  } catch (e) {
    process.stderr.write(`close lead ${result.task}: ${e.message}\n`);
  }
  return result;
}
// Reopen also clears a drop (the stage stays), so a dropped card leaves Closed.
function cardReopen(root, body) {
  const folder = oneCard(root, (body || {}).task);
  if (JSON.parse(fs.readFileSync(path.join(root, 'tasks', folder, 'status.json'), 'utf8')).dropped) lib.writeStatus(root, folder, { dropped: null });
  return setClosed(root, body, null);
}

// --- the lead: chat on a card goes to its herdr agent; replies come back through .claude/hooks/lead_reply.py ---
const cardTitle = (root, folder) => cardsLib.readCard(root, folder).title || folder;

// Prompt the card's lead with text, starting (or resuming) it first when no pane hosts its session. The session id
// is stored only once a lead started on it, so a failed first start never leaves a session to resume that does not exist.
// A --resume that fails (no transcript yet: the first prompt never reached the lead) starts once more with --session-id.
function deliver(root, folder, text, run) {
  const card = cardsLib.readCard(root, folder);
  let session = card.lead_session;
  try {
    let lead = session ? leadLib.findLead(run, session) : null;
    if (lead?.agent_status === 'blocked') return { session, error: 'lead is waiting on you in its pane — use Go to lead' }; // a "yes" here would answer its prompt
    if (!lead) {
      const fresh = !session;
      const id = session || crypto.randomUUID();
      const opts = { root, folder, repo: lib.repoForTask(root, folder)?.path ?? null, session: id, title: cardTitle(root, folder) };
      try {
        lead = leadLib.startLead(run, { ...opts, resume: !fresh });
      } catch (e) {
        if (fresh) throw e;
        lead = leadLib.startLead(run, { ...opts, resume: false });
      }
      if (fresh) cardsLib.change(root, folder, (c) => ({ ...c, lead_session: id }));
      session = id;
    }
    leadLib.promptLead(run, lead.pane_id, text.replace(/\s*[\r\n\u2028\u2029]+\s*/g, ' ')); // herdr refuses newlines in an argument
    return { session };
  } catch (e) {
    return { session, error: e.message };
  }
}

function chatReply(root, folder, { session, error }, run) {
  return { lines: readThread(threadFile(root, folder)), lead: leadLib.leadState(run, session), ...(error && { error }) };
}

// Their message is saved to the thread first, so a herdr failure loses nothing: HTTP 200 with `error` for the Retry button.
function chat(root, body, run) {
  const { task: name, text } = body || {};
  if (typeof text !== 'string' || text.trim() === '' || text.length > 2000) {
    throw new HttpError(400, 'text must be a non-empty string of at most 2000 chars');
  }
  const folder = oneCard(root, name);
  appendLine(threadFile(root, folder), { who: 'Manager', text: text.trim(), card: { text: cardTitle(root, folder) } });
  return chatReply(root, folder, deliver(root, folder, text.trim(), run), run);
}

// Re-send their last line when no lead line followed it.
function chatRetry(root, body, run) {
  const folder = oneCard(root, (body || {}).task);
  const lines = readThread(threadFile(root, folder));
  const last = lines.findLastIndex((l) => l.who === 'Manager');
  if (last < 0 || lines.slice(last + 1).some((l) => l.who === 'lead')) throw new HttpError(409, 'nothing to retry: the lead already answered');
  return chatReply(root, folder, deliver(root, folder, lines[last].text, run), run);
}

function cardThread(root, name, run) {
  const folder = oneCard(root, name);
  return { lines: readThread(threadFile(root, folder)), lead: leadLib.leadState(run, cardsLib.readCard(root, folder).lead_session) };
}

function leadFocus(root, body, run) {
  const folder = oneCard(root, (body || {}).task);
  const session = cardsLib.readCard(root, folder).lead_session;
  let lead;
  try {
    lead = session ? leadLib.findLead(run, session) : null;
    if (lead) leadLib.focusLead(run, lead.pane_id);
  } catch (e) {
    throw new HttpError(502, e.message);
  }
  if (!lead) throw new HttpError(409, 'no lead is running for this card');
  return { task: `tasks/${folder}` };
}

// Close every idle lead whose card thread has had no line for `minutes`; each live session holds laptop memory.
// One `herdr agent list` per tick, and none when no card's thread has gone quiet.
function closeIdleLeads(root, run, now = new Date(), minutes = 30) {
  const quiet = cardsLib.listCards(root).filter(({ folder, card }) => {
    if (card.unreadable || !card.lead_session) return false;
    const lines = readThread(threadFile(root, folder.slice('tasks/'.length)));
    const [d, t] = (lines.at(-1)?.ts ?? '1970-01-01 00:00').split(' ');
    const [y, mo, da] = d.split('-').map(Number);
    const [h, mi] = t.split(':').map(Number);
    return now - new Date(y, mo - 1, da, h, mi) >= minutes * 60000;
  });
  if (!quiet.length) return;
  try {
    const leads = leadLib.listLeads(run);
    for (const { card } of quiet) {
      const lead = leads.find((l) => l.session === card.lead_session);
      if (lead && !['working', 'blocked'].includes(lead.agent_status)) leadLib.closeLead(run, lead.pane_id);
    }
  } catch (e) {
    process.stderr.write(`idle leads: ${e.message}\n`);
  }
}

// A lead recorded a decision from chat (bin/card assume): the event that wakes the dispatcher.
function cardDecided(root, body) {
  const folder = folderOr400((body || {}).task);
  const text = String((body || {}).text ?? '').trim();
  if (!text || text.length > 500) throw new HttpError(400, 'text must be 1 to 500 characters');
  if (!fs.existsSync(path.join(root, 'tasks', folder, 'card.json'))) throw new HttpError(404, 'no such card');
  return { task: `tasks/${folder}`, text };
}

// Wind down: close every card's lead, busy or not (its session resumes on the next chat message). The dispatcher
// stops its own helpers on the `winddown` event (/cards step 3).
function windDown(root, run) {
  const sessions = new Set(cardsLib.listCards(root).map(({ card }) => card.lead_session).filter(Boolean));
  let leads;
  try { leads = leadLib.listLeads(run).filter((l) => sessions.has(l.session)); } catch (e) { throw new HttpError(502, e.message); }
  for (const l of leads) leadLib.closeLead(run, l.pane_id);
  return { leads: leads.length };
}

const readThread = (file) => (fs.existsSync(file) ? parseThread(fs.readFileSync(file, 'utf8')) : []);

module.exports = { HttpError, rosterFor, task, shot, diff, files, file, taskFile, board, index, pipeline, stats, park, unpark, drop, cards, cardNew, cardAnswer, cardPrStamp, cardClose, cardReopen, chat, chatRetry, cardThread, leadFocus, closeIdleLeads, windDown, cardDecided };
