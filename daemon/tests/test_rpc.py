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
        # Responses to requests sent with send(), kept until wait_response().
        self.stash = {}
        self.async_ids = set()
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

    def send(self, method, params):
        """Sends a request without waiting; collect it later with wait_response."""
        req_id = self.next_id
        self.next_id += 1
        print(f"> {method} (async {req_id})")
        self.async_ids.add(req_id)
        self.send_raw(json.dumps({"jsonrpc": "2.0", "id": req_id, "method": method, "params": params}))
        return req_id

    def wait_response(self, req_id, timeout=60):
        if req_id in self.stash:
            return self.stash.pop(req_id)
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
            if msg.get("id") in self.async_ids:
                self.stash[msg["id"]] = msg
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

    # A preset answer skips the question; the result says whether anything moved.
    d.file_exists_action = None
    res = d.ok("transfer.upload", {"session": sid, "local": local, "remote_path": "/", "exists": "overwrite"})
    assert res["skipped"] is False, res
    res = d.ok("transfer.upload", {"session": sid, "local": local, "remote_path": "/", "exists": "skip"})
    assert res["skipped"] is True, res
    # The server copy was written after the local file, so "newer" skips it.
    res = d.ok("transfer.upload", {"session": sid, "local": local, "remote_path": "/", "exists": "overwrite_newer"})
    assert res["skipped"] is True, res

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


def mkdir_and_cancel(d, sid, root):
    # mkdir must answer for an existing folder (the UI relies on it for folder
    # uploads) and work for nested paths.
    d.ok("remote.mkdir", {"session": sid, "path": "/m"})
    again = d.call("remote.mkdir", {"session": sid, "path": "/m"})
    print(f"  mkdir existing -> {again.get('error', again.get('result'))}")
    d.ok("remote.mkdir", {"session": sid, "path": "/m/n"})
    assert os.path.isdir(os.path.join(root, "m", "n"))

    work = tempfile.mkdtemp(prefix="totzillad-cancel-")
    local = os.path.join(work, "huge.bin")
    with open(local, "wb") as f:
        for _ in range(200):
            f.write(os.urandom(1024 * 1024))

    # Two uploads queue up in the session; cancel the waiting one, then the running one.
    d.events.clear()
    first = d.send("transfer.upload", {"session": sid, "local": local, "remote_path": "/m", "remote_name": "one.bin"})
    second = d.send("transfer.upload", {"session": sid, "local": local, "remote_path": "/m", "remote_name": "two.bin"})
    assert d.ok("session.cancel_request", {"session": sid, "id": second})["state"] == "queued"
    dropped = d.wait_response(second)
    assert "canceled" in dropped["error"]["data"]["flags"], dropped

    while not progress_for(d, first):
        msg = d.messages.get(timeout=30)
        if msg is None:
            raise AssertionError("daemon closed stdout")
        if "method" in msg:
            d._handle_event(msg)
        elif msg.get("id") in d.async_ids:
            d.stash[msg["id"]] = msg
    assert d.ok("session.cancel_request", {"session": sid, "id": first})["state"] == "running"
    aborted = d.wait_response(first)
    assert "error" in aborted and "canceled" in aborted["error"]["data"]["flags"], aborted
    assert not os.path.exists(os.path.join(root, "m", "two.bin"))

    d.error("session.cancel_request", {"session": sid, "id": first}, -32002)
    # The session still works after a cancel.
    names_after = names(d.ok("remote.list", {"session": sid, "path": "/m"}))
    if "one.bin" in names_after:
        d.ok("remote.delete", {"session": sid, "path": "/m", "names": ["one.bin"]})
    d.ok("remote.rmdir", {"session": sid, "path": "/m", "name": "n"})
    d.ok("remote.rmdir", {"session": sid, "path": "/", "name": "m"})
    shutil.rmtree(work, ignore_errors=True)


def trust_tests(exe, server, password):
    """Remembered host keys survive a daemon restart; a changed key is flagged."""
    data = tempfile.mkdtemp(prefix="totzillad-data-")
    trust_file = os.path.join(data, "trust.json")
    params = dict(server, password=password)

    d = Daemon(exe)
    d.error("store.get", {"name": "sites"}, -32004)  # before daemon.init
    d.ok("daemon.init", {"data_dir": data})
    # Named JSON documents (sites, preferences) round-trip through the data folder.
    assert d.ok("store.get", {"name": "sites"})["value"] is None
    doc = {"version": 1, "sites": [{"id": "a", "name": "Сервер", "host": "example.org"}]}
    d.ok("store.set", {"name": "sites", "value": doc})
    assert d.ok("store.get", {"name": "sites"})["value"] == doc
    assert os.path.exists(os.path.join(data, "sites.json"))
    for bad in ("../x", "Sites", "trust", ""):
        d.error("store.get", {"name": bad}, -32602)
    d.answers["hostkey"] = lambda p: {"trust": True, "remember": True}
    first = d.ok("session.open", params)["session"]
    assert d.seen["hostkey"][-1]["changed"] is False, d.seen["hostkey"]
    d.ok("session.close", {"session": first})
    with open(trust_file) as f:
        stored = json.load(f)["entries"]
    assert list(stored.values()) == [d.seen["hostkey"][-1]["fingerprint"]], stored

    listed = d.ok("trust.list")["entries"]
    assert len(listed) == 1 and listed[0]["kind"] == "ssh" and listed[0]["host"] == "127.0.0.1", listed
    assert listed[0]["fingerprint"] == d.seen["hostkey"][-1]["fingerprint"], listed

    asked = len(d.seen["hostkey"])
    second = d.ok("session.open", params)["session"]
    assert len(d.seen["hostkey"]) == asked, "remembered key was asked again"
    d.ok("session.close", {"session": second})
    d.ok("daemon.shutdown")
    d.proc.wait(timeout=15)

    # A new daemon process reads the same file.
    d = Daemon(exe)
    d.ok("daemon.init", {"data_dir": data})
    d.answers["hostkey"] = lambda p: {"trust": False}
    third = d.ok("session.open", params)["session"]
    assert "hostkey" not in d.seen, d.seen
    d.ok("session.close", {"session": third})

    # Pretend the server key changed: the question comes back, marked as changed.
    key = next(iter(stored))
    with open(trust_file, "w") as f:
        json.dump({"version": 1, "entries": {key: "SHA256:previous-key"}}, f)
    d.ok("daemon.shutdown")
    d.proc.wait(timeout=15)
    d = Daemon(exe)
    d.ok("daemon.init", {"data_dir": data})
    d.answers["hostkey"] = lambda p: {"trust": False}
    d.error("session.open", params, -32000)
    changed = d.seen["hostkey"][-1]
    assert changed["changed"] is True and changed["previous"] == "SHA256:previous-key", changed
    d.error("daemon.init", {"data_dir": ""}, -32602)
    d.ok("trust.forget", {"key": key})
    assert d.ok("trust.list")["entries"] == []
    d.error("trust.forget", {"key": key}, -32602)
    d.ok("daemon.shutdown")
    d.proc.wait(timeout=15)
    shutil.rmtree(data, ignore_errors=True)
    print("  trust store tests passed")


def main():
    # Test output includes non-ASCII names; the CI console is not UTF-8 by default.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
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
    mkdir_and_cancel(d, sid, args.root)

    d.error("remote.list", {"session": sid, "path": "/does/not/exist"}, -32000)
    d.error("remote.rmdir", {"session": sid, "path": "/", "name": "a/b"}, -32602)

    d.ok("session.close", {"session": sid})
    d.events.clear()
    d.wait_event("session.closed")
    d.error("remote.list", {"session": sid}, -32001)

    d.ok("daemon.shutdown")
    assert d.proc.wait(timeout=15) == 0
    trust_tests(args.exe, server, args.password)
    print("all daemon RPC tests passed")


if __name__ == "__main__":
    main()
