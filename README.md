# Parom

An SFTP/FTP client built on the FileZilla engine, with a GitHub tab (like GitHub Desktop) and one-click, version-aware server sync. Made for people who deploy to servers (game servers, small sites) from a git repository.

*Parom* is Russian for "ferry".

## Download
Get the installer from [Releases](https://github.com/yarbb/parom/releases). Windows for now; a Linux AppImage is on the way. Parom installs for your user only (no administrator rights) and updates itself when you agree to it.

The installer is not code-signed yet, so Windows SmartScreen may say "Windows protected your PC". Click **More info**, then **Run anyway**. Updates are signed with the project's own key, and Parom refuses any update that is not.

## What it does
- **Files**: a dual-pane file manager for SFTP, FTP and FTPS. Site Manager, passwords in the system's credential store, drag and drop (also from and to Explorer), simultaneous transfers, edit server files in place, synchronized browsing.
- **Sync**: a tiny marker file on the server (`/.parom`) records which commit is deployed. Parom tells you when the server is behind, ahead or was edited by hand, backs up what a sync overwrites, and can restore it.
- **GitHub**: Changes, History, Issues and Pull requests for the repository linked to a site. Commits with "Fixes #N" close their issue once a sync deploys them.
- Dark and light themes, English and Russian (community translations welcome in `locales/`).

## Layout
```
third_party/filezilla/   FileZilla 3.71.1 source tarball (verified, see NOTICE)
daemon/                  paromd: C++ wrapper around the engine, JSON-RPC over stdio
app/                     Tauri 2 (Rust) + Svelte UI
docs/                    design mockups, release notes
locales/                 en.json (source of truth) and translations
.github/workflows/       Windows build, tests, releases
```

## Building
GitHub Actions builds everything on `windows-latest` (MSYS2 for the engine and the daemon, then the Tauri app and its installer). No local C++ toolchain is needed. A tag `vX.Y.Z` publishes a release with the notes in `docs/releases/X.Y.Z.md`.

## License
GPLv3 or later (the FileZilla sources are GPLv3). Upstream copyright headers are kept; see NOTICE.
