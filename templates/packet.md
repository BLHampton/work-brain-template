<!-- packet.md · dispatcher · must fit on one screen; if the manager has to open the diff to understand it, log that in misses.md -->
# <card> — <title>
Lane: <quick | standard> | Review rounds: <n> | Attempts: <n>

## Criteria → proof
- <criterion 1> → <test name> (PASS)
- <criterion 2> → <test name> (PASS)

## What changed
<3–5 lines: files and why>

## Review: top findings
- [<score>] <finding> → fixed in <file>
- [<score>] <finding> → rebutted: <one line>

## LOOK
<!-- prod API/contract/schema/migration · new or changed UI · auth/permissions/secrets/payments · files outside the plan's list · gate dispute · diff > ~300 lines · an 8+ finding rebutted
     "new or changed UI" lists the changed states and a rendered screenshot of the real component per state, `research/after/<state>.png`; a UI packet without them is not raised -->
<flags, or "none">

## Unusual
<anything a reviewer would want to know, or "none">

## Ship
<!-- exact commands, one line (two -m flags, never a blank line inside -m); Approve on the ship approval is the go for these and nothing more -->
```
git -C <repo> add -A && git -C <repo> commit -m "<type>: <description>" -m "For those who come after" && git -C <repo> push -u origin <branch>
```
