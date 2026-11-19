// The lead on a card: one Claude Code session in a herdr pane, found by its session id in `herdr agent list`.
// Every herdr call goes through an injected run(args) -> { stdout, stderr?, status }; never a shell string.
//
// What the Step 0 spike on herdr 0.8.0 found, and how it differs from the plan:
// - `herdr agent start` refuses an argument with a newline ("cannot be encoded safely for the target shell"), so the
//   instructions go in with `--append-system-prompt-file <root>/templates/lead.md`, not the file's text.
// - The lead starts with `--permission-mode auto` (the manager's choice, 2026-11-18: manual mode stopped every lead at a
//   prompt). Auto runs Bash commands outside --allowedTools, so the fence is --disallowedTools: no Edit or Write, no
//   commit, push or PR. A prompt it still stops on reads as agent_status `blocked`, shown as "waiting on you".
// - A lead that finished its turn reports `done`, not `idle`; both read as idle here.
// - `tab create` and `workspace create` focus the new tab unless told `--no-focus`; a lead never steals focus.
// - `agent prompt` with no wait, sent right after `agent start`, left the text in the input box unsubmitted. The
//   prompt now waits `--wait --until working` (a few seconds), so a lost submit is an error with a Retry, never silent.
//   The reply itself still arrives later through the lead_reply.py Stop hook.
// - startLead takes the card title for the tab label (≤ 40 chars) and repo may be null (no --add-dir).
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ALLOWED = ['Read', 'Grep', 'Glob', 'Bash(node bin/card ask:*)', 'Bash(node bin/card assume:*)'];
// Auto mode lets a lead run read commands without stopping; these stay refused whatever the mode.
const DENIED = ['Edit', 'Write', 'NotebookEdit', 'Agent', 'Bash(git commit:*)', 'Bash(git push:*)', 'Bash(gh pr:*)'];
const TITLE_CAP = 40;

function defaultRun(args) {
  try {
    // shortcut: blocks the server while a lead starts (seconds, 90 s worst case), switch to async execFile if stamps are missed
    return { stdout: execFileSync('herdr', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90000 }), status: 0 };
  } catch (e) {
    return { stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? e.message), status: e.status ?? 1 };
  }
}

// herdr's `result` object; throws with herdr's own error message on a non-zero exit or an `error` reply.
function call(run, args) {
  const { stdout, stderr, status } = run(args);
  let parsed = null;
  try { parsed = stdout ? JSON.parse(stdout) : null; } catch { parsed = null; }
  if (status !== 0 || parsed?.error) {
    throw new Error(parsed?.error?.message || String(stderr || stdout || '').trim() || `herdr ${args.slice(0, 2).join(' ')} failed`);
  }
  return parsed?.result ?? {};
}

// Every agent herdr hosts, from one `herdr agent list`: [{ session, pane_id, agent_status }].
const listLeads = (run) => (call(run, ['agent', 'list']).agents ?? []).map((a) => ({ session: a.agent_session?.value, pane_id: a.pane_id, agent_status: a.agent_status }));

function findLead(run, session) {
  const hit = listLeads(run).find((a) => a.session === session);
  return hit ? { pane_id: hit.pane_id, agent_status: hit.agent_status } : null;
}

function leadsWorkspace(run, root) {
  const found = (call(run, ['workspace', 'list']).workspaces ?? []).find((w) => w.label === 'leads');
  return found ? found.workspace_id : call(run, ['workspace', 'create', '--label', 'leads', '--cwd', root, '--no-focus']).workspace.workspace_id;
}

// herdr refuses an agent name over 32 characters; a long folder keeps its start and ends in the session id's start.
const agentName = (folder, session) => {
  const name = `lead-${folder}`;
  return name.length <= 32 ? name : `${name.slice(0, 23)}-${session.slice(0, 8)}`;
};

function startLead(run, { root, folder, repo, session, resume = false, title }) {
  const workspace = leadsWorkspace(run, root);
  const label = String(title || folder).slice(0, TITLE_CAP);
  const pane = call(run, ['tab', 'create', '--workspace', workspace, '--cwd', root, '--label', label, '--env', `CARD=tasks/${folder}`, '--no-focus']).root_pane.pane_id;
  const claude = [
    resume ? '--resume' : '--session-id', session,
    ...(repo ? ['--add-dir', repo] : []),
    '--model', 'opus', // only the dispatcher runs on Fable
    '--permission-mode', 'auto',
    '--append-system-prompt-file', path.join(root, 'templates', 'lead.md'),
    '--allowedTools', ...ALLOWED,
    '--disallowedTools', ...DENIED,
  ];
  try {
    call(run, ['agent', 'start', agentName(folder, session), '--kind', 'claude', '--pane', pane, '--', ...claude]);
  } catch (e) {
    run(['pane', 'close', pane]); // no half-started shell left behind
    throw e;
  }
  return { pane_id: pane };
}

// Returns once the lead has picked the prompt up (working); herdr answers agent_prompt_stalled when nothing moved in
// 5 s, which surfaces as the Retry reason instead of a message left unsent in the pane's input box.
// herdr reads the text only right after the target, refuses a `--` terminator, and parses a text equal to one of its
// own flags (`--wait`, `--timeout`) as that flag: a message starting with `-` goes out behind a visible `› `.
const promptLead = (run, pane, text) => {
  call(run, ['agent', 'prompt', pane, text.startsWith('-') ? `› ${text}` : text, '--wait', '--until', 'working', '--timeout', '20000']);
};
const closeLead = (run, pane) => { call(run, ['pane', 'close', pane]); };
const focusLead = (run, pane) => { call(run, ['agent', 'focus', pane]); };

function leadState(run, session) {
  if (!session) return 'none';
  let lead;
  try { lead = findLead(run, session); } catch { return 'none'; }
  if (!lead) return 'none';
  return { working: 'replying', blocked: 'waiting on you' }[lead.agent_status] ?? 'idle';
}

module.exports = { defaultRun, listLeads, findLead, startLead, promptLead, closeLead, focusLead, leadState };
