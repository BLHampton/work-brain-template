# work-brain

A small workflow for running real tickets through Claude Code while you act as the manager: you assign work, answer questions and approve at a few gates, and the agents do the rest.

This is a template taken from one person's working setup. It is not a product, and it assumes the tools listed under "What you need". The files call the person it works for "the manager".

## How it works

- **Cards.** Every piece of work is a folder under `tasks/` with one card. The card is the only place the system reaches you: questions, approvals, results. You answer on the card in a local web page, not in a chat window.
- **Dispatcher.** One Claude Code session, started in this repo, runs the work. `CLAUDE.md` is its manual. It writes the brief, hands stages to helpers, and stops at the gates.
- **Helpers.** Short-lived subagents with one job each: test-writer, implementer, reviewer, qa, researcher, scribe (`.claude/agents/`). A hook keeps the test-writer in test files and the implementer out of them.
- **Leads.** Chat on a card starts a read-only Claude session for that card in a [herdr](https://herdr.dev) pane. It answers your questions about the card and records decisions on it; it cannot change files, commit or push.

### Kinds of work

| Kind | Flow |
| --- | --- |
| Quick | implement → review → **you approve the diff** → ticket update |
| Standard | brief + plan → **you approve the plan** → one failing test at a time → review → qa → **you approve the diff** → ticket update |
| Research | brief → **you approve the scope** → researchers in a read-only worktree → one written answer → "What next?" |
| PR review | worktree on the PR branch → reviewer → a draft comment on the card for you to post |

Nothing is committed, pushed or posted to a ticket without your approval on the card.

## What you need

- [Claude Code](https://claude.com/claude-code)
- Node 22 or newer (no npm packages) and Python 3 (two hooks)
- [herdr](https://herdr.dev) for the per-card leads and worktrees
- `gh` for the pull request watcher, `curl`, and optionally `btop` for the resource monitor
- A Jira connection in Claude Code if you want ticket reads and updates

## Start

```sh
git clone <this repo> && cd work-brain
bin/morning
```

`bin/morning` starts the cards page on `http://127.0.0.1:4747`, the pull request watcher, and a dispatcher session. The page only listens on your own machine.

Then:

- `/assign TICKET-123` or `/assign <one line>` starts a card, or use **+ New card** on the page.
- `/research <question>` answers a question, in chat when it is small and as a research card when it is not.
- `/cards` makes the dispatcher listen for your answers on the page.
- `/brain-retro` writes the weekly retro.

Before working in a target repo, add `repos/<name>.json` for it (path, test-file patterns, single-test command, branch style). `repos/work-brain.json` is the example.

Machine-specific values live in `local.json`, which is not committed:

```json
{
  "jiraCloudId": "<your Jira cloud id>",
  "morningDirs": ["/path/to/a/repo/the/dispatcher/may/read"]
}
```

## Make it yours

1. In `CLAUDE.md`, replace the paragraph under "The manager" with a few lines about yourself.
2. Set `path` and `remote` in `repos/work-brain.json` to your clone, and add one `repos/<name>.json` per repo you work in.
3. Create `local.json` as shown above.
4. Adjust the limits under "Tune these" in `CLAUDE.md` to your machine.

## What is in the repo

| Path | What |
| --- | --- |
| `CLAUDE.md` | The dispatcher's manual: lanes, stages, gates, hard rules, tunable limits |
| `.claude/agents/` | The six helpers |
| `.claude/skills/` | `/assign`, `/research`, `/cards`, `/brain-retro` |
| `.claude/hooks/` | Role guard, dispatch log, the guard against ending a turn on a question, lead replies |
| `templates/` | The shape of every file in a task folder |
| `bin/` | `morning`, `index`, `card`, `pr-card`, `pr-watch`, `gates`, `dispatch`, `monitor`, `cpu-watch` |
| `ui/` | The cards page (`server.js`, `index.html`) and its libraries and tests |

## What is not in the repo

Only the structure is committed. Everything about actual work stays on your machine and is git-ignored: `tasks/`, `task-log.md`, `answers.md`, `misses.md`, `suggestion-box.md`, `retros/`, `notes/`, `local.json`, and every `repos/*.json` except the example.

## Tests

```sh
node --test '.claude/hooks/*.test.js' 'ui/*.test.js'
```
