#!/usr/bin/env python3
"""VRS FIA desk bridge — loopback only, password instead of a token.

The stewarding desk is part of the public site, but publishing a decision needs
a writer. This small server is that writer: it runs on the steward's own laptop,
checks the FIA access password, appends the decision to data/decisions.json,
commits it and pushes to main with the machine's own Git credential.

  python tools/desk_server.py
  # desk: http://127.0.0.1:8787/stewards.html#vrs-FIA

No GitHub token is ever typed into the page and none is stored in the
repository: the push uses the credential Git already has on this laptop.

  GET  /health              -> {"ok": true, "owner": "...", "dryRun": false}
  POST /unlock   {password} -> {"ok": true, "owner": "..."} | 401
  POST /publish  {password, kind: "decision", entry: {...}}
                            -> {"ok": true, "commit": "<sha>", "decision": {...},
                                "audit": {...}}

Both POSTs are refused without the password. The socket is bound to 127.0.0.1,
so the desk only writes from this machine.
"""

from __future__ import annotations

import argparse
import hmac
import json
import os
import subprocess
import sys
import threading
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DECISIONS = os.path.join(ROOT, "data", "decisions.json")
DEFAULT_PASSWORD = "VRSFIA+"
DEFAULT_PORT = 8787
MAX_BODY = 200_000
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


def problem(entry: object) -> str:
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


def read_decisions() -> dict:
    with open(DECISIONS, encoding="utf-8") as handle:
        return json.load(handle)


def write_decisions(document: dict) -> None:
    with open(DECISIONS, "w", encoding="utf-8") as handle:
        json.dump(document, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def publish(entry: dict, who: str, dry_run: bool) -> dict:
    """Append the decision, commit and push. Undo the commit if the push fails."""
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
        document = read_decisions()
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

        write_decisions(document)
        staged = git("add", "data/decisions.json")
        if staged.returncode != 0:
            git("restore", "--source=HEAD", "--", "data/decisions.json")
            raise RuntimeError(staged.stderr.strip() or "git add failed")

        message = "Publish decision: R%d %s" % (
            decision["round"],
            decision["subject"] or decision["type"],
        )
        committed = git("commit", "-m", message)
        if committed.returncode != 0:
            git("restore", "--source=HEAD", "--", "data/decisions.json")
            raise RuntimeError(committed.stderr.strip() or "git commit failed")

        sha = git("rev-parse", "HEAD").stdout.strip()
        pushed = git("push", "origin", BRANCH, timeout=180)
        if pushed.returncode != 0:
            # Keep the repository exactly as it was before this publish.
            git("reset", "--hard", "HEAD~1")
            raise RuntimeError(
                pushed.stderr.strip() or pushed.stdout.strip() or "git push failed"
            )

    return {
        "ok": True,
        "dryRun": False,
        "commit": sha,
        "owner": who,
        "decision": decision,
        "audit": audit,
    }


class Handler(SimpleHTTPRequestHandler):
    server_version = "VRSdesk/1.0"
    password = DEFAULT_PASSWORD
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
                },
            )
            return
        super().do_GET()

    def body(self):
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
        password = str(payload.get("password") or "")
        return hmac.compare_digest(password, self.password)

    def do_POST(self):
        path = self.path.split("?", 1)[0].rstrip("/")
        if path not in ("/unlock", "/publish"):
            self.reply(404, {"ok": False, "problem": "unknown path"})
            return

        payload = self.body()
        if payload is None:
            self.reply(400, {"ok": False, "problem": "invalid JSON body"})
            return
        if not self.unlocked(payload):
            self.reply(401, {"ok": False, "problem": "wrong access password"})
            return

        if path == "/unlock":
            self.reply(200, {"ok": True, "owner": owner(), "dryRun": self.dry_run})
            return

        if payload.get("kind") != "decision":
            self.reply(400, {"ok": False, "problem": "only decisions can be published"})
            return
        entry = payload.get("entry")
        why = problem(entry)
        if why:
            self.reply(400, {"ok": False, "problem": why})
            return

        try:
            answer = publish(entry, owner(), self.dry_run)
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
        "--dry-run",
        action="store_true",
        help="validate and answer, but never write, commit or push",
    )
    args = parser.parse_args()

    Handler.password = args.password
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
    print("Publishing commits and pushes to origin/%s with this laptop's Git credential." % BRANCH)
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
