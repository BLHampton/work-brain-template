---
name: assign
description: Start or resume a ticket through the helpers — brief, lane, then the quick or standard pipeline. Dispatcher-run; helpers never talk to each other.
argument-hint: "<TICKET-123 | one-line task | resume>"
disable-model-invocation: true
---

# assign

You are the dispatcher. Argument: `$ARGUMENTS`. Today's date is the `YYYY-MM-DD` in every line you write.
Helpers run one at a time via the Agent tool (`subagent_type` = the role name). A handoff is four things: card key, task folder path, `repos/<repo>.json` path, and the one item that role needs. Never paste transcripts or helper replies into another helper's prompt. Every helper returns a `CARD / STAGE / RESULT / LINE / FILES` block: act on `RESULT`, log `LINE`, read nothing else. `QUESTION` → the helper wrote `question.md`; `bin/card ask tasks/<folder> --from question.md`, stop this card. `BLOCKED` / `DISPUTE` → stage `blocked` with the `LINE` as reason, ask `Blocked: <LINE, ≤ 130 chars>` on the card with a suggested way out, stop this card.

**status.json** (`templates/status.json`) is the source of truth for the stage: rewrite it at every stage change and every stop. **card.json** holds what waits on the manager, written only with `bin/card`. **Stops never wait:** ask on the card, add a `log.md` line, end the turn (or pick up another card). The stamp listener (`/cards`) resumes you; never AskUserQuestion at a gate. Before each step on a card, read its Decided lines in `card.json`: a decision they made in chat with its lead arrives there as an assumed line.

## 0. Resume

If the argument is `resume`:
1. `resume tasks/<folder>` names the card. Bare `resume` → `bin/index`; take the latest card under Working; several → AskUserQuestion which one. None → say so, stop.
2. Read that folder's `status.json` (stage, attempts, review_round), `card.json` and `log.md`. No `status.json` → derive the stage from the newest handoff file (`qa.md` > `review.md` > `tdd-log.md` > `plan.md` > `brief.md`) and write one. No `card.json` → `bin/card new tasks/<folder> --title '<ticket> · <short title>'`.
3. One line: where it stopped. Continue from that stage below; never redo a finished stage. Skip 1 and 2.

## 1. Intake

1. Argument matches `^[A-Z]+-\d+$` → fetch read-only with `mcp__atlassian__getJiraIssue` (cloudId = `jiraCloudId` from `local.json` at the repo root; missing → ask the manager for it; load via ToolSearch if deferred). Summarize in 3 lines: problem, asked change, criteria as written. Never create or edit issues.
2. Anything else → it is the goal, ticket column is `none`.
3. Confirm the target repo: it must have a `repos/<repo>.json`. Missing → stop and name the file to add.

## 2. Brief with the manager

1. Draft `brief.md` from `templates/brief.md`: goal, testable acceptance criteria (one observable outcome each), lane with reason, `UI: yes | no` (CLAUDE.md "UI work"), out of scope, repo + branch. Branch name follows the JSON's `branch` style; ticketless tasks use the slug where the key would go.
2. Push back if the work looks not worth doing, the criteria are not testable, or the lane is wrong (real logic or edge cases → standard; UI tweak or glue → quick).
3. One AskUserQuestion: lane + criteria confirmation.
4. Create `tasks/YYYY-MM-DD-<slug>/` with `brief.md`, an empty `log.md` (template header only) and `status.json` from the template (card, folder, lane, repo path, stage `brief`), then `bin/card new tasks/<folder> --title '<ticket> · <short title>'` and `bin/card where tasks/<folder> '<where it stands>'`.
5. Append to `task-log.md`: `YYYY-MM-DD | <ticket> | <what> | <lane> | in-progress`.
6. UI `yes` → a helper builds `tasks/<folder>/research/mockups.html` from `templates/mockups.html` (2–4 variants from the repo's real tokens, one recommended) — standard: before the plan gate, and `plan.md` names the path; quick: before the variant question in step 3a.1, whose `--file` names it. No gate, no variant question and no implementer without it.
7. Branch: `git -C <path> status --porcelain` non-empty (ignoring paths under the JSON's `ignoreDirty`, if any) → STOP, show it, ask the manager (never stash or discard). Clean → `git -C <path> switch <defaultBranch> && git -C <path> pull --ff-only` (pull failure: say so, continue local) then `git -C <path> switch -c <branch>`.

## 3a. Quick lane

1. UI `yes` only (a quick card has no gate before the implementer): `bin/card ask tasks/<folder> --q 'Which mockup variant?' --suggested '<the recommended variant>' --why 'The implementer waits on the pick.' --file research/mockups.html`, log.md line, **end the turn**. Accept = the recommended variant; a note = their pick. Copy the choice into `brief.md`, then step 2. UI `no` → step 2 directly.
2. Stage `tdd`. `implementer` — handoff: card, task folder, repo JSON, the criteria (UI: plus the chosen variant). Route any `ASSUMED:` / `FYI:` lines in its reply as Throughout says.
3. Stage `review`. `reviewer` — handoff: card, task folder, repo JSON. Its `LINE` carries the verdict and the 5+ count.
4. `FAIL` → `review_round` + 1, `implementer` with the findings scored 5+; then `reviewer` again. Past the Tune-these rounds → stage `blocked`, ask `Blocked: <reason, ≤ 130 chars>` on the card, stop.
5. Diff gate (below).
6. Scribe (below).

## 3b. Standard lane

1. Write `plan.md` from `templates/plan.md`: approach, files, test list (one behavior per line), risks.
2. Plan gate: stage `plan`, `bin/card ask tasks/<folder> --kind 'plan approval' --file plan.md --q 'Approve the plan?' --suggested Approve --why '<n> criteria, <n>-test list; no code until then.'` (UI cards: the mockup path is in plan.md's Approach), log.md line, **end the turn**. `/cards` resumes you: Accept → stage `tdd`. A note → `misses.md` line, revise, ask a new plan approval. No code before approval.
3. TDD loop, per test-list item in order:
   1. `test-writer` — handoff: card, task folder, repo JSON, the one item. It lists the file in `gates.txt` and locks (`bin/gates lock`).
   2. Run the JSON's `singleTest` yourself. Red for the right reason = an assertion about the behavior. Compile, import or typo error → back to `test-writer` with the error.
   3. `implementer` — handoff: card, task folder, repo JSON, the failing test (name + file). It runs `bin/gates check` first.
   4. Run `singleTest` plus related tests yourself; confirm green. Red → `attempts` + 1, `implementer` again with the failure.
   5. One row in `tdd-log.md` (template columns).
   Limits (Tune these): same item bouncing 3× or the test list growing past the plan → stage `blocked`, ask `Blocked: <reason, ≤ 130 chars>` on the card, stop; the plan was probably wrong.
4. `reviewer` as in 3a steps 3–4.
5. Stage `verify`: run `node bin/gates check tasks/<folder>` (nonzero → `blocked` with its question), then `qa` — handoff: card, task folder, repo JSON. A failing criterion → `implementer` once with the failing row, then `qa` again; still failing → `blocked`. Flaky-on-arrival → `test-writer` with the file.
6. Diff gate (below), plus the qa summary line.
7. Scribe (below).

## Diff gate

1. Run each `prePr` command from the repo JSON (if any); keep the one-line result of each. Entries starting with `/` are slash commands — run them with the Skill tool from inside the target repo, not Bash.
2. Stage `packet`. Write `packet.md` from `templates/packet.md`: criteria → proof (test names from `tdd-log.md` / `qa.md`), what changed (`git -C <path> diff --stat <defaultBranch>...HEAD` plus uncommitted), top findings with scores from `review.md`, LOOK flags per the template's rules (UI `yes`: a `research/after/<state>.png` screenshot of the real component per changed state, listed in the packet; none → the packet is not raised), `prePr` results under Unusual, and the Ship block with the exact commit and push commands (commit message ends `For those who come after`). One screen; if they would need the diff to understand it, the packet failed.
3. `bin/card ask tasks/<folder> --kind 'ship approval' --file packet.md --q 'Ship: <packet title>?' --suggested Approve --why '<one-line summary>; "Approve: run Ship" runs the Ship block in packet.md.'` (LOOK flags and Ship commands stay in packet.md; the card opens it), log.md line, **end the turn**. `/cards` resumes you: "Approve: run Ship" → run exactly packet.md's Ship commands. A note → `misses.md` line, `implementer` with their words, then `reviewer`, back to 1 and a new ship approval.
4. The PR is the manager's. Tell them the branch is pushed and ready; the scribe runs once they confirm the PR exists.

## Scribe

1. Stage `scribe`. When the manager confirms the PR exists: `bin/pr-watch add <PR url> --task tasks/<folder> --as ours` (GitHub PRs only), then `scribe` `draft` — handoff: card, task folder, ticket key, branch + PR links. Ticketless task → skip the scribe, set the task-log line to `pr-open` and the stage to `done` yourself.
2. `bin/card ask tasks/<folder> --kind 'ticket approval' --file ticket-update.md --q 'Post the <ticket> comment?' --suggested Approve --why 'The draft is in ticket-update.md; nothing posts until then.'`, end the turn. A note → `misses.md` line, `scribe` `draft` again with their note, a new ticket approval.
3. Accept → `scribe` `post` with status `pr-open`; it posts the comment and updates `task-log.md` in place. Then stage `done`; the folder stays until the PR merges.

## Throughout

- Every stage result → one line in `log.md`: `- YYYY-MM-DD — <stage>: <result>`.
- Ambiguity that stops the card → `bin/card ask` (or a helper's `question.md` with `--from question.md`); this card stops, you move on (`/assign resume` continues it). A call you can make and they may override → `bin/card assume`, and carry on. News with no decision → a `log.md` line. A helper's `ASSUMED:` line → `bin/card assume`; its `FYI:` line → `log.md`, or a question if it needs their decision.
- A review task puts its PR on its card with `bin/pr-card review tasks/<folder> --json <file>` (verdict, to-dos, decisions for the manager, draft comment path; it creates `card.json` if missing), then adds the PR to the watcher: `bin/pr-watch add <PR url> --task tasks/<folder> --as reviewed` (GitHub PRs only; CLAUDE.md "PR watch"). A judgement call about the PR is a decision in `pr.md`; a finding about something else is a question or a `log.md` line.
- A quick-lane task that turns messy → ask on the card to re-lane (suggested: standard), move on.
- Helpers never commit, push, open PRs, or spawn helpers. The target repo's CLAUDE.md and `.claude/rules/` win on code conventions.
- No raw CRM/ES data (GUIDs, employee ids) in any file that reaches a ticket.

## End of task

Reply ≤ 6 lines: what shipped · lane · review verdict · qa result (or `n/a` quick) · ticket comment link (or `none`) · task-log status.
