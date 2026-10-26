# TOTzilla (working name)

A modern SFTP/FTP client built on the FileZilla engine, with a GitHub tab (like GitHub Desktop) and one-click, version-aware server sync. Aimed at people who deploy to servers (game servers, small sites) from a git repository.

## Goals
- Two tabs: **Files** (pure dual-pane file manager) and **GitHub** (changes, history, issues, pull requests, server backups, sync).
- Backend = FileZilla 3.71.1 engine (`src/engine`, `src/include`, wx-free C++). Frontend = our own UI (Tauri + web tech).
- Safe server sync using a tiny marker file on the server (see `docs/DEVLOG.md`, "Sync marker").
- Dark (true black) and light themes, English UI first, community translations via GitHub (`locales/`).

## Planned layout
```
third_party/filezilla/   needed parts of FileZilla 3.71.1 (headers intact) + NOTICE
daemon/                  C++ wrapper around the engine, JSON-RPC over stdio/pipe
app/                     Tauri (Rust) + web UI
docs/                    DEVLOG.md, architecture, marker spec, design/
locales/                 en.json (+ community translations)
.github/workflows/       Windows build via MSYS2 (libfilezilla + libfzssh + engine)
```

## License
GPLv3 (FileZilla sources are GPLv3). Keep all upstream copyright headers, add NOTICE, mark modified files. Check licenses of libfilezilla and libfzssh-client before release.

## Building
Planned: GitHub Actions on `windows-latest` produces the installer. No local C++ toolchain is required for the maintainer.
