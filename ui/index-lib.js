// Pure helpers for the thin index: every task's status.json + card.json, rendered as
// Needs you / Working / Waiting on someone else / Done, not closed / Parked / Pull requests / Faults.
// Generated on demand (bin/index), never hand-maintained.
const fs = require('node:fs');
const path = require('node:path');
const { readStatuses, listCards, openQuestions, validate } = require('./cards-lib');
const { parsePr, needsYou } = require('./pr-card-lib');

const LINE_CAP = 120;
const clip = (s) => (s.length > LINE_CAP ? `${s.slice(0, LINE_CAP - 1)}…` : s);

function renderIndex(rows, prCards = []) {
  const inState = (state) => rows.filter((r) => r.state === state);
  const needs = inState('needs you')
    .map((r) => (r.open
      ? `- ${r.status.card} | ${r.open} open | ${openQuestions(r.card)[0].q} | ${r.folder}`
      : `- ${r.status.card} | PR | ${r.card.where || r.pr.stands} | ${r.folder}`));
  const working = inState('working')
    .map((r) => `- ${r.status.card} | ${r.status.lane} | ${r.status.stage} | attempt ${r.status.attempts ?? 0} | round ${r.status.review_round ?? 0} | ${r.folder}`);
  const waiting = inState('waiting on someone else')
    .map((r) => `- ${r.status.card} | ${r.card.waiting_on} | ${r.folder}`);
  const done = inState('done')
    .map((r) => `- ${r.status.card} | ${r.card.where ?? ''} | ${r.folder}`);
  const parked = inState('parked')
    .map((r) => `- ${r.status.card} | ${r.status.lane} | ${r.status.stage} | ${r.folder}`);
  const prs = [...prCards.filter((c) => c.needsYou), ...prCards.filter((c) => !c.needsYou)]
    .map((c) => `- ${c.task} | ${c.repo}#${c.number} | ${c.stands} | round ${c.round}${c.rereviewSha ? ` | ${c.rereviewSha.slice(0, 7)}` : ''}`);
  const faults = rows.flatMap((r) => {
    if (r.state === 'closed') return [];
    if (r.card.unreadable) {
      return ['done', 'parked'].includes(r.state) ? [] : [`- ${r.folder} | no readable card.json (${r.card.unreadable})`];
    }
    const blocked = r.status.stage === 'blocked' && r.state !== 'done' && r.state !== 'parked' && r.open === 0;
    return [
      ...(blocked ? [`- ${r.folder} | blocked with no open question`] : []),
      ...validate(r.card).slice(0, 1).map((m) => `- ${r.folder} | ${m}`),
    ];
  });
  const section = (title, lines) => `## ${title}\n${lines.length ? lines.map(clip).join('\n') : '- none'}`;
  return [
    section('Needs you', needs),
    section('Working', working),
    section('Waiting on someone else', waiting),
    section('Done, not closed', done),
    section('Parked', parked),
    section('Pull requests', prs),
    section('Faults', faults),
  ].join('\n\n') + '\n';
}

// The PR watch list from <root>/pr-watch.json; a missing or unparsable file is an empty list, never a throw.
function readWatchList(root) {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(root, 'pr-watch.json'), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// One entry per open card whose task folder holds a readable pr.md; a missing or unreadable file drops that card, never throws.
function readPrCards(root, rows) {
  const queued = readWatchList(root).filter((e) => e.rereview === 'queued');
  return rows.filter((r) => r.state !== 'closed').flatMap((r) => {
    try {
      const pr = parsePr(fs.readFileSync(path.join(root, r.folder, 'pr.md'), 'utf8'));
      const rereviewSha = queued.find((e) => e.task === r.folder)?.rereviewSha;
      return [{ task: r.folder, repo: pr.repo, number: pr.number, stands: pr.stands, round: pr.round, needsYou: needsYou(pr), ...(rereviewSha ? { rereviewSha } : {}) }];
    } catch {
      return [];
    }
  });
}

function index(root, warn) {
  const rows = listCards(root, warn);
  return renderIndex(rows, readPrCards(root, rows));
}

module.exports = { readStatuses, renderIndex, index };
