#!/usr/bin/env python3
"""Sync VRS lineups from Discord roles into data/lineups.json.

Run it on the machine that holds the bot token, every five hours:

    */5 * * * * cd ~/vrs-site && ~/vanta-bot/.venv/bin/python tools/sync_lineups.py --push

Team membership comes from the team role (McLaren, Ferrari, ...), the slot comes
from the staff role (Team Boss, Team Principal, FIA, Driver, Reserve, Pit Crew,
Engineer). Nothing is invented: a seat is filled only if a member carries both
the team role and the slot role.
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

API = "https://discord.com/api/v10"
GUILD_ID = os.getenv("VRS_GUILD_ID", "1567277556661616770")
TOKEN_FILE = os.getenv("VRS_TOKEN_FILE", os.path.expanduser("~/vrs-token.txt"))
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")

TEAMS = [
    ("mclaren", "McLaren", "F1"), ("ferrari", "Ferrari", "F1"),
    ("red_bull_racing", "Red Bull Racing", "F1"), ("mercedes", "Mercedes", "F1"),
    ("aston_martin", "Aston Martin", "F1"), ("alpine", "Alpine", "F1"),
    ("williams", "Williams", "F1"), ("haas", "Haas", "F1"),
    ("racing_bulls", "Racing Bulls", "F1"), ("audi", "Audi", "F1"),
    ("cadillac", "Cadillac", "F1"), ("prema", "Prema Racing", "F2"),
    ("art_grand_prix", "ART Grand Prix", "F2"), ("campos", "Campos Racing", "F2"),
    ("dams", "DAMS", "F2"), ("hitech", "Hitech", "F2"),
    ("mp_motorsport", "MP Motorsport", "F2"), ("trident", "Trident", "F2"),
    ("rodin", "Rodin Motorsport", "F2"), ("van_amersfoort", "Van Amersfoort", "F2"),
    ("aix", "AIX Racing", "F2"),
]

SLOTS = [
    ("boss", "Team Boss"), ("principal", "Team Principal"), ("fia", "FIA"),
    ("driver", "Driver"), ("reserve", "Reserve"), ("crew", "Pit Crew"),
    ("engineer", "Engineer"),
]


def token():
    try:
        raw = open(TOKEN_FILE, encoding="utf-8", errors="ignore").read()
    except FileNotFoundError:
        sys.exit(f"token file not found: {TOKEN_FILE}")
    match = re.search(r"[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{25,40}", raw)
    if not match:
        sys.exit("no bot token in the token file")
    return match.group(0)


def call(path, method="GET", body=None, key=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        API + path, data=data, method=method,
        headers={
            "Authorization": "Bot " + (key or token()),
            "User-Agent": "VRS-Sync (1.0)",
            "Content-Type": "application/json",
        },
    )
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=25) as response:
                raw = response.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            if error.code == 429:
                time.sleep(float(json.loads(error.read() or "{}").get("retry_after", 2)))
                continue
            sys.exit(f"{path} -> HTTP {error.code}: {error.read()[:200]}")
    sys.exit(f"{path} -> gave up (rate limited)")


def role_id(roles, suffix):
    suffix = suffix.lower()
    for role in roles:
        if role["name"].lower().endswith(suffix):
            return role["id"], role["name"]
    return None, None


def members():
    out, after = [], "0"
    while True:
        page = call(f"/guilds/{GUILD_ID}/members?limit=1000&after={after}") or []
        out.extend(page)
        if len(page) < 1000:
            return out
        after = page[-1]["user"]["id"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--push", action="store_true", help="POST the result to the bridge")
    parser.add_argument("--bridge", default=os.getenv("VRS_BRIDGE", "http://127.0.0.1:8787"))
    args = parser.parse_args()

    roles = call(f"/guilds/{GUILD_ID}/roles") or []
    people = members()
    print(f"{len(roles)} roles, {len(people)} members")

    slot_roles = {}
    for key, label in SLOTS:
        rid, name = role_id(roles, label)
        if rid:
            slot_roles[key] = {"id": rid, "label": name}

    teams = []
    for team_key, team_name, division in TEAMS:
        team_role, team_role_name = role_id(roles, team_name)
        entry = {
            "key": team_key,
            "name": team_name,
            "division": division,
            "roleId": team_role,
            "roleName": team_role_name,
            "slots": {},
        }
        for slot_key, slot_label in SLOTS:
            info = slot_roles.get(slot_key, {})
            entry["slots"][slot_key] = {
                "roleId": info.get("id"),
                "label": info.get("label", slot_label),
                "members": [],
            }
        if team_role:
            for person in people:
                if team_role not in person.get("roles", []):
                    continue
                user = person.get("user", {})
                display = person.get("nick") or user.get("global_name") or user.get("username") or "unknown"
                for slot_key, slot_label in SLOTS:
                    rid = slot_roles.get(slot_key, {}).get("id")
                    if rid and rid in person.get("roles", []):
                        entry["slots"][slot_key]["members"].append(
                            {"id": user.get("id"), "name": display}
                        )
        teams.append(entry)

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "discord-roles",
        "guildId": GUILD_ID,
        "teams": teams,
    }

    os.makedirs(DATA, exist_ok=True)
    path = os.path.join(DATA, "lineups.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
    filled = sum(len(s["members"]) for t in teams for s in t["slots"].values())
    print(f"wrote {path} — {len(teams)} teams, {filled} filled seats")

    if args.push:
        request = urllib.request.Request(
            args.bridge.rstrip("/") + "/publish",
            data=json.dumps({"kind": "lineups", "lineups": payload}).encode(),
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer " + os.getenv("VRS_BRIDGE_TOKEN", ""),
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                print("bridge:", response.status, response.read()[:200].decode("utf-8", "replace"))
        except Exception as error:  # noqa: BLE001 - reported, not raised
            print("bridge push failed:", error)


if __name__ == "__main__":
    main()
