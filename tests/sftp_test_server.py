"""Minimal SFTP server for CI tests of the M0b spike.

Serves one directory, accepts any user with the password given on the
command line, and generates a throwaway host key. Not for real use.

Copyright (C) Parom contributors
SPDX-License-Identifier: GPL-3.0-or-later
"""

import argparse
import os
import socket
import threading

import paramiko
from paramiko import SFTPAttributes, SFTPHandle, SFTPServer, SFTPServerInterface
from paramiko.sftp import SFTP_OK


class Server(paramiko.ServerInterface):
    def __init__(self, password):
        self.password = password

    def check_auth_password(self, username, password):
        if password == self.password:
            return paramiko.AUTH_SUCCESSFUL
        return paramiko.AUTH_FAILED

    def get_allowed_auths(self, username):
        return "password"

    def check_channel_request(self, kind, chanid):
        if kind == "session":
            return paramiko.OPEN_SUCCEEDED
        return paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED


class Handle(SFTPHandle):
    def stat(self):
        try:
            return SFTPAttributes.from_stat(os.fstat(self.readfile.fileno()))
        except OSError as e:
            return SFTPServer.convert_errno(e.errno)

    def chattr(self, attr):
        return SFTP_OK


def make_sftp_interface(root):
    class Interface(SFTPServerInterface):
        def _local(self, path):
            path = self.canonicalize(path)
            return os.path.join(root, path.lstrip("/"))

        def canonicalize(self, path):
            parts = []
            for p in path.replace("\\", "/").split("/"):
                if p in ("", "."):
                    continue
                if p == "..":
                    if parts:
                        parts.pop()
                    continue
                parts.append(p)
            return "/" + "/".join(parts)

        def list_folder(self, path):
            local = self._local(path)
            try:
                out = []
                for name in os.listdir(local):
                    attr = SFTPAttributes.from_stat(os.stat(os.path.join(local, name)))
                    attr.filename = name
                    out.append(attr)
                return out
            except OSError as e:
                return SFTPServer.convert_errno(e.errno)

        def stat(self, path):
            try:
                return SFTPAttributes.from_stat(os.stat(self._local(path)))
            except OSError as e:
                return SFTPServer.convert_errno(e.errno)

        lstat = stat

        def open(self, path, flags, attr):
            local = self._local(path)
            try:
                fd = os.open(local, flags | getattr(os, "O_BINARY", 0), 0o644)
            except OSError as e:
                return SFTPServer.convert_errno(e.errno)
            if flags & os.O_WRONLY:
                mode = "ab" if flags & os.O_APPEND else "wb"
            elif flags & os.O_RDWR:
                mode = "a+b" if flags & os.O_APPEND else "r+b"
            else:
                mode = "rb"
            f = os.fdopen(fd, mode)
            h = Handle(flags)
            h.filename = local
            h.readfile = f
            h.writefile = f
            return h

        def remove(self, path):
            try:
                os.remove(self._local(path))
            except OSError as e:
                return SFTPServer.convert_errno(e.errno)
            return SFTP_OK

        def rename(self, oldpath, newpath):
            try:
                os.replace(self._local(oldpath), self._local(newpath))
            except OSError as e:
                return SFTPServer.convert_errno(e.errno)
            return SFTP_OK

        posix_rename = rename

        def mkdir(self, path, attr):
            try:
                os.mkdir(self._local(path))
            except OSError as e:
                return SFTPServer.convert_errno(e.errno)
            return SFTP_OK

        def rmdir(self, path):
            try:
                os.rmdir(self._local(path))
            except OSError as e:
                return SFTPServer.convert_errno(e.errno)
            return SFTP_OK

        def chattr(self, path, attr):
            return SFTP_OK

    return Interface


def serve_client(conn, host_key, password, root):
    transport = paramiko.Transport(conn)
    transport.add_server_key(host_key)
    transport.set_subsystem_handler("sftp", SFTPServer, make_sftp_interface(root))
    transport.start_server(server=Server(password))
    while transport.is_active():
        transport.join(1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--port", type=int, default=3373)
    parser.add_argument("--password", required=True)
    args = parser.parse_args()

    root = os.path.abspath(args.root)
    host_key = paramiko.RSAKey.generate(2048)

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", args.port))
    sock.listen(5)
    print(f"listening on 127.0.0.1:{args.port}, serving {root}", flush=True)

    while True:
        conn, _ = sock.accept()
        threading.Thread(target=serve_client, args=(conn, host_key, args.password, root), daemon=True).start()


if __name__ == "__main__":
    main()
