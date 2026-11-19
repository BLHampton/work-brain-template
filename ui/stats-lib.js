// Pure helpers for the Stats view: dispatch rows (shaped like .claude/hooks/dispatch-log.js writes
// them) paired into one record per agent run.

// Whole seconds between two ISO timestamps.
function secondsBetween(startTs, endTs) {
  return Math.round((Date.parse(endTs) - Date.parse(startTs)) / 1000);
}

// Longest span an inferred close may book: a worker whose next same-agent start is days away did
// not run for days. Inferred spans over this are recorded at the cap with `capped: true`.
const INFERRED_CAP_SECONDS = 2 * 60 * 60;

// Inferred span fields: the raw gap when within the cap, else the cap plus a `capped` mark.
function inferredSpan(startTs, endTs) {
  const raw = secondsBetween(startTs, endTs);
  return raw > INFERRED_CAP_SECONDS ? { seconds: INFERRED_CAP_SECONDS, capped: true } : { seconds: raw };
}

// One record per start row, closed by the done row that shares its id. A start with no done row
// is closed by the next start of the same agent (inferred, capped at INFERRED_CAP_SECONDS); the
// newest such start stays open. Done rows emit nothing.
function pairDispatches(rows) {
  const doneById = new Map(rows.filter((r) => r.done).map((r) => [r.id, r]));
  const starts = rows.filter((r) => !r.done);
  return starts.map((r, i) => {
    const base = { id: r.id, agent: r.agent, task: r.task, mission: r.mission, start: r.ts };
    const done = doneById.get(r.id);
    if (done) return { ...base, end: done.ts, seconds: done.seconds, inferred: false, open: false };
    const next = starts.slice(i + 1).find((s) => s.agent === r.agent);
    if (next) return { ...base, end: next.ts, ...inferredSpan(r.ts, next.ts), inferred: true, open: false };
    return { ...base, end: null, seconds: null, inferred: false, open: true };
  });
}

// Pipeline stage an agent role's time counts toward; roles outside the loop are 'other'.
const STAGE_BY_AGENT = {
  'test-writer': 'tdd',
  implementer: 'tdd',
  reviewer: 'review',
  qa: 'verify',
  researcher: 'research',
  scribe: 'scribe',
};

function stageOf(agent) {
  return STAGE_BY_AGENT[agent] || 'other';
}

// Empty per-folder accumulator; card/lane/stage come from the folder's status (null without one).
function emptyCard(folder, status) {
  return {
    folder,
    card: status ? status.card : null,
    lane: status ? status.lane : null,
    stage: status ? status.stage : null,
    dispatches: 0,
    agentSeconds: 0,
    inferredSeconds: 0,
    roles: {},
    stages: {},
  };
}

// Fold one paired dispatch into a card; open pairs count as dispatches but add no seconds.
function addPair(card, pair) {
  const seconds = pair.open ? 0 : pair.seconds;
  const role = card.roles[pair.agent] || { count: 0, seconds: 0 };
  const stage = stageOf(pair.agent);
  return {
    ...card,
    dispatches: card.dispatches + 1,
    agentSeconds: card.agentSeconds + seconds,
    inferredSeconds: card.inferredSeconds + (pair.inferred ? seconds : 0),
    roles: { ...card.roles, [pair.agent]: { count: role.count + 1, seconds: role.seconds + seconds } },
    stages: { ...card.stages, [stage]: (card.stages[stage] || 0) + seconds },
  };
}

// Whole seconds the dispatcher spent between a folder's consecutive dispatches: pairs ordered by
// start, each closed pair contributes max(0, next.start - its end), capped at INFERRED_CAP_SECONDS
// (an overnight idle is not dispatcher time); an open pair has no gap after it.
function dispatcherSeconds(pairs) {
  const ordered = pairs.slice().sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const total = ordered.reduce((sum, pair, i) => {
    const next = ordered[i + 1];
    if (pair.open || !next) return sum;
    return sum + Math.min(INFERRED_CAP_SECONDS, Math.max(0, secondsBetween(pair.end, next.start)));
  }, 0);
  return Math.round(total);
}

// One entry per task folder that has at least one dispatch, with time summed per role and stage,
// the dispatcher's gap time between dispatches, how many dispatches are still open, and when the
// folder was last touched.
function statsByCard(pairs, statuses) {
  const statusByFolder = new Map(statuses.map((s) => [s.folder, s]));
  const pairsByFolder = new Map();
  for (const pair of pairs) {
    pairsByFolder.set(pair.task, [...(pairsByFolder.get(pair.task) || []), pair]);
  }
  return [...pairsByFolder.entries()].map(([folder, folderPairs]) => ({
    ...folderPairs.reduce(addPair, emptyCard(folder, statusByFolder.get(folder))),
    dispatcherSeconds: dispatcherSeconds(folderPairs),
    openCount: folderPairs.filter((p) => p.open).length,
    lastTs: lastTs(folderPairs),
  }));
}

// Newest timestamp a folder's dispatches touched (an end when closed, the start when open), so the
// UI can tell a card that went quiet from one still moving.
function lastTs(pairs) {
  const times = pairs.map((p) => Date.parse(p.end || p.start)).filter((t) => !Number.isNaN(t));
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

module.exports = { INFERRED_CAP_SECONDS, pairDispatches, stageOf, statsByCard };
