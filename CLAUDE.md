# CLAUDE.md

Technical guide for agents working on this repository. Public file: no personal data, local paths or account links.

## Project
Cross-platform SFTP/FTP client built on the FileZilla 3.71.1 engine, with a GitHub tab (like GitHub Desktop) and safe, version-aware server sync. Generic tool: nothing specific to any particular server.
- Product name: **Parom** (Russian for "ferry"; formerly the working name TOTzilla). It lives in ONE place: `productName` in `app/src-tauri/tauri.conf.json` (window title, installer, credential service, user agent). Never "-zilla" (FileZilla trademark). Internal names still carry the working name for now: the daemon `totzillad`, the Rust crate, the repository, the GitHub App slug `totzilla-sync`.
- Rename compatibility: on first start the old data folders (`org.totzilla.app`) are copied to the new identifier and saved passwords to the new credential service (`src-tauri/src/migrate.rs`); the old marker `/.totzilla` and `.totzilla-ignore` are still read (the marker is replaced by `/.parom` on the next write).
- License: GPLv3 or later. fzssh is AGPLv3, so distributed binaries follow AGPLv3 terms. Keep upstream copyright headers, mark modified files, keep NOTICE up to date.
- Remove FileZilla branding, client identification strings and update-check URLs; updates come from GitHub Releases.

## Working rules
- Builds run only in GitHub Actions (windows-latest + MSYS2 UCRT64). No local C++ toolchain is assumed. Use `gh` to trigger runs and read failed logs.
- Work on branches. Commit messages: one English line, imperative, <= 72 chars, optional prefix (docs, feat, fix, ci, build), "Fixes #N" when closing issues.
- Do not claim something works until CI or a test proves it.
- Code, comments, commits and docs in English.
- Cross-platform code only (no Windows-only APIs). Linux: experimental, CI-built. macOS: later.

## Layout
```
third_party/filezilla/   FileZilla 3.71.1 source tarball (verified SHA-256 in NOTICE)
daemon/                  totzillad: C++ wrapper around the engine, JSON-RPC over stdio (see daemon/PROTOCOL.md)
spike/m0b/               console spike: SFTP connect, list, upload via the engine API
tests/                   shared test helpers (paramiko SFTP test server)
app/                     Tauri 2 (Rust) + Svelte/TypeScript UI (planned)
docs/design/             static HTML mockups of every screen (open index.html)
locales/                 en.json (+ community translations)
.github/workflows/       CI
```

## Backend: FileZilla engine
- `src/engine`, `src/include` (~26k LOC, no wxWidgets) build into `libfzclient-private`; `src/commonui` into `libfzclient-commonui-private`.
- API: `CFileZillaEngine::Execute(command)` and `GetNextNotification()`. Commands: connect, list, transfer, del, removedir, mkdir, rename, chmod, raw. Protocols: FTP, SFTP (libfzssh-client >= 1.4, not PuTTY), HTTP, Storj.
- Dependencies: libfilezilla >= 0.57.0, fzssh >= 1.4.0, gnutls, nettle, gmp, argon2, sqlite3. On Windows CI they come from MSYS2 UCRT64 packages (`mingw-w64-ucrt-x86_64-libfilezilla`, `-fzssh`, ...).
- Configure: `--enable-gui=no --disable-locales --disable-shellext --disable-storj --disable-manualupdatecheck --disable-autoupdatecheck --with-pugixml=builtin`, then `make -C src`.
- The wx UI (`src/interface`, ~66k LOC) is not used; it is replaced entirely.

## Daemon: totzillad
C++ process wrapping the engine. Owns the transfer queue (SQLite), sites, settings, sync/marker/backups. Talks JSON-RPC over stdio or a local pipe.

## UI: Tauri
- Tauri (WebView2 on Windows) + web UI. File lists are virtualized: 100k rows must scroll smoothly.
- GitHub features live in the app layer: OAuth device-flow sign-in (prefer a GitHub App with fine-grained permissions: contents read, issues read/write, pull requests read), token in the OS credential store, REST for issues/PRs, libgit2 (git2-rs) for local git.

### Screens (mockups in docs/design/)
Dark boards: Fd, Bd, Hi, Ix, Pr, So, Bk, Sm, Dm, Ds, Dp, Dg, P1-P12. Light: Main, B, D, E, LHi..LDg, LP1-LP12. Read them for exact colours, sizes and copy.
- Files tab: dual-pane manager, connect bar (Host, User, Password, Port, Connect), queue panel (Queued/Failed/Succeeded), Site Manager (General, Advanced, Transfer, Sync and GitHub).
- GitHub tab: sidebar (Changes, History, Issues, Pull requests, Backups; avatar + @login at the bottom); Changes (file list with checkboxes, commit box, diff); History (commits with "local HEAD" and "on server" badges); Issues and Pull requests (list + detail, comment, close, merge); signed-out state; device-code sign-in dialog.
- Top bar: server selector + eye button (hide address) + status dot. Status bar: connection state left, app version right.
- Dialogs: create marker, versions differ, syncing progress.
- Preferences (12 pages): Interface (theme Dark/Light/System, accent, density, layout, hide server address), Language (installed + community translations), File lists, File editing, SFTP and keys, Transfers, Timeouts and retries, Account, Repositories (linked repos, managed paths), Marker and history, Logging, Updates.

### Themes
One token set, two themes.
- Dark (true neutral black): bg #000, panel #0a0a0a, line #1c1c1c, text #e8e8e8, muted #8a8a8a.
- Light: bg #fff, panel #fafafa, line #e2e2e2, text #111, muted #666.
- Status as coloured text (modified amber, new green, removed red). Primary button inverted. Monospace for data. 18px checkboxes. No emoji icons.

### i18n
- JSON files in `locales/`; `en.json` is the source of truth; missing keys fall back to English.
- ICU MessageFormat with plural rules (Russian needs one/few/many/other).
- The app can download community translations from GitHub (public, no login).

## Sync marker
One small file on the server, `/.parom` (~300 bytes; `/.totzilla` from before the rename is still read). Fields: format version, repo, last deployed commit SHA, tree fingerprint (hash over managed files: path+size+hash), who (GitHub login or machine), when (UTC), lock `{by, since, ttl}` or none.
- History is NOT stored on the server. Per-user history, backups and logs live locally in the app data dir (`{history,backups,logs}`).
- On connect, read the marker:
  - same SHA: up to date;
  - server SHA is an ancestor of local HEAD: normal update, no prompt;
  - unknown/different SHA (someone else synced) or fingerprint mismatch (manual edits; diff against the git tree at that SHA shows which files): "Versions differ" dialog with Cancel / Show differences / Sync anyway, and "Back up the server first" checked by default.
- First connect to a server: ask once to create the marker (Not now / Never for this server / Create), remembered per server ("Ask again" in Preferences). If declined, compare repo files with server files by size+hash (slower, no author info).
- Lock: write lock with a nonce, re-read after a short delay, abort on mismatch. SFTP has no atomic compare-and-swap, so a small race remains (document it in the UI/docs). Upload to a temp name, then rename.
- Managed paths: `.parom-ignore` in the repo (gitignore syntax; `.totzilla-ignore` still read); `!pattern` means never upload or overwrite (e.g. `!data/**`).
- Sync steps (progress dialog): check marker, back up, upload N files, update marker, optionally close the linked issue with a comment, optionally run a post-sync command (e.g. restart).

## Roadmap
- M0a: engine library builds on Windows CI. M0b: console spike (SFTP connect, list, upload) built in CI.
- M1: totzillad JSON-RPC + Tauri shell + Files tab.
- M2 (done): Site Manager (sites in the daemon store, passwords in the OS credential store), Preferences (live where the feature exists), themes, i18n loader, context menus (edit, download, rename, delete, new folder), edit-in-place with upload on save, remembered host keys and certificates (`trust.json`), "apply to all" for file exists.
- Still open from M2: persistent transfer queue in the daemon (SQLite) and simultaneous transfers; message log panel.
- M3 (done): marker on the server, server state and hand-edit detection, lock, backups (folder configurable) with restore, deploys the committed version (git export), history, Preferences: Marker and history. Not done on purpose: deleting files removed from the repo on the server; the post-sync command runs on this computer (SFTP cannot run commands).
- Drag and drop: rows between the local and server panes (mouse events, `lib/panedrag.svelte.ts`; the webview's HTML drag and drop is taken by Tauri's file drop), and files or folders from the system file manager onto the server pane (upload). Not yet: dragging out of the app into Explorer.
- M4 extras (done): selection count and size in each pane header; message log panel (status bar → Log); automatic reconnect (3 tries, Preferences → Timeouts); images in issues open in an in-app viewer; new issues from the app (title, Markdown with GitHub preview, labels).
- Server load: FTP listings cost a command and a data connection each and hosts rate-limit bursts. Sync lists each folder once per operation (cache), spaces listings out, skips MKD for known folders, and does not re-walk the server after a sync. Keep it that way.
- M3: marker + sync + backups + dialogs.
- M4: GitHub tab. Sign-in: GitHub App device flow (client ID in `src-tauri/src/github.rs`; user tokens do not expire) or a fine-grained personal access token; the token stays in Rust (credential store), the UI calls REST by path. Changes (commit ticked files), History (badges from the marker), fetch / fast-forward pull / push over HTTPS (git2 `https`), Issues and Pull requests (comment, close, reopen, merge, check runs), Backups per site, and after a sync the issues the deployed commits fix are commented on and closed. Issue, pull request and comment bodies: GitHub-rendered Markdown (`body_html`) passed through the app's own allowlist (`lib/markdown.ts`); links open in the browser. Not yet: branch switching, reviews.
- Design stage (after M4, before M5): custom title bar instead of the Windows one, merged with the app's top bar like GitHub Desktop (menus File / Edit / View / Server / Help with shortcuts, own minimize / maximize / close, drag and double-click, Windows 11 snap layouts on the maximize button, resize edges and shadow kept); bundled UI and mono fonts (OFL) so every machine looks the same; one SVG line icon set (file types in the lists, toolbar, a new settings icon); final app icon and installer art; motion (dialog and menu fade, hover and press states, smooth progress, toasts); spacing pass against the mockups in docs/design and a contrast check of the light theme; live accent color; issue and pull request labels in their GitHub colours (label `color`, text contrast picked per label, readable in both themes); empty states and a first-run "create your first site".
- M5: translations, installer, releases.
