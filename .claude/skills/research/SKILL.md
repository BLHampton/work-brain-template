---
name: research
description: Answer a work question — quick answer in chat logged to answers.md, or the full research lane (brief, scope gate, read-only worktree, researchers, one synthesis). Dispatcher-run.
argument-hint: "<question | resume>"
disable-model-invocation: true
---

# research

You are the dispatcher. Argument: `$ARGUMENTS`. Today's date is the `YYYY-MM-DD` in every line you write.

## 0. Triage

Quick unless any of these holds, then full:
- the answer drives a ticket, an estimate or a decision the manager has to make;
- it needs more than one repo or more than one system (Jira, LaunchDarkly, git, Confluence);
- a quick attempt has already spent ~10 tool calls without an answer.

Say which in one line. `resume` → read `task-log.md` for the latest `research` task not `deployed`/`dropped`, read its `log.md`, continue at the stage it stopped.

## 1. Quick answer

1. Answer from what is on disk or one read call per system: grep, `git log`, `getJiraIssue`, LaunchDarkly `get-*`. No helpers, no task folder, no card, no branch.
2. Reply in ≤ 6 lines with the evidence (file:line, flag key, ticket, commit).
3. Append to `answers.md`: `- YYYY-MM-DD — <tasks/<folder> if an open task is about this, else nothing> — Q: <question> · A: <answer in one or two lines>`.
4. If an open research task covers it, also append the answer as a dated addendum to that task's `research/synthesis.md` under `## Addenda`, and a `log.md` line.
5. Budget blown or the answer needs a second system → stop, say what you found, propose the full lane. One AskUserQuestion: go full / drop it.

## 2. Full lane

1. **Brief.** Draft `brief.md` from `templates/brief.md`: Goal = the decision this research informs, in one sentence; Ticket; Lane = `research — <why not quick>`; acceptance criteria as questions that have an evidence-backed answer ("every LD call site listed with file:line and winning branch"); Out of scope; Repo + branch (`none · read-only worktree`). Push back if the question is really "do X" (that's `/assign`).
2. **Scope gate**, before any researcher runs: one AskUserQuestion on goal + criteria + out of scope. Changes later in the task mean redirected researchers and stale reports; make the scope fight happen here.
3. Create `tasks/YYYY-MM-DD-<slug>/` with `brief.md`, empty `log.md`, empty `research/`, and `status.json` from the template (lane `research`, stage `research`). `bin/card new tasks/<folder> --title '<ticket or slug> · <question in a few words>'`, then `bin/card assume tasks/<folder> 'Scope: <out-of-scope list, ≤ 130 chars>'`. Append to `task-log.md`: `YYYY-MM-DD | <ticket> | <what> | research | in-progress`.
4. **Worktree.** `git -C <path> worktree add --detach <root>/<slug> <defaultBranch>` where `<root>` = the JSON's `worktreeRoot` or `~/source/repos/.wt/<repo name>`. Nobody installs or builds in it; researchers read from it so a task's checkout is never touched. A dirty main checkout does not block research.
5. **Baseline.** If `notes/` already has a note on the question, copy it to `research/baseline.md`. Otherwise write one yourself, ≤ 1 page: footprint, what is already known, prior art (branches, tickets). Researchers go one level deeper, they do not redo it.
6. **Decompose.** Mutually exclusive angles, one `researcher` per angle: 1 for a single factual question, 3 for a focused topic with a few natural angles, 4 for distinct evaluation criteria, 5 for independent systems or domains. Say the angles in one line. Researchers only read, so they may run in parallel (one Agent call with several tool uses). Handoff: task folder, repo JSON, worktree path, the one angle. Route `FYI:` lines in replies to `log.md` and `ASSUMED:` lines to `bin/card assume`; a `RESULT: QUESTION` → `bin/card ask tasks/<folder> --from question.md`, and carry on with the other angles.
7. **Synthesis.** File each angle's "Outlives the task" lines in this repo's auto-memory folder (one file per fact, index line in `MEMORY.md`). Write `research/synthesis.md` from `templates/synthesis.md` from the angle files; read their Answer and Open-questions sections, not everything. Check each criterion in `brief.md` has an answer; one missing → one more researcher pass on that gap, never a second full round.
8. **Hand over on the card.** `bin/card result tasks/<folder> research/synthesis.md`, then `bin/card where tasks/<folder> '<the answer in one line>'`. Each decision only the manager can make → one `bin/card ask` with a suggested answer (at most three show at a time; the rest wait in order). Never "N decisions inside" on the card.
9. Set the task-log line to `deployed` and the stage to `done` (the synthesis is the deliverable) and `git -C <path> worktree remove <root>/<slug>`. Follow-up questions after this are quick answers, filed as addenda (1.4).
10. **Ask what is next.** A finished research card never just sits under Done: `bin/card ask tasks/<folder> --kind 'next step' --file research/synthesis.md --q 'Research is done. What next?' --suggested 'Close' --why 'The next move is yours.'`. The card shows Dig further, Build it, Write tickets, Draft a message and Close; `/cards` step 3 says what each answer starts.

## Throughout

- Every stage result → one line in `log.md`: `- YYYY-MM-DD — <stage>: <result>`.
- No code changes, no flags toggled, no tickets edited. Work the research turns up goes through `/assign` as its own task.
- No raw CRM/ES data (GUIDs, employee ids) in any file.

## End

Quick: the answer. Full: ≤ 4 lines — answer · angles run · decisions count · task-log status.
