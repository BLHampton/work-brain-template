#!/usr/bin/env python3
"""Stop hook: catch questions for the manager left in chat instead of on a card.

If the main session's last message ends with a question, block the stop once
and tell it to move the question to the card's question.md and a question on its card.
It never blocks twice in a row (stop_hook_active), so a false positive costs
one short extra turn.

Disable for a live, interactive session by launching with ASK_GUARD=off.
A card's lead (CARD set) may end on a question: The manager reads its replies on the card.
"""
import json
import os
import re
import sys

REASON = (
    "Your last message ends with a question. The manager does not read this chat "
    "during runs, so questions here get lost. If it is a question for them: "
    "write tasks/<folder>/question.md from templates/question.md, then run "
    "`bin/card ask tasks/<folder> --from question.md` to put it on the card, "
    "then move on to the next card or end the turn. If it was not "
    "a question for the manager, just end your turn."
)


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            block.get("text", "")
            for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        )
    return ""


def last_assistant_text(data):
    direct = data.get("last_assistant_message")
    if isinstance(direct, str) and direct.strip():
        return direct

    path = data.get("transcript_path")
    if not path or not os.path.exists(path):
        return ""

    last = ""
    with open(path, encoding="utf-8") as f:
        for line in f:
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if entry.get("type") != "assistant":
                continue
            text = text_of((entry.get("message") or {}).get("content"))
            if text.strip():
                last = text
    return last


def ends_with_question(text):
    text = re.sub(r"```.*?```", "", text, flags=re.S)  # ignore code blocks
    lines = [line.strip() for line in text.strip().splitlines() if line.strip()]
    return any(line.rstrip("*_ ").endswith("?") for line in lines[-6:])


def main():
    if os.environ.get("CARD"):
        return 0
    if os.environ.get("ASK_GUARD", "").lower() == "off":
        return 0
    try:
        data = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0
    if data.get("stop_hook_active"):
        return 0
    if ends_with_question(last_assistant_text(data)):
        print(json.dumps({"decision": "block", "reason": REASON}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
