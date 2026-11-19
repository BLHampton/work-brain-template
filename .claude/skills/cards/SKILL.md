---
name: cards
description: Listen for the manager's answers on the task cards and act on each one (gates, questions, assumptions, PR stamps, close and reopen). Dispatcher-run.
disable-model-invocation: true
---

# cards

You are the dispatcher. Today's date is the `YYYY-MM-DD` in every line you write. Every card is `tasks/<folder>/card.json`; CLAUDE.md "Cards" holds the rules, this skill the loop.

1. Run `bin/index`. No card under Needs you, Working, Waiting on someone else or Pull requests → say "No open cards." and stop. Otherwise say in one line which cards need them, and arm the listener in step 2 while that holds.
2. Start the UI and listen.
   - `curl -sf -o /dev/null http://127.0.0.1:4747/api/cards` fails → `node ui/server.js --open` with the Bash tool in the background (`run_in_background`). Tell the manager the URL (http://127.0.0.1:4747) in one line.
   - Arm the Monitor tool, `timeout_ms` 1800000, description `card stamps`:
     `{ tail --pid=$$ -n0 -F notes/pr-watch.log & curl -sN http://127.0.0.1:4747/api/events | grep --line-buffered -E '"type":"(new|answer|close|reopen|park|unpark|drop|winddown|decided)"'; kill $!; }`
   - The `tail` streams the PR watcher's lines (CLAUDE.md "PR watch"); it stops when the event stream ends (UI restart, laptop sleep), so the Monitor ends and you re-arm. `--pid` ends it if the shell is killed. Re-arm on expiry while the step 1 condition holds; stop it (TaskStop) when it no longer does or the manager says they are done.
   - Chat is not on this stream: the card's lead answers it (CLAUDE.md "Leads"). Never write in `threads/card.md`.
3. Act on each event as it lands: one line in chat, then the work. Each event is one JSON line.
   - **An answer** `{ type:'answer', task, id, kind, q, answer, date }`: the UI has already stored it on the card and written a `log.md` line; do not write those again. Read that question's `suggested` in `card.json`. `answer` equal to `suggested` is Accept; anything else is their note.
     - `plan approval`: Accept → stage `tdd`, continue `/assign` at the TDD loop. A note → rejection: one `misses.md` line, revise brief and plan from it, ask a new plan approval.
     - `ship approval`: Accept (an answer equal to `suggested`; the "Approve: run Ship" button sends it) → run exactly the Ship commands in `packet.md`, nothing more; the PR stays their. A note → rejection: one `misses.md` line, `implementer` with their words, then `reviewer`, a new packet and a new ship approval.
     - `ticket approval`: Accept → `scribe` `post`. A note → rejection: one `misses.md` line, `scribe` `draft` with the note, a new ticket approval.
     - `question`: the answer is their decision. Fill `## Answer` in `question.md` if the question came from one, copy the decision into `brief.md`, and resume the card at its stage. A blocked card: clear `blocked_reason` and set the stage their answer points to.
     - `assumed` (they changed an assumption): their note replaces it. Apply it to brief and plan, and re-run the stage it affects.
     - Unclear → ask a new question on the card (`bin/card ask`), never in chat.
   - **A PR stamp** `{ type:'answer', tag:'PR', task, file:'pr.md', answer, review?, decisions? }`: the UI has already written it into `pr.md`. CLAUDE.md "PR watch" holds the rules.
     - `Post` (`review`, `decisions`) → any decision chosen away from its `Default` in `pr.md`: post nothing, handle it as `Changes` (rework `pr-comment.md` to match the choice, `bin/pr-card review` again, the PR comes back at "comment ready"). All defaults → run the line `bin/pr-card post-command tasks/<folder> <review>` prints, then `bin/pr-card posted tasks/<folder> <link>`. Refused → `bin/pr-card note tasks/<folder> '! <command>'`, then `bin/pr-card stands tasks/<folder> 'comment ready' 'comment ready: run the command on the card'`; it stays at "comment ready" and shows the command to copy.
     - `Re-review` → start the next round now (review lane, round + 1): `bin/pr-card stands tasks/<folder> re-reviewing`, `bin/pr-watch done <url>` if it was queued; the result lands with `bin/pr-card review`.
     - `Changes` → rework the draft comment or the review per the note, then `bin/pr-card review` again; unclear → a decision in `pr.md`.
     - `Done` → the card is closed and logged; `bin/pr-watch remove <url>`, then finish the review task (stage `done`, task-log).
     - `Posted` (not a GitHub PR, they pasted the comment themselves) → `bin/pr-card stands tasks/<folder> 'waiting on author'`.
   - **A next step on finished research** (an `answer` to a `next step` question). The answer starts with the button they pressed; text after `: ` is their note. When the work it starts is finished and the card is at `done` again, ask a new `next step` question (research skill step 10).
     - `Dig further: <what>` → stage back to `research`, run that one angle (worktree, researcher), add it to `research/synthesis.md` under `## Addenda`, update `where`, stage `done`.
     - `Build it` → a new task folder as `/assign` would make it (feature, lane by size), its brief starting from this card's `research/synthesis.md` and naming this folder; `bin/card where` on this card names the new card. This card stays for them to close.
     - `Write tickets` → draft the Jira tickets from the synthesis into `ticket-update.md`, then a `ticket approval` question on this card; nothing posts before they approve.
     - `Draft a message: <who>` → load the `send-to` skill, write `research/message.md` for that person from the synthesis, and `bin/card ask` with `--file research/message.md` so they read it on the card; they send it themselves.
     - Anything else → their own instruction: do what it says, or ask on the card if it is unclear.
   - **A decision from chat** `{ type:'decided', task, text }`: The manager decided something with the card's lead, and it is already under Decided on the card. Act on it now, not at the next step: if it changes the brief or the plan, stop that card's running helper (`TaskStop`, `bin/dispatch done`), copy the decision into `brief.md`, and go back to the stage it changes (a changed plan means a new plan approval). If it changes nothing in flight, carry on.
   - **Wind down** `{ type:'winddown' }`: The manager is logging off; the UI has already closed every lead. Stop every running helper now (`TaskStop`, then `node bin/dispatch done <helper> --task tasks/<folder>`). Leave each card's `status.json` at the stage it was in (the unfinished stage is redone tomorrow) and set its `where` to one line on where it stopped (`bin/card where`). Start nothing new, do not arm the listener again, and end the turn.
   - **A new card** `{ type:'new', task, lane, title, details }`: The manager raised it in the UI. The folder already has `status.json` (stage `brief`), `card.json` and a first `log.md` line with their words; do not create them again. Treat it as `/assign` with `title` and `details` as the request: add the `task-log.md` line, write `brief.md`, and re-lane a small feature to quick by rewriting `lane`. Anything you cannot work out from their words is a question on the card.
   - **A close** `{ type:'close', task }`: The manager is finished with it. Stop any helper working on it (`TaskStop`), start nothing new, add a `log.md` line with the stage it closed at.
   - **A reopen** `{ type:'reopen', task }`: read `card.json` and `log.md`. Stage not `done` → resume it (step 4). Done → nothing until a question lands.
   - **A park or a drop** `{ type:'park'|'drop', task, status }`: stop that card's helpers (`TaskStop`) and start nothing new on it.
   - **An unpark** `{ type:'unpark', task, status }`: resume it at its stage (step 4).
   - Accepting a question whose file or text quotes exact git commands is their go for those commands and nothing more; accepting a card that shows `! <command>` runs nothing: they run it.
   - **A `REREVIEW <folder> <url> <sha>` line** (from the PR watcher): apply the queue rule in CLAUDE.md "PR watch" — start the re-review if the Parallel worktrees limit allows, then `bin/pr-watch done <url>`; otherwise leave it queued.
4. Any answer on a card whose stage is not `done` → `/assign resume tasks/<folder>` picks it up (research cards: `/research resume`).
5. End with one line: `N answered, M cards need you.`

## When the manager answers in this chat instead

For each open question: one AskUserQuestion, header = the card's title, the question's `q` as the question, options = its `suggested` and "other". Send their answer through the UI so it lands like any other answer: `curl -s -X POST http://127.0.0.1:4747/api/card/answer -H 'content-type: application/json' -d '{"task":"<folder>","id":"<id>","answer":"<answer>"}'` (`<folder>` without `tasks/`). They stop partway → leave the rest open on their cards.
