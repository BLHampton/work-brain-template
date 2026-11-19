#!/usr/bin/env python3
"""Stop hook: copy a lead's reply onto its card's chat thread.

Runs only in a lead's session, where herdr set CARD=tasks/<folder>. Appends
`- YYYY-MM-DD HH:MM — lead: <last assistant text>` to
$CLAUDE_PROJECT_DIR/<CARD>/threads/card.md, the line format of appendLine in
ui/thread-lib.js. It never fails the session: any problem exits 0 quietly.
"""
import datetime
import json
import os
import re
import sys

sys.dont_write_bytecode = True  # no __pycache__ beside the hooks
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ask_guard import last_assistant_text  # noqa: E402

CARD = re.compile(r"^tasks/\d{4}-\d{2}-\d{2}-[a-z0-9-]+$")
BREAKS = re.compile(r"\s*[\r\n\u2028\u2029]+\s*")


def card_title(folder):
    try:
        with open(os.path.join(folder, "card.json"), encoding="utf-8") as f:
            title = json.load(f).get("title")
        return title if isinstance(title, str) and title.strip() else os.path.basename(folder)
    except (OSError, ValueError, AttributeError):
        return os.path.basename(folder)


def main():
    card = os.environ.get("CARD", "")
    if not CARD.match(card):
        return 0
    data = json.load(sys.stdin)
    text = BREAKS.sub(" ", last_assistant_text(data)).strip()
    if not text:
        return 0
    folder = os.path.join(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd(), card)
    if not os.path.isdir(folder):
        return 0
    thread = os.path.join(folder, "threads", "card.md")
    header = "" if os.path.exists(thread) else f"# Thread · {card_title(folder)}\n\n"
    os.makedirs(os.path.dirname(thread), exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    with open(thread, "a", encoding="utf-8") as f:
        f.write(f"{header}- {stamp} — lead: {text}\n")
    return 0


if __name__ == "__main__":
    try:
        main()
    except Exception:  # a broken hook must never stop the lead
        pass
    sys.exit(0)
