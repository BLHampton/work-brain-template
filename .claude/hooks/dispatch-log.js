// PreToolUse (Agent tool) and SubagentStop hook: append one dispatch line to ui/dispatch.jsonl.
// Start lines carry the tool_use_id; SubagentStop has no id, so the done line pairs with the
// newest start for its agent_type when that start is still open. Observability only: never blocks, never exits non-zero.
const fs = require('node:fs');
const path = require('node:path');
const { readDispatches, doneLineFor } = require('../../ui/roster-lib');

const BRAIN_ROOT = process.env.WORK_BRAIN_ROOT || path.resolve(__dirname, '..', '..');
const LOG = path.join(BRAIN_ROOT, 'ui', 'dispatch.jsonl');

function startLine(input) {
  const t = input.tool_input || {};
  // Background dispatches return at once; they are not missions.
  if (input.tool_name !== 'Agent' || t.run_in_background) return null;
  const task = (t.prompt || '').match(/tasks\/[\w.-]+/);
  return {
    ts: new Date().toISOString(),
    id: input.tool_use_id,
    agent: t.subagent_type,
    mission: t.description,
    task: task ? task[0] : null,
  };
}

function doneLine(input) {
  return doneLineFor(readDispatches(BRAIN_ROOT), input.agent_type, new Date());
}

function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const build = { PreToolUse: startLine, SubagentStop: doneLine }[input.hook_event_name];
  const line = build && build(input);
  if (line) fs.appendFileSync(LOG, JSON.stringify(line) + '\n');
}

try {
  main();
} catch (e) {
  process.stderr.write(`dispatch-log: warning: ${e.message}\n`);
}
