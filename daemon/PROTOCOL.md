# totzillad protocol (version 1)

JSON-RPC 2.0 over stdin/stdout, one JSON message per line (UTF-8). stderr carries diagnostics only. Closing stdin shuts the daemon down.

Requests on one session run in order; a response arrives when the engine finishes the command. Different sessions run in parallel. Paths are absolute server paths (`/var/www`); names are single path segments.

## Methods

| Method | Params | Result |
|---|---|---|
| `daemon.hello` | – | `{name, version, engine, protocol}` |
| `daemon.init` | `data_dir` (UTF-8 path; created if missing) | `{}`; loads `trust.json` from it. Call once before opening sessions; without it trusted keys live in memory only |
| `daemon.shutdown` | – | `{}`, then the daemon exits |
| `trust.list` | – | `{entries: [{key, kind ("ssh" or "tls"), host, port, fingerprint}]}` |
| `trust.forget` | `key` | `{}`; the next connection asks again |
| `store.get` | `name` (`[a-z0-9_-]`, not `trust`) | `{value}`: the stored JSON document, or null |
| `store.set` | `name`, `value` (any JSON) | `{}`; written to `<data_dir>/<name>.json` atomically. Used for `sites` and `preferences` |
| `session.open` | `protocol` (`sftp` default, `ftp`, `ftps`, `ftpes`, `ftp-insecure`), `host`, `port`?, `user`?, `password`?, `keyfile`?, `timeout`? (seconds), `pace_ms`? (0-10000: minimum pause between the end of one command and the start of the next, for hosts that rate-limit requests) | `{session}` once connected |
| `session.close` | `session` | `{}`; followed by the `session.closed` event |
| `session.cancel` | `session` | `{}`; the running command fails with flag `canceled` |
| `session.cancel_request` | `session`, `id` (JSON-RPC id of an earlier request) | `{state: "running" \| "queued"}`; that request then fails with flag `canceled` (a queued one never starts). Error -32002 if it already finished |
| `remote.list` | `session`, `path`? (default: login directory), `refresh`? (default true) | `{path, entries: [{name, size, dir, link, time?, perms?, owner?, target?}]}` |
| `remote.mkdir` | `session`, `path` | `{}` |
| `remote.delete` | `session`, `path`, `names` (array) | `{}` |
| `remote.rmdir` | `session`, `path`, `name` | `{}` |
| `remote.rename` | `session`, `from_path`, `from_name`, `to_path`, `to_name` | `{}` |
| `remote.chmod` | `session`, `path`, `name`, `mode` (e.g. `"755"`) | `{}` |
| `transfer.upload` | `session`, `local` (local file path), `remote_path`, `remote_name`? (default: local file name), `exists`? | `{size}` |
| `transfer.download` | `session`, `remote_path`, `remote_name`, `local` (local file path), `exists`? | `{size}` (local size after the transfer) |
| `request.reply` | `session`, `request`, answer fields (below) | `{}` |

`exists` decides what happens when the target file already exists: `ask` (default; sends a `file_exists` request), or one of the `file_exists` actions below except `rename`. Transfers run in the session's queue like any other command; `session.cancel` aborts the running one.

`time` is UTC: `YYYY-MM-DDTHH:MM:SSZ`, or `YYYY-MM-DD` when the server only reports a date. `size` is -1 when unknown.

## Events (notifications from the daemon)

| Method | Params |
|---|---|
| `log` | `session`, `level` (`status`, `error`, `command`, `reply`, `listing`, `debug`), `message` |
| `request` | `session`, `request`, `id` (JSON-RPC id of the command that triggered it), `type`, type-specific fields (below) |
| `transfer.progress` | `session`, `id` (JSON-RPC id of the transfer), `offset`, `start` (resume offset), `total` (-1 if unknown). Sent about every 200 ms while bytes move |
| `session.disconnected` | `session` (the server dropped the connection; the session stays open) |
| `session.closed` | `session` |

## Requests the client must answer

The engine waits until `request.reply` arrives. Fields not given mean "no".

| `type` | Event fields | Reply fields |
|---|---|---|
| `hostkey` | `host`, `port`, `fingerprint` (`SHA256:...`), `key` (OpenSSH format), `changed` (a different key was trusted before), `previous`? | `trust` (bool), `remember` (bool: store it in trust.json) |
| `password` | – | `password` (omit to cancel) |
| `interactive` | `name`, `instruction`, `prompts: [{prompt, echo}]` | `responses` (array of strings, omit to cancel) |
| `keyfile_password` | `file`, `fingerprint`, `repeated` | `password` (omit to cancel) |
| `otp` | – | `otp` |
| `insecure_connection` | `host`, `port` (FTP server without TLS) | `allow` (bool) |
| `certificate` | `host`, `port`, `tls`, `cipher`, `system_trust`, `hostname_mismatch`, `weak_algorithms`, `certificates: [{subject, issuer, alt_names, fingerprint_sha256, serial, valid_from, valid_until, key, signature, self_signed}]` (server first), `changed`, `previous`? | `trust` (bool), `remember` (bool) |
| `tls_no_resumption` | `host`, `port` (data connection cannot resume the TLS session) | `allow` (bool) |
| `file_exists` | `download`, `local_file`, `local_size`, `remote_path`, `remote_file`, `remote_size` | `action` (`overwrite`, `overwrite_newer`, `overwrite_size`, `overwrite_size_or_newer`, `resume`, `rename`, `skip`), `new_name` for `rename` |

Certificates the operating system trusts for the host name are accepted without asking. A certificate the user trusted once is accepted again for the rest of that session (data connections, reconnects). With `remember`, host keys and certificates are stored per host and port in `<data_dir>/trust.json` and accepted silently next time; a different key for the same host comes back as a request with `changed: true`.

## Errors

Standard JSON-RPC codes (-32700, -32600, -32601, -32602) plus:

| Code | Meaning |
|---|---|
| -32000 | Engine operation failed. `data: {reply, flags}`; flags include `timeout`, `canceled`, `not_connected`, `disconnected`, `critical`, `password_failed`, ... |
| -32001 | Unknown session |
| -32002 | Unknown request |
| -32003 | Session is closing or closed |
| -32004 | Store error (no `daemon.init` yet, damaged or unwritable document) |
