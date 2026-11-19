#!/usr/bin/env python3
"""VRS FIA desk bridge — loopback only, password (or token) instead of a login.

The FIA desk publishes race results and steward decisions straight from the
browser. This small server is the writer: it runs on the steward's own laptop,
checks the access secret, updates the JSON files, commits and pushes to main
with the machine's own Git credential.

  python tools/desk_server.py
  # desk: http://127.0.0.1:8787/stewards.html#vrs-FIA

Access can be either the FIA password (default VRSFIA+) or the GitHub token in
"github token.txt" next to the repository, so a pasted token also works. No
GitHub token is ever stored in the repository, and the push does not need one:
it uses the credential Git already has on this laptop.

  GET  /health              -> {"ok": true, "owner": "...", "dryRun": false,
                              "acceptsToken": true}
  POST /unlock   {password} -> {"ok": true, "owner": "..."} | 401
  POST /publish  {password, kind: "decision", entry: {...}}
  POST /publish  {password, kind: "result",
                  entry: {round, division, rows: [{pos, driver, team,
                           fastestLap?, pole?, note?}]}}
                            -> {"ok": true, "commit": "<sha>", "owner": "...",
                                "decision"|"result": {...}, "audit": {...}}

The socket is bound to 127.0.0.1, so the desk only writes from this machine.
"""

from __future__ import annotations

import argparse
import hmac
import json
import os
import re
import subprocess
import sys
import threading
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
DECISIONS = os.path.join(DATA, "decisions.json")
RESULTS = os.path.join(DATA, "results.json")
SCHEDULE = os.path.join(DATA, "schedule.json")
LINEUPS = os.path.join(DATA, "lineups.json")
CONFIG = os.path.join(DATA, "config.json")
DEFAULT_PASSWORD = "VRSFIA+"
DEFAULT_TOKEN_FILE = os.path.join(os.path.dirname(ROOT), "github token.txt")
DEFAULT_PORT = 8787
MAX_BODY = 400_000
TYPES = {"decision", "penalty", "investigation", "clip"}
PAGES_ORIGIN = "https://oriyelliocti.github.io"
BRANCH = "main"
LOCK = threading.Lock()


def git(*args: str, timeout: int = 120) -> subprocess.CompletedProcess:
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    return subprocess.run(
        ["git", "-C", ROOT, *args],
        capture_output=True,
        text=True,
        timeout=timeout,
        env=env,
    )


def owner() -> str:
    name = os.getenv("DESK_NAME", "").strip()
    if name:
        return name[:80]
    try:
        result = git("config", "user.name")
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()[:80]
    except Exception:  # noqa: BLE001 - a missing name is not fatal
        pass
    return "FIA Steward"


def token_from_file(path: str) -> str:
    try:
        raw = open(path, encoding="utf-8", errors="ignore").read()
    except OSError:
        return ""
    match = re.search(r"(github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9]{20,})", raw)
    return match.group(0) if match else ""


def read_json(path: str) -> dict:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: str, document: dict) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(document, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def restore(paths: list[str]) -> None:
    git("restore", "--source=HEAD", "--staged", "--worktree", "--", *paths)


def undo(paths: list[str]) -> None:
    """Drop the commit we just made and put the working tree back."""
    git("reset", "--soft", "HEAD~1")
    restore(paths)


def commit_with(message: str) -> subprocess.CompletedProcess:
    """Commit, supplying an identity only when the repository has none."""
    email = git("config", "user.email").stdout.strip()
    name = git("config", "user.name").stdout.strip()
    args = ["commit", "-m", message]
    if not email or not name:
        args = [
            "-c",
            "user.name=" + (name or "FIA Steward"),
            "-c",
            "user.email=" + (email or "fia@vanta-racing.invalid"),
            *args,
        ]
    return git(*args)


def commit_and_push(paths: list[str], message: str) -> str:
    for path in paths:
        staged = git("add", path)
        if staged.returncode != 0:
            restore(paths)
            raise RuntimeError(staged.stderr.strip() or "git add failed")
    committed = commit_with(message)
    if committed.returncode != 0:
        restore(paths)
        raise RuntimeError(committed.stderr.strip() or "git commit failed")
    sha = git("rev-parse", "HEAD").stdout.strip()
    pushed = git("push", "origin", BRANCH, timeout=180)
    if pushed.returncode != 0:
        undo(paths)
        raise RuntimeError(
            pushed.stderr.strip() or pushed.stdout.strip() or "git push failed"
        )
    return sha


def problem_decision(entry: object) -> str:
    if not isinstance(entry, dict):
        return "entry must be an object"
    try:
        number = int(entry.get("round"))
    except (TypeError, ValueError):
        return "round must be a number"
    if not 1 <= number <= 99:
        return "round must be between 1 and 99"
    if entry.get("type") not in TYPES:
        return "type must be one of " + ", ".join(sorted(TYPES))
    subject = entry.get("subject", "")
    text = entry.get("text", "")
    clip = entry.get("clip", "")
    if not isinstance(subject, str) or len(subject) > 120:
        return "subject must be text of at most 120 characters"
    if not isinstance(text, str) or not text.strip():
        return "the ruling cannot be empty"
    if len(text) > 4000:
        return "the ruling is too long (max 4000 characters)"
    if clip and not (isinstance(clip, str) and clip.startswith(("http://", "https://"))):
        return "clip must be an http(s) URL"
    return ""


def divisions() -> list[str]:
    try:
        return list(read_json(CONFIG).get("divisions") or ["F1", "F2"])
    except Exception:  # noqa: BLE001 - fall back to the league default
        return ["F1", "F2"]


def known_teams(division: str) -> set[str]:
    try:
        lineups = read_json(LINEUPS)
    except Exception:  # noqa: BLE001 - no lineups means no team check
        return set()
    return {
        team.get("key", "")
        for team in lineups.get("teams", [])
        if team.get("division") == division
    }


def problem_result(number: int, division: object, rows: object) -> str:
    if division not in divisions():
        return "division must be one of " + ", ".join(divisions())
    if not isinstance(rows, list) or not 1 <= len(rows) <= 40:
        return "a result needs between 1 and 40 rows"
    teams = known_teams(str(division))
    positions: set[int] = set()
    drivers: set[str] = set()
    fastest = 0
    poles = 0
    for row in rows:
        if not isinstance(row, dict):
            return "every row must be an object"
        position = row.get("pos")
        if not isinstance(position, int) or not 1 <= position <= 40:
            return "every row needs a position between 1 and 40"
        if position in positions:
            return "position %d appears twice" % position
        positions.add(position)
        driver = str(row.get("driver") or "").strip()
        if not driver or len(driver) > 80:
            return "every row needs a driver name (max 80 characters)"
        if driver.lower() in drivers:
            return "%s appears twice" % driver
        drivers.add(driver.lower())
        team = str(row.get("team") or "").strip()
        if teams and team not in teams:
            return "unknown %s team: %s" % (division, team or "(none)")
        note = str(row.get("note") or "")
        if len(note) > 80:
            return "notes are limited to 80 characters"
        if row.get("fastestLap"):
            fastest += 1
        if row.get("pole"):
            poles += 1
    if sorted(positions) != list(range(1, len(rows) + 1)):
        return "positions must run from 1 to %d without gaps" % len(rows)
    if fastest > 1:
        return "only one row can have the fastest lap"
    if poles > 1:
        return "only one row can have pole"
    if number not in range(1, 100):
        return "round must be between 1 and 99"
    return ""


def clean_rows(rows: list[dict]) -> list[dict]:
    cleaned = []
    for row in sorted(rows, key=lambda item: int(item["pos"])):
        item = {
            "pos": int(row["pos"]),
            "driver": str(row["driver"]).strip(),
            "team": str(row["team"]).strip(),
        }
        if row.get("fastestLap"):
            item["fastestLap"] = True
        if row.get("pole"):
            item["pole"] = True
        note = str(row.get("note") or "").strip()
        if note:
            item["note"] = note
        cleaned.append(item)
    return cleaned


def publish_decision(entry: dict, who: str, dry_run: bool) -> dict:
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    decision = {
        "round": int(entry["round"]),
        "type": entry["type"],
        "subject": str(entry.get("subject") or "").strip(),
        "text": str(entry["text"]).strip(),
        "clip": str(entry.get("clip") or "").strip(),
        "by": who,
        "publishedAt": now,
    }
    audit = {
        "at": now,
        "actor": who,
        "action": "publish " + decision["type"],
        "target": "R%d %s" % (decision["round"], decision["subject"] or "—"),
    }

    with LOCK:
        document = read_json(DECISIONS)
        document.setdefault("decisions", []).append(decision)
        document.setdefault("audit", []).append(audit)

        if dry_run:
            return {
                "ok": True,
                "dryRun": True,
                "commit": "dry-run",
                "owner": who,
                "decision": decision,
                "audit": audit,
            }

        write_json(DECISIONS, document)
        try:
            sha = commit_and_push(
                ["data/decisions.json"],
                "Publish decision: R%d %s"
                % (decision["round"], decision["subject"] or decision["type"]),
            )
        except Exception:
            restore(["data/decisions.json"])
            raise

    return {
        "ok": True,
        "dryRun": False,
        "commit": sha,
        "owner": who,
        "decision": decision,
        "audit": audit,
    }


def publish_result(number: int, division: str, rows: list[dict], who: str, dry_run: bool) -> dict:
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rows = clean_rows(rows)

    schedule = read_json(SCHEDULE)
    circuit = next(
        (
            round_.get("circuit", "")
            for round_ in schedule.get("rounds", [])
            if int(round_.get("round", 0)) == number
        ),
        "",
    )
    name = circuit or "Round %d" % number

    results = read_json(RESULTS)
    rounds = results.setdefault("rounds", [])
    target = next((item for item in rounds if int(item.get("round", 0)) == number), None)
    if target is None:
        target = {"round": number, "name": name, "divisions": {}}
        rounds.append(target)
    target["name"] = name
    target.pop("demo", None)
    target.setdefault("divisions", {})[division] = rows
    rounds.sort(key=lambda item: int(item.get("round", 0)))
    results["rounds"] = rounds

    audit = {
        "at": now,
        "actor": who,
        "action": "publish %s result" % division,
        "target": "R%d %s" % (number, name),
    }
    payload = {"round": number, "name": name, "division": division, "rows": rows}

    with LOCK:
        if dry_run:
            return {
                "ok": True,
                "dryRun": True,
                "commit": "dry-run",
                "owner": who,
                "result": payload,
                "audit": audit,
            }

        write_json(RESULTS, results)
        decisions = read_json(DECISIONS)
        decisions.setdefault("audit", []).append(audit)
        write_json(DECISIONS, decisions)

        try:
            sha = commit_and_push(
                ["data/results.json", "data/decisions.json"],
                "Publish R%d %s result: %s" % (number, division, name),
            )
        except Exception:
            restore(["data/results.json", "data/decisions.json"])
            raise

    return {
        "ok": True,
        "dryRun": False,
        "commit": sha,
        "owner": who,
        "result": payload,
        "audit": audit,
    }


class Handler(SimpleHTTPRequestHandler):
    server_version = "VRSdesk/1.1"
    password = DEFAULT_PASSWORD
    token = ""
    dry_run = False

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    def allowed_origin(self) -> str:
        origin = self.headers.get("Origin") or ""
        if origin == PAGES_ORIGIN:
            return origin
        if origin.startswith(("http://127.0.0.1:", "http://localhost:")):
            return origin
        return ""

    def end_headers(self):
        origin = self.allowed_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        super().end_headers()

    def reply(self, status: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def send_head(self):
        # Never serve .git or any other dotfile from the site root.
        path = self.path.split("?", 1)[0]
        if any(part.startswith(".") for part in path.split("/") if part):
            self.send_error(404)
            return None
        return super().send_head()

    def do_GET(self):
        path = self.path.split("?", 1)[0].rstrip("/")
        if path == "/health":
            self.reply(
                200,
                {
                    "ok": True,
                    "name": "VRS FIA desk",
                    "owner": owner(),
                    "dryRun": self.dry_run,
                    "acceptsToken": bool(self.token),
                },
            )
            return
        super().do_GET()

    def body_payload(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            return None
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:  # noqa: BLE001 - reported to the caller
            return None

    def unlocked(self, payload: dict) -> bool:
        secret = str(payload.get("password") or "").strip()
        if not secret:
            return False
        if hmac.compare_digest(secret, self.password):
            return True
        if self.token and hmac.compare_digest(secret, self.token):
            return True
        return False

    def do_POST(self):
        path = self.path.split("?", 1)[0].rstrip("/")
        if path not in ("/unlock", "/publish"):
            self.reply(404, {"ok": False, "problem": "unknown path"})
            return

        payload = self.body_payload()
        if payload is None:
            self.reply(400, {"ok": False, "problem": "invalid JSON body"})
            return
        if not self.unlocked(payload):
            self.reply(
                401,
                {
                    "ok": False,
                    "problem": "wrong password"
                    if not self.token
                    else "wrong password or token",
                },
            )
            return

        if path == "/unlock":
            self.reply(
                200,
                {
                    "ok": True,
                    "owner": owner(),
                    "dryRun": self.dry_run,
                    "acceptsToken": bool(self.token),
                },
            )
            return

        kind = payload.get("kind")
        try:
            if kind == "decision":
                entry = payload.get("entry")
                why = problem_decision(entry)
                if why:
                    self.reply(400, {"ok": False, "problem": why})
                    return
                answer = publish_decision(entry, owner(), self.dry_run)
            elif kind == "result":
                entry = payload.get("entry") or {}
                try:
                    number = int(entry.get("round"))
                except (TypeError, ValueError):
                    self.reply(400, {"ok": False, "problem": "round must be a number"})
                    return
                why = problem_result(number, entry.get("division"), entry.get("rows"))
                if why:
                    self.reply(400, {"ok": False, "problem": why})
                    return
                answer = publish_result(
                    number, entry["division"], entry["rows"], owner(), self.dry_run
                )
            else:
                self.reply(400, {"ok": False, "problem": "unknown kind"})
                return
        except Exception as error:  # noqa: BLE001 - the desk shows the reason
            self.reply(502, {"ok": False, "problem": "%s: %s" % (type(error).__name__, error)})
            return
        self.reply(200, answer)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument(
        "--password",
        default=os.getenv("VRS_DESK_PASSWORD", DEFAULT_PASSWORD),
        help="desk access password (default: VRSFIA+)",
    )
    parser.add_argument(
        "--token-file",
        default=os.getenv("VRS_DESK_TOKEN_FILE", DEFAULT_TOKEN_FILE),
        help="file whose GitHub token is also accepted as the access secret",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="validate and answer, but never write, commit or push",
    )
    parser.add_argument(
        "--log-file",
        default=os.getenv("VRS_DESK_LOG", ""),
        help="append the bridge's output to this file (used by the autostart)",
    )
    args = parser.parse_args()

    if args.log_file:
        log_path = (
            args.log_file
            if os.path.isabs(args.log_file)
            else os.path.join(ROOT, args.log_file)
        )
        os.makedirs(os.path.dirname(log_path) or ROOT, exist_ok=True)
        log_handle = open(log_path, "a", encoding="utf-8", buffering=1)
        sys.stdout = sys.stderr = log_handle
        print("\n--- %s ---" % datetime.now().strftime("%Y-%m-%d %H:%M:%S"))

    Handler.password = args.password
    Handler.token = token_from_file(args.token_file)
    Handler.dry_run = args.dry_run

    try:
        server = ThreadingHTTPServer(
            (args.host, args.port), partial(Handler, directory=ROOT)
        )
    except OSError as error:
        print("Cannot bind %s:%d - %s" % (args.host, args.port, error))
        print("Another desk bridge is already running; stop it first.")
        return 1

    print("VRS FIA desk on http://%s:%d/stewards.html#vrs-FIA" % (args.host, args.port))
    print("Serving %s" % ROOT)
    print(
        "Publishing commits and pushes to origin/%s with this laptop's Git credential."
        % BRANCH
    )
    print(
        "Token login: %s"
        % ("enabled from " + args.token_file if Handler.token else "disabled")
    )
    if args.dry_run:
        print("Dry run: nothing will be written, committed or pushed.")
    print("Stop with Ctrl+C.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopping...")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
