"""Integration test for totzillad against tests/sftp_test_server.py.

Usage: python daemon/tests/test_rpc.py PATH_TO_TOTZILLAD --port 3373 --password test --root SFTP_ROOT

Copyright (C) TOTzilla contributors
SPDX-License-Identifier: GPL-3.0-or-later
"""

import argparse
import filecmp
import json
import os
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import time


class Daemon:
    def __init__(self, exe):
        self.proc = subprocess.Popen(
            [exe], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=sys.stderr,
            text=True, encoding="utf-8", bufsize=1,
        )
        self.messages = queue.Queue()
        self.events = []
        self.next_id = 1
        self.hostkeys = []
        self.file_exists_action = None
        self.file_exists_requests = []
        # type -> function(params) returning the reply fields; seen requests by type.
        self.answers = {}
        self.seen = {}
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        for line in self.proc.stdout:
            line = line.strip()
            if line:
                self.messages.put(json.loads(line))
        self.messages.put(None)

    def send_raw(self, line):
        self.proc.stdin.write(line + "\n")
        self.proc.stdin.flush()

    def _handle_event(self, msg):
        self.events.append(msg)
        method, params = msg["method"], msg.get("params", {})
        if method == "log":
            print(f"  [{params['level']}] {params['message']}")
        elif method == "request":
            print(f"  request: {params}")
            self.seen.setdefault(params["type"], []).append(params)
            if params["type"] in self.answers:
                reply = self.answers[params["type"]](params)
                self.notify("request.reply", {"session": params["session"], "request": params["request"], **reply})
            elif params["type"] == "hostkey":
                self.hostkeys.append(params["fingerprint"])
                self.notify("request.reply", {"session": params["session"], "request": params["request"], "trust": True})
            elif params["type"] == "file_exists" and self.file_exists_action:
                self.file_exists_requests.append(params)
                self.notify("request.reply", {"session": params["session"], "request": params["request"],
                                              "action": self.file_exists_action})
            else:
                raise AssertionError(f"unexpected request {params}")
        elif method == "transfer.progress":
            pass
        else:
            print(f"  event: {method} {params}")

    def notify(self, method, params):
        req_id = self.next_id
        self.next_id += 1
        self.send_raw(json.dumps({"jsonrpc": "2.0", "id": req_id, "method": method, "params": params}))
        self.pending_replies = getattr(self, "pending_replies", set()) | {req_id}

    def wait_response(self, req_id, timeout=60):
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise AssertionError(f"timeout waiting for response {req_id}")
            msg = self.messages.get(timeout=remaining)
            if msg is None:
                raise AssertionError("daemon closed stdout")
            if "method" in msg:
                self._handle_event(msg)
                continue
            if msg.get("id") == req_id:
                return msg
            replies = getattr(self, "pending_replies", set())
            if msg.get("id") in replies:
                assert "result" in msg, f"request.reply failed: {msg}"
                replies.discard(msg["id"])
                continue
            raise AssertionError(f"unexpected message {msg}")

    def call(self, method, params=None):
        req_id = self.next_id
        self.next_id += 1
        print(f"> {method} {params or {}}")
        self.send_raw(json.dumps({"jsonrpc": "2.0", "id": req_id, "method": method, "params": params or {}}))
        return self.wait_response(req_id)

    def ok(self, method, params=None):
        msg = self.call(method, params)
        assert "result" in msg, f"{method} failed: {msg}"
        return msg["result"]

    def error(self, method, params, code):
        msg = self.call(method, params)
        assert "error" in msg, f"{method} unexpectedly succeeded: {msg}"
        assert msg["error"]["code"] == code, f"{method}: expected {code}, got {msg['error']}"
        return msg["error"]

    def wait_event(self, method, timeout=30):
        deadline = time.monotonic() + timeout
        while not any(e["method"] == method for e in self.events):
            msg = self.messages.get(timeout=max(0.1, deadline - time.monotonic()))
            if msg is None:
                raise AssertionError("daemon closed stdout")
            if "method" in msg:
                self._handle_event(msg)
            if time.monotonic() > deadline:
                raise AssertionError(f"timeout waiting for event {method}")


def names(listing):
    return {e["name"]: e for e in listing["entries"]}


def progress_for(d, req_id):
    return [e["params"] for e in d.events
            if e["method"] == "transfer.progress" and e["params"]["id"] == req_id]


def transfers(d, sid, root):
    work = tempfile.mkdtemp(prefix="totzillad-test-")
    local = os.path.join(work, "big.bin")
    size = 32 * 1024 * 1024
    with open(local, "wb") as f:
        f.write(os.urandom(size))

    # Upload with progress.
    req_id = d.next_id
    res = d.ok("transfer.upload", {"session": sid, "local": local, "remote_path": "/"})
    assert res["size"] == size, res
    assert filecmp.cmp(local, os.path.join(root, "big.bin"), shallow=False)
    progress = progress_for(d, req_id)
    print(f"  upload progress events: {len(progress)}")
    assert progress and all(p["total"] == size for p in progress), progress
    assert all(a["offset"] <= b["offset"] for a, b in zip(progress, progress[1:])), progress

    # Uploading again asks the client what to do.
    d.file_exists_action = "overwrite"
    d.ok("transfer.upload", {"session": sid, "local": local, "remote_path": "/", "remote_name": "big.bin"})
    assert len(d.file_exists_requests) == 1, d.file_exists_requests
    asked = d.file_exists_requests[0]
    assert asked["remote_file"] == "big.bin" and not asked["download"] and "id" in asked, asked

    # A preset answer skips the question.
    d.file_exists_action = None
    d.ok("transfer.upload", {"session": sid, "local": local, "remote_path": "/", "exists": "overwrite"})

    # Download and compare.
    back = os.path.join(work, "back.bin")
    req_id = d.next_id
    res = d.ok("transfer.download", {"session": sid, "remote_path": "/", "remote_name": "big.bin", "local": back})
    assert res["size"] == size, res
    assert filecmp.cmp(local, back, shallow=False)
    assert progress_for(d, req_id), "no download progress"

    # Existing local file, preset answer.
    d.ok("transfer.download", {"session": sid, "remote_path": "/", "remote_name": "big.bin", "local": back,
                               "exists": "overwrite"})
    assert filecmp.cmp(local, back, shallow=False)

    # Errors.
    d.error("transfer.upload", {"session": sid, "local": os.path.join(work, "missing.bin"), "remote_path": "/"}, -32602)
    d.error("transfer.download", {"session": sid, "remote_path": "/", "remote_name": "missing.bin",
                                  "local": os.path.join(work, "missing.bin")}, -32000)
    d.error("transfer.upload", {"session": sid, "local": local, "remote_path": "/", "exists": "bogus"}, -32602)

    d.ok("remote.delete", {"session": sid, "path": "/", "names": ["big.bin"]})
    assert os.listdir(root) == [], os.listdir(root)
    shutil.rmtree(work, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("exe")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--root", required=True)
    args = parser.parse_args()

    with open(os.path.join(args.root, "existing.txt"), "w") as f:
        f.write("already on the server\n")
    existing_size = os.path.getsize(os.path.join(args.root, "existing.txt"))

    d = Daemon(args.exe)

    hello = d.ok("daemon.hello")
    assert hello["name"] == "totzillad" and hello["protocol"] == 1, hello

    d.send_raw("{not json")
    msg = d.messages.get(timeout=10)
    assert msg["error"]["code"] == -32700, msg
    d.error("no.such.method", {}, -32601)
    d.error("session.open", {"protocol": "gopher", "host": "x"}, -32602)
    d.error("remote.list", {"session": 999}, -32001)

    server = {"host": "127.0.0.1", "port": args.port, "user": "test", "timeout": 20}

    err = d.error("session.open", dict(server, password="wrong"), -32000)
    print(f"  wrong password -> {err}")
    d.wait_event("session.closed")

    sid = d.ok("session.open", dict(server, password=args.password))["session"]
    fp = d.hostkeys[-1] if d.hostkeys else ""
    assert fp.startswith("SHA256:") and fp.count("SHA256:") == 1, d.hostkeys

    root = d.ok("remote.list", {"session": sid})
    assert root["path"] == "/", root
    entries = names(root)
    assert "existing.txt" in entries and entries["existing.txt"]["size"] == existing_size, root
    assert not entries["existing.txt"]["dir"], root

    d.ok("remote.mkdir", {"session": sid, "path": "/newdir"})
    assert names(d.ok("remote.list", {"session": sid, "path": "/"}))["newdir"]["dir"]

    d.ok("remote.rename", {"session": sid, "from_path": "/", "from_name": "existing.txt",
                           "to_path": "/newdir", "to_name": "moved.txt"})
    moved = names(d.ok("remote.list", {"session": sid, "path": "/newdir"}))
    assert moved["moved.txt"]["size"] == existing_size, moved
    assert os.path.exists(os.path.join(args.root, "newdir", "moved.txt"))

    d.ok("remote.delete", {"session": sid, "path": "/newdir", "names": ["moved.txt"]})
    d.ok("remote.rmdir", {"session": sid, "path": "/", "name": "newdir"})
    assert names(d.ok("remote.list", {"session": sid, "path": "/"})) == {}
    assert os.listdir(args.root) == []

    transfers(d, sid, args.root)

    d.error("remote.list", {"session": sid, "path": "/does/not/exist"}, -32000)
    d.error("remote.rmdir", {"session": sid, "path": "/", "name": "a/b"}, -32602)

    d.ok("session.close", {"session": sid})
    d.events.clear()
    d.wait_event("session.closed")
    d.error("remote.list", {"session": sid}, -32001)

    d.ok("daemon.shutdown")
    assert d.proc.wait(timeout=15) == 0
    print("all daemon RPC tests passed")


if __name__ == "__main__":
    main()
