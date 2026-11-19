---
name: brain-retro
description: Friday retro with the manager — the week's work, which skills and agents earned their keep, and how the dispatcher and the manager work together. Writes retros/YYYY-MM-DD.md.
disable-model-invocation: true
---

# brain-retro

You are the dispatcher. Today is `YYYY-MM-DD`; the week runs from the most recent Monday through today. Keep this a conversation: short turns, the manager talks more than you do.

## 1. Gather (read-only, no questions yet)

1. `task-log.md`: every line dated this week, plus older lines whose status changed this week (compare with the previous retro's table in `retros/`).
2. Each of those tasks' `log.md`, `tdd-log.md`, `review.md`: count gates answered, review bounces, TDD bounces, questions asked on cards. Count Agent handoffs and slash skills by name from the log lines. Do not infer anything the files don't show.
3. `suggestion-box.md` entries dated this week, and the previous retro's "Next week" list (unchecked items carry over).
4. `bin/index`: any card that needs them goes in the opening line.

## 2. Open

Six lines at most: shipped / in flight / dropped, gates and bounces, skills used (with counts), what carried over. Then stop and let the manager react.

## 3. Chat through it

Ask these one at a time, in plain chat (not AskUserQuestion), and wait for each answer. Skip any they have already covered.
1. What felt good this week?
2. Where did it drag — a stage, a skill, an agent, me?
3. Where did I guess wrong, ask too much, or make you micromanage?
4. Which skill or agent earned its keep, which didn't?
5. What should we try next week?

Push back where the files disagree with their memory, briefly, with the line you read.

## 4. Write

1. `retros/YYYY-MM-DD.md` from `templates/retro.md`. The manager's words over yours.
2. "Proposed edits" are exactly that: list the `CLAUDE.md` and `~/.claude/memory/*.md` lines you would change and why. Apply only the ones they OK, verbatim, in this conversation. Anything they're unsure about goes to `suggestion-box.md` under today's date, prefixed `retro:`.
3. Show the file path and the "Next week" list.

## 5. Clean up

1. List cleanup candidates (read-only): task folders dated more than 10 days ago whose `status.json` stage is `done`, or that have no `status.json` and whose `log.md` ends in a ship, close or Ack. Drop any that has a card in `inbox.md` or `parked.md`, a worktree under `~/.herdr/worktrees`, an unbuilt plan (last line a PLAN GATE Approve with no ship after it), or is named in `notes/`, the memory files or a newer task folder.
2. Also list: worktrees under `~/.herdr/worktrees` that no in-flight card claims (with `du -sh`), and `task-log.md` rows still `in-progress` whose task already shipped.
3. Show the three lists with sizes in one message; the manager says which go.
4. For what they OK: archive the folders to `~/work-brain-archive/tasks-YYYY-MM-DD.tar.gz` first, then delete them with bash (not zsh globs); tear worktrees down with the done checklist in `CLAUDE.md`; fix the stale task-log statuses. Record what went in the retro's Cleanup section.

One closing line.

Outside step 5, never touch task folders, `task-log.md` or target repos during a retro.
