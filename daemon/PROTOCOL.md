# totzillad protocol (version 1)

JSON-RPC 2.0 over stdin/stdout, one JSON message per line (UTF-8). stderr carries diagnostics only. Closing stdin shuts the daemon down.

Requests on one session run in order; a response arrives when the engine finishes the command. Different sessions run in parallel. Paths are absolute server paths (`/var/www`); names are single path segments.

## Methods

| Method | Params | Result |
|---|---|---|
| `daemon.hello` | – | `{name, version, engine, protocol}` |
| `daemon.shutdown` | – | `{}`, then the daemon exits |
| `session.open` | `protocol` (`sftp` default, `ftp`, `ftps`, `ftpes`, `ftp-insecure`), `host`, `port`?, `user`?, `password`?, `keyfile`?, `timeout`? (seconds) | `{session}` once connected |
| `session.close` | `session` | `{}`; followed by the `session.closed` event |
| `session.cancel` | `session` | `{}`; the running command fails with flag `canceled` |
| `remote.list` | `session`, `path`? (default: login directory), `refresh`? (default true) | `{path, entries: [{name, size, dir, link, time?, perms?, owner?, target?}]}` |
| `remote.mkdir` | `session`, `path` | `{}` |
| `remote.delete` | `session`, `path`, `names` (array) | `{}` |
| `remote.rmdir` | `session`, `path`, `name` | `{}` |
| `remote.rename` | `session`, `from_path`, `from_name`, `to_path`, `to_name` | `{}` |
| `remote.chmod` | `session`, `path`, `name`, `mode` (e.g. `"755"`) | `{}` |
| `request.reply` | `session`, `request`, answer fields (below) | `{}` |

`time` is UTC: `YYYY-MM-DDTHH:MM:SSZ`, or `YYYY-MM-DD` when the server only reports a date. `size` is -1 when unknown.

## Events (notifications from the daemon)

| Method | Params |
|---|---|
| `log` | `session`, `level` (`status`, `error`, `command`, `reply`, `listing`, `debug`), `message` |
| `request` | `session`, `request`, `type`, type-specific fields (below) |
| `session.disconnected` | `session` (the server dropped the connection; the session stays open) |
| `session.closed` | `session` |

## Requests the client must answer

The engine waits until `request.reply` arrives. Fields not given mean "no".

| `type` | Event fields | Reply fields |
|---|---|---|
| `hostkey` | `host`, `port`, `fingerprint` (`SHA256:...`), `key` (OpenSSH format) | `trust` (bool) |
| `password` | – | `password` (omit to cancel) |
| `interactive` | `name`, `instruction`, `prompts: [{prompt, echo}]` | `responses` (array of strings, omit to cancel) |
| `keyfile_password` | `file`, `fingerprint`, `repeated` | `password` (omit to cancel) |
| `otp` | – | `otp` |
| `insecure_connection` | `host`, `port` | `allow` (bool) |
| `file_exists` | `download`, `local_file`, `local_size`, `remote_path`, `remote_file`, `remote_size` | `action` (`overwrite`, `overwrite_newer`, `overwrite_size`, `overwrite_size_or_newer`, `resume`, `rename`, `skip`), `new_name` for `rename` |

TLS certificate requests are declined automatically until FTPS support lands.

## Errors

Standard JSON-RPC codes (-32700, -32600, -32601, -32602) plus:

| Code | Meaning |
|---|---|
| -32000 | Engine operation failed. `data: {reply, flags}`; flags include `timeout`, `canceled`, `not_connected`, `disconnected`, `critical`, `password_failed`, ... |
| -32001 | Unknown session |
| -32002 | Unknown request |
| -32003 | Session is closing or closed |
