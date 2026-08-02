#!/usr/bin/env python3
"""Review server for ticket 085 — Python stdlib only, loopback only.

Serves one page and three endpoints. Notes append to notes.jsonl and are
never rewritten: an append-only log of the reviewer's verbatim judgment is
the only ground truth the open-coding pass gets to read.

Run: python3 tools/claim-review/server.py
"""

import json
import os
import sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, "app.html")
DATASET = os.path.join(HERE, "dataset.json")
NOTES = os.path.join(HERE, "notes.jsonl")

HOST = "127.0.0.1"
PORT = 8787


def read_notes():
    """Every line ever appended, bad lines skipped rather than repaired."""
    if not os.path.exists(NOTES):
        return []
    out = []
    with open(NOTES, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, content_type):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj), "application/json; charset=utf-8")

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/":
            try:
                with open(APP, "r", encoding="utf-8") as fh:
                    self._send(200, fh.read(), "text/html; charset=utf-8")
            except OSError as exc:
                self._send(500, f"cannot read app.html: {exc}", "text/plain; charset=utf-8")
        elif path == "/api/dataset":
            try:
                with open(DATASET, "r", encoding="utf-8") as fh:
                    self._send(200, fh.read(), "application/json; charset=utf-8")
            except OSError:
                self._json(500, {"error": "dataset.json missing — run export-dataset.ts"})
        elif path == "/api/notes":
            self._json(200, read_notes())
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path.split("?")[0] != "/api/notes":
            self._json(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, json.JSONDecodeError) as exc:
            self._json(400, {"error": f"bad request: {exc}"})
            return

        claim = payload.get("claim")
        if not claim:
            self._json(400, {"error": "claim id required"})
            return

        entry = {
            "claim": claim,
            "note": payload.get("note", ""),
            "skipped": bool(payload.get("skipped", False)),
            "position": payload.get("position"),
            "at": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        }
        with open(NOTES, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
            fh.flush()
            os.fsync(fh.fileno())
        self._json(200, {"ok": True, "at": entry["at"], "total": len(read_notes())})

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"claim review on http://{HOST}:{PORT}", flush=True)
    server.serve_forever()
