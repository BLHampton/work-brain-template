// Pure helpers for the roster view: who is working on what, and each agent's record.
const fs = require('node:fs');
const path = require('node:path');

const EMPTY = { status: 'idle', mission: null, task: null, since: null, record: { missions: 0, bugsCaught: 0, avgMinutes: 0 } };

function agentNames(root) {
  const dir = path.join(root, '.claude', 'agents');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => path.basename(f, '.md')).sort();
}

// One object per well-formed line of ui/dispatch.jsonl; missing file = none, malformed lines skipped.
function readDispatches(root) {
  const file = path.join(root, 'ui', 'dispatch.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

// The agent's newest start line (on `task`, when given), and whether a done line shares its id. Older
// starts are ignored, so a cancelled run with no done line stops mattering once a newer dispatch exists.
function newestStart(dispatches, name, task) {
  const start = dispatches.filter((d) => d.agent === name && !d.done && (!task || d.task === task)).at(-1);
  if (!start) return undefined;
  return { ...start, open: !dispatches.some((d) => d.done && d.id === start.id) };
}

// The done row that closes the agent's newest start (on `task`, when given), timed from that start to `now`;
// null when that start is already done or there is none. One writer for the SubagentStop hook and `bin/dispatch done`.
function doneLineFor(dispatches, agent, now, task) {
  const start = newestStart(dispatches, agent, task);
  if (!start?.open) return null;
  return {
    ts: now.toISOString(),
    id: start.id,
    agent,
    done: true,
    seconds: Math.round((now - Date.parse(start.ts)) / 1000),
  };
}

// Contents of tasks/*/<file>, for every task folder that has one.
function taskFiles(root, file) {
  const dir = path.join(root, 'tasks');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((t) => path.join(dir, t, file)).filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f, 'utf8'));
}

// Markdown table rows across tasks/*/<file>, as trimmed cells; header and `---` rows stay in but never match a counter below.
function tableRows(root, file) {
  return taskFiles(root, file).flatMap((text) => text.split('\n'))
    .filter((l) => l.startsWith('|'))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
}

// reviewer: review.md whose own Verdict line is CHANGES_REQUESTED (body mentions don't count).
// qa: qa.md rows with pass/fail cell `fail`. test-writer: tdd-log.md rows whose red-confirmed cell starts with `yes`.
const COUNTERS = {
  reviewer: (root) => taskFiles(root, 'review.md').filter((t) => /^Verdict: CHANGES_REQUESTED\s*$/m.test(t)).length,
  qa: (root) => tableRows(root, 'qa.md').filter((c) => c[2] === 'fail').length,
  'test-writer': (root) => tableRows(root, 'tdd-log.md').filter((c) => c[2]?.startsWith('yes')).length,
};

function bugsCaught(root, name) {
  return COUNTERS[name]?.(root) ?? 0;
}

// Done lines with null seconds count as missions but are left out of the average.
function record(root, dispatches, name) {
  const done = dispatches.filter((d) => d.agent === name && d.done);
  const secs = done.map((d) => d.seconds).filter((s) => typeof s === 'number');
  const avgMinutes = secs.length ? Math.round((secs.reduce((a, b) => a + b, 0) / secs.length / 60) * 10) / 10 : 0;
  return { missions: done.length, bugsCaught: bugsCaught(root, name), avgMinutes };
}

// Newest task-log.md row (`date | ticket | what | lane | status`) still open; shaped like a dispatch start line.
function leadStart(root) {
  const file = path.join(root, 'task-log.md');
  if (!fs.existsSync(file)) return undefined;
  const rows = fs.readFileSync(file, 'utf8').split('\n').map((l) => l.split('|').map((c) => c.trim()));
  const open = rows.filter((c) => c.length === 5 && /^\d{4}-\d{2}-\d{2}$/.test(c[0]) && !['deployed', 'dropped'].includes(c[4])).at(-1);
  return open && { mission: open[2], task: null, ts: open[0] };
}

function rosterFor(root) {
  const dispatches = readDispatches(root);
  return [...agentNames(root), 'lead'].map((name) => {
    const start = name === 'lead' ? leadStart(root) : newestStart(dispatches, name);
    const working = name === 'lead' ? !!start : start?.open;
    const status = working ? { status: 'working', mission: start.mission, task: start.task, since: start.ts }
      : start ? { mission: start.mission, task: start.task } : {};
    return { name, ...EMPTY, ...status, record: record(root, dispatches, name) };
  });
}

module.exports = { readDispatches, newestStart, doneLineFor, rosterFor };
