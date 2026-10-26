"""Minimal FTP / explicit FTPS (AUTH TLS) servers for CI tests.

Serves one directory to one user. With --tls, generates a throwaway
self-signed certificate and requires TLS on the control connection.
Not for real use.

Copyright (C) TOTzilla contributors
SPDX-License-Identifier: GPL-3.0-or-later
"""

import argparse
import datetime
import os
import tempfile

from pyftpdlib.authorizers import DummyAuthorizer
from pyftpdlib.handlers import FTPHandler, TLS_FTPHandler
from pyftpdlib.servers import FTPServer


def write_self_signed(directory, host):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, host)])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=30))
        .add_extension(x509.SubjectAlternativeName([x509.DNSName(host)]), critical=False)
        .sign(key, hashes.SHA256())
    )
    path = os.path.join(directory, "server.pem")
    with open(path, "wb") as f:
        f.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL,
                                  serialization.NoEncryption()))
        f.write(cert.public_bytes(serialization.Encoding.PEM))
    return path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--user", default="test")
    parser.add_argument("--password", required=True)
    parser.add_argument("--tls", action="store_true")
    args = parser.parse_args()

    authorizer = DummyAuthorizer()
    authorizer.add_user(args.user, args.password, os.path.abspath(args.root), perm="elradfmwMT")

    if args.tls:
        handler = TLS_FTPHandler
        handler.certfile = write_self_signed(tempfile.mkdtemp(prefix="ftps-"), "localhost")
        handler.tls_control_required = True
        handler.tls_data_required = True
    else:
        handler = FTPHandler
    handler.authorizer = authorizer
    handler.passive_ports = range(args.port + 100, args.port + 200)

    server = FTPServer(("127.0.0.1", args.port), handler)
    print(f"{'FTPS' if args.tls else 'FTP'} listening on 127.0.0.1:{args.port}, serving {args.root}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
