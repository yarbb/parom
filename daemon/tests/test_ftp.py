"""FTP and explicit FTPS tests for totzillad against tests/ftp_test_server.py.

Usage: python daemon/tests/test_ftp.py PATH_TO_TOTZILLAD --password test
           --ftp-port 2121 --ftp-root DIR --ftps-port 2221 --ftps-root DIR

Copyright (C) TOTzilla contributors
SPDX-License-Identifier: GPL-3.0-or-later
"""

import argparse
import filecmp
import os
import shutil
import sys
import tempfile

from test_rpc import Daemon, names


def round_trip(d, sid, root, work, label):
    """List, upload, list again, download and compare one file."""
    listing = d.ok("remote.list", {"session": sid})
    assert listing["path"] == "/", listing
    assert "existing.txt" in names(listing), listing

    local = os.path.join(work, f"{label}.bin")
    with open(local, "wb") as f:
        f.write(os.urandom(256 * 1024))
    res = d.ok("transfer.upload", {"session": sid, "local": local, "remote_path": "/"})
    assert res["size"] == os.path.getsize(local), res
    assert filecmp.cmp(local, os.path.join(root, f"{label}.bin"), shallow=False)
    assert names(d.ok("remote.list", {"session": sid}))[f"{label}.bin"]["size"] == os.path.getsize(local)

    back = os.path.join(work, f"{label}-back.bin")
    d.ok("transfer.download", {"session": sid, "remote_path": "/", "remote_name": f"{label}.bin", "local": back})
    assert filecmp.cmp(local, back, shallow=False)
    d.ok("remote.delete", {"session": sid, "path": "/", "names": [f"{label}.bin"]})


def main():
    # Test output includes non-ASCII names; the CI console is not UTF-8 by default.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser()
    parser.add_argument("exe")
    parser.add_argument("--password", required=True)
    parser.add_argument("--ftp-port", type=int, required=True)
    parser.add_argument("--ftp-root", required=True)
    parser.add_argument("--ftps-port", type=int, required=True)
    parser.add_argument("--ftps-root", required=True)
    args = parser.parse_args()

    for root in (args.ftp_root, args.ftps_root):
        with open(os.path.join(root, "existing.txt"), "w") as f:
            f.write("already on the server\n")
    work = tempfile.mkdtemp(prefix="totzillad-ftp-")
    d = Daemon(args.exe)
    ftp = {"host": "127.0.0.1", "port": args.ftp_port, "user": "test", "password": args.password, "timeout": 20}
    ftps = dict(ftp, port=args.ftps_port)

    # Plain FTP: "ftp" tries AUTH TLS first, then asks before going unencrypted.
    d.answers["insecure_connection"] = lambda p: {"allow": False}
    d.error("session.open", dict(ftp, protocol="ftp"), -32000)
    assert d.seen.get("insecure_connection"), "no insecure_connection request"
    d.wait_event("session.closed")

    d.answers["insecure_connection"] = lambda p: {"allow": True}
    sid = d.ok("session.open", dict(ftp, protocol="ftp"))["session"]
    round_trip(d, sid, args.ftp_root, work, "ftp")
    d.ok("session.close", {"session": sid})

    # "ftp-insecure" skips AUTH TLS, but the engine still asks before any
    # unencrypted login (ftp/logon.cpp), exactly once.
    asked = len(d.seen["insecure_connection"])
    sid = d.ok("session.open", dict(ftp, protocol="ftp-insecure"))["session"]
    assert len(d.seen["insecure_connection"]) == asked + 1, d.seen["insecure_connection"][asked:]
    d.ok("session.close", {"session": sid})

    # "Do not ask again for this server": remembered per host and port.
    d.answers["insecure_connection"] = lambda p: {"allow": True, "remember": True}
    sid = d.ok("session.open", dict(ftp, protocol="ftp-insecure"))["session"]
    d.ok("session.close", {"session": sid})
    asked = len(d.seen["insecure_connection"])
    sid = d.ok("session.open", dict(ftp, protocol="ftp-insecure"))["session"]
    assert len(d.seen["insecure_connection"]) == asked, "remembered host was asked again"
    d.ok("session.close", {"session": sid})

    # FTPES against a server without TLS fails instead of falling back.
    d.error("session.open", dict(ftp, protocol="ftpes"), -32000)

    # Explicit FTPS with a self-signed certificate: rejecting it fails the connection.
    d.answers["certificate"] = lambda p: {"trust": False}
    d.error("session.open", dict(ftps, protocol="ftpes"), -32000)
    cert = d.seen["certificate"][-1]
    print(f"  certificate request: {cert}")
    assert cert["host"] == "127.0.0.1" and cert["port"] == args.ftps_port, cert
    # libfilezilla only checks the host name for chains the OS trusts, so the
    # UI compares host and alt_names itself; here the flag just has to exist.
    assert cert["system_trust"] is False and isinstance(cert["hostname_mismatch"], bool), cert
    leaf = cert["certificates"][0]
    assert leaf["self_signed"] and "localhost" in leaf["alt_names"], leaf
    assert len(leaf["fingerprint_sha256"]) >= 64 and leaf["valid_from"] < leaf["valid_until"], leaf

    # Trusting it once covers the data connections of that session.
    d.answers["certificate"] = lambda p: {"trust": True}
    d.answers["tls_no_resumption"] = lambda p: {"allow": True}
    before = len(d.seen["certificate"])
    sid = d.ok("session.open", dict(ftps, protocol="ftpes"))["session"]
    round_trip(d, sid, args.ftps_root, work, "ftps")
    print(f"  certificate questions while trusted: {len(d.seen['certificate']) - before}")
    assert len(d.seen["certificate"]) - before == 1, d.seen["certificate"][before:]
    d.ok("session.close", {"session": sid})

    d.ok("daemon.shutdown")
    assert d.proc.wait(timeout=15) == 0
    shutil.rmtree(work, ignore_errors=True)
    print("all daemon FTP tests passed")


if __name__ == "__main__":
    main()
