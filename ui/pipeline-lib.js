// Pure helpers for the Pipeline view: one row per status.json with the lane's stages as lights.
// Stage lists per lane come from CLAUDE.md "Stages" (quick skips plan, tdd and verify).
const STAGES = {
  quick: ['tdd', 'review', 'packet', 'scribe'],
  standard: ['brief', 'plan', 'tdd', 'review', 'verify', 'packet', 'scribe'],
  review: ['brief', 'review', 'done'],
  research: ['brief', 'research', 'done'],
};

function stagesFor(lane) {
  return STAGES[lane] ?? STAGES.standard;
}

// Open dispatches for a folder: start rows (shaped like .claude/hooks/dispatch-log.js writes them)
// whose task names the folder and that no done row with the same id has closed.
function openAgentCount(dispatches, folder) {
  const doneIds = new Set(dispatches.filter((d) => d.done).map((d) => d.id));
  return dispatches.filter((d) => !d.done && d.task === folder && !doneIds.has(d.id)).length;
}

// { card, folder, lane, stages: [{ name, state, label? }], awaiting, blocked_reason, agentCount }
// state: 'passed' before the current stage, 'current' at it ('awaiting' with its label when the
// card waits on the manager), 'pending' after. A blocked card keeps its lane stages and appends a
// 'blocked' light carrying blocked_reason. agentCount = open dispatch rows naming this folder.
function pipelineRow(status, dispatches = []) {
  const names = stagesFor(status.lane);
  const at = names.indexOf(status.stage);
  const stateFor = (i) => (i < at ? 'passed' : i === at ? 'current' : 'pending');
  const stages = names.map((name, i) => {
    const state = stateFor(i);
    return state === 'current' && status.awaiting
      ? { name, state: 'awaiting', label: status.awaiting }
      : { name, state };
  });
  if (status.stage === 'blocked') {
    stages.push({ name: 'blocked', state: 'blocked', label: status.blocked_reason ?? null });
  }
  return {
    card: status.card,
    folder: status.folder,
    lane: status.lane,
    stages,
    awaiting: status.awaiting ?? null,
    blocked_reason: status.blocked_reason ?? null,
    agentCount: openAgentCount(dispatches, status.folder),
  };
}

module.exports = { STAGES, stagesFor, pipelineRow, openAgentCount };
