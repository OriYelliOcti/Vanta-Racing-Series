#!/usr/bin/env python3
"""Copy the VRS bot's budgets into data/budget.json so the site can show them.

The bot owns the money (budgets.json next to bot.py). The site only reads, so this
script copies the numbers over; run it after signings, optionally with --push.

  python tools/export_budget.py            # local copy if the bot folder is here
  python tools/export_budget.py --push     # also commit and push to main
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "data", "budget.json")
LOCAL = os.path.join(os.path.dirname(ROOT), "vanta-bot", "budgets.json")
HOST = os.getenv("VRS_LAPTOP", "oriyelliocti@192.168.51.234")
REMOTE = "~/vanta-bot/budgets.json"


def read_budgets() -> dict:
    if os.path.exists(LOCAL):
        with open(LOCAL, encoding="utf-8") as handle:
            return json.load(handle)
    result = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", HOST, "cat", REMOTE],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise SystemExit("cannot read the budgets: " + result.stderr.strip())
    return json.loads(result.stdout)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--push", action="store_true", help="commit and push the file")
    args = parser.parse_args()

    source = read_budgets()
    teams = {}
    for key, entry in (source.get("teams") or {}).items():
        teams[key] = {
            "name": entry.get("name", key),
            "division": entry.get("division", ""),
            "budget": int(entry.get("budget", 0)),
            "spent": int(entry.get("spent", 0)),
        }
    document = {
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "teams": teams,
    }
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(document, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    print("wrote %s — %d teams" % (OUT, len(teams)))

    if args.push:
        for command in (
            ["git", "add", "data/budget.json"],
            ["git", "commit", "-m", "Budgets from the bot (%s)" % document["updatedAt"]],
            ["git", "push", "origin", "main"],
        ):
            done = subprocess.run(["git", "-C", ROOT, *command], capture_output=True, text=True)
            if done.returncode != 0:
                print(done.stderr.strip() or done.stdout.strip(), file=sys.stderr)
                return 1
        print("pushed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
