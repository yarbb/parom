// The Files tab's connection: one daemon session, its remote listing,
// questions the engine asks (host key, passwords, file exists) and transfers.
import { call, DaemonError, onEvent, onExit, type DaemonEvent } from './daemon';
import { invoke } from '@tauri-apps/api/core';
import { SvelteSet } from 'svelte/reactivity';
import { queueStore } from './queuestore.svelte';
import { localJoin, parseHost, parseRemoteTime, remoteJoin, type FileRow } from './files';
import { localMkdir, localWalk } from './local';
import { t } from './i18n';
import { addRecent, credentialKey, loadRecent, removeRecent, saveRecent, sameServer, type RecentServer } from './recent';
import { deleteSecret, setSecret } from './secrets';
import type { Site } from './sites.svelte';
import { prefs } from './prefs.svelte';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected';

/** A question from the engine; answered with `answer()`. */
export interface EngineRequest {
  session: number;
  request: number;
  type: string;
  [field: string]: unknown;
}

export interface Transfer {
  id: string;
  download: boolean;
  name: string;
  offset: number;
  total: number;
  /** "running" covers waiting in the queue and moving bytes. */
  state: 'running' | 'done' | 'failed' | 'canceled';
  /** Handed to the daemon (otherwise still waiting in the UI, e.g. during a folder walk). */
  sent: boolean;
  /** Done, but the "file exists" answer meant nothing was transferred. */
  skipped?: boolean;
  error?: string;
  /** Daemon session it was handed to (simultaneous transfers use extra sessions). */
  session?: number;
}

function isCanceled(e: unknown): boolean {
  return e instanceof DaemonError && ((e.data as { flags?: string[] } | undefined)?.flags ?? []).includes('canceled');
}

interface RemoteEntry {
  name: string;
  size: number;
  dir: boolean;
  link: boolean;
  time?: string;
}

export interface ConnectParams {
  host: string;
  user: string;
  password: string;
  port: string;
  /** Keep the password in the OS credential store. */
  remember: boolean;
}

/** A readable reason for a failed daemon call. */
export function describeError(e: unknown): string {
  if (e instanceof DaemonError) {
    const flags = (e.data as { flags?: string[] } | undefined)?.flags ?? [];
    if (flags.includes('password_failed')) {
      return t('files.error.password');
    }
    if (flags.includes('timeout')) {
      return t('files.error.timeout');
    }
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

/** What a dropped session is reopened with (kept in memory only). */
type Reopen = { kind: 'quick'; params: ConnectParams } | { kind: 'site'; site: Site; password: string };

class Connection {
  state = $state<ConnectionState>('disconnected');
  session = $state<number | null>(null);
  /** "user@host:port" for display. */
  label = $state('');
  error = $state('');

  remotePath = $state('');
  remoteRows = $state<FileRow[]>([]);
  /** Server folders listed in this session (others get a "?" folder icon). */
  listed = new SvelteSet<string>();
  /** Last listing of each folder in this session, shown at once when it is opened again. */
  #listings = new Map<string, FileRow[]>();
  remoteLoading = $state(false);
  remoteError = $state('');

  requests = $state<EngineRequest[]>([]);
  transfers = $state<Transfer[]>([]);
  /** The latest engine status line or error, for the status bar. */
  message = $state<{ level: string; text: string } | null>(null);
  /** Recent engine log lines. The array itself is not reactive (it changes
   *  often); `logVersion` changes with it, for the log panel. */
  log: { time: number; level: string; text: string }[] = [];
  logVersion = $state(0);

  clearLog(): void {
    this.log = [];
    this.logVersion++;
  }
  /** Folder uploads or downloads still walking their tree. */
  walks = $state(0);
  /** Files found by the folder walks in progress. */
  scanned = $state(0);
  /** Bumped by "Cancel all" so folder walks in progress stop. */
  #abort = 0;
  /** "File exists" answer chosen with "apply to all"; cleared when the queue drains. */
  existsAll = $state<string | null>(null);

  /** Servers connected to before, newest first. */
  recent = $state<RecentServer[]>(loadRecent());
  /** A server picked in the top bar menu; the Files tab fills its connect bar from it. */
  picked = $state<RecentServer | null>(null);
  /** A saved site to connect to; the Files tab gets its password and calls connectSite(). */
  pickedSite = $state<{ site: Site; password?: string } | null>(null);
  /** The site of the current session, if it came from the Site Manager. */
  site = $state<Site | null>(null);
  /** The site's remote directory as the server resolved it (sync root). */
  siteRoot = $state('');
  /** Local folder the site wants shown; the Files tab opens it. */
  localDirRequest = $state<string | null>(null);

  #nextTransfer = 1;
  #started = false;
  /** How to open the current session again if the server drops it. */
  #reopen: Reopen | null = null;
  /** session.open arguments of the current session, for extra transfer sessions. */
  #openArgs: Record<string, unknown> | null = null;

  /** "host:port" of the open session, the same in every window; null when not connected. */
  get serverKey(): string | null {
    const host = this.#openArgs?.host;
    return this.state === 'connected' && typeof host === 'string' ? `${host.toLowerCase()}:${this.#openArgs?.port ?? ''}` : null;
  }
  /** Extra sessions to the same server for simultaneous transfers, opened per batch. */
  #pool: number[] = [];
  #poolReady: Promise<void> | null = null;
  #poolIdle: ReturnType<typeof setTimeout> | null = null;
  /** Transfers handed to each session and not finished yet. */
  #busy = new Map<number, number>();
  /** Bumped by Disconnect and new connects: stops a pending reconnect. */
  #reconnectGen = 0;
  /** Attempt number while reconnecting (0: not reconnecting). */
  reconnecting = $state(0);
  static readonly reconnectDelays = [2000, 5000, 15000];
  /** Called after a transfer finishes; the Files tab refreshes the target pane. */
  onTransferDone: ((t: Transfer) => void) | null = null;

  /** Subscribes to daemon events once. */
  start(): void {
    if (this.#started) {
      return;
    }
    this.#started = true;
    void onEvent((e) => this.#handle(e));
    void onExit(() => this.#lost());
  }

  #handle(e: DaemonEvent): void {
    const p = e.params;
    switch (e.method) {
      case 'log': {
        const level = String(p.level);
        const text = String(p.message);
        this.log.push({ time: Date.now(), level, text });
        if (this.log.length > 1000) {
          this.log.splice(0, this.log.length - 1000);
        }
        this.logVersion++;
        // Status lines, errors and failing server replies (4xx/5xx) reach the status bar.
        if (level === 'status' || level === 'error' || (level === 'reply' && /^[45]\d\d/.test(text))) {
          this.message = { level, text };
        }
        break;
      }
      case 'request': {
        const req = p as unknown as EngineRequest;
        if (req.type === 'file_exists' && this.existsAll) {
          void this.answer(req, { action: this.existsAll });
        } else {
          this.requests.push(req);
        }
        break;
      }
      case 'transfer.progress': {
        const tr = this.transfers.find((x) => x.id === p.id);
        if (tr && tr.state === 'running') {
          tr.offset = Number(p.offset);
          tr.total = Number(p.total);
        }
        break;
      }
      case 'session.closed':
      case 'session.disconnected':
        if (this.#pool.includes(Number(p.session))) {
          this.#dropFromPool(Number(p.session));
        } else if (p.session === this.session) {
          const dropped = e.method === 'session.disconnected';
          const path = this.remotePath;
          const reopen = this.#reopen;
          this.#lost(dropped ? t('files.error.disconnected') : '');
          if (dropped && reopen && prefs.value.autoReconnect) {
            void this.#reconnect(reopen, path);
          }
        }
        break;
    }
  }

  #lost(reason = ''): void {
    this.#closePool();
    this.#listings.clear();
    this.listed.clear();
    this.#openArgs = null;
    this.state = 'disconnected';
    this.session = null;
    this.site = null;
    this.requests = [];
    this.remoteRows = [];
    this.remotePath = '';
    this.error = reason;
  }

  /** The server dropped the session: open it again a few times, then give up. */
  async #reconnect(reopen: Reopen, path: string): Promise<void> {
    const gen = ++this.#reconnectGen;
    for (let i = 0; i < Connection.reconnectDelays.length; i++) {
      this.reconnecting = i + 1;
      this.error = t('files.reconnecting', { attempt: i + 1, total: Connection.reconnectDelays.length });
      await new Promise((r) => setTimeout(r, Connection.reconnectDelays[i]));
      if (gen !== this.#reconnectGen || this.state !== 'disconnected') {
        break;
      }
      if (reopen.kind === 'site') {
        await this.connectSite(reopen.site, reopen.password, true);
      } else {
        await this.connect(reopen.params, true);
      }
      // connect() changed the state meanwhile (TypeScript cannot see that).
      if ((this.state as string) === 'connected') {
        if (path) {
          await this.list(path);
        }
        this.reconnecting = 0;
        this.error = '';
        return;
      }
    }
    this.reconnecting = 0;
    if (gen === this.#reconnectGen && this.state === 'disconnected') {
      this.error = t('files.reconnect_failed');
    }
  }

  async connect(params: ConnectParams, retry = false): Promise<void> {
    if (this.state !== 'disconnected') {
      return;
    }
    if (!retry) {
      this.#reconnectGen++;
      this.reconnecting = 0;
    }
    const target = parseHost(params.host, params.port);
    if (!target.host) {
      return;
    }
    this.state = 'connecting';
    this.error = '';
    const user = params.user.trim();
    this.label = `${user ? `${user}@` : ''}${target.host}${target.port ? `:${target.port}` : ''}`;
    try {
      const args = {
        protocol: target.protocol,
        host: target.host,
        port: target.port,
        user,
        password: params.password,
        timeout: prefs.value.connectTimeout,
      };
      const res = await call<{ session: number }>('session.open', args);
      this.session = res.session;
      this.state = 'connected';
      this.#openArgs = args;
      this.#reopen = { kind: 'quick', params: { ...params } };
      const port = Number.isFinite(target.port) ? target.port : undefined;
      await this.#remember({ protocol: target.protocol, host: target.host, port, user }, params);
      void prefs.set('lastConnection', { type: 'quick' });
      await this.list();
    } catch (e) {
      this.state = 'disconnected';
      this.session = null;
      this.error = t('files.error.connect', { reason: describeError(e) });
    }
  }

  /** Connects with a saved site's settings. `password` is ignored for key and anonymous logons. */
  async connectSite(site: Site, password: string, retry = false): Promise<void> {
    if (this.state !== 'disconnected' || !site.host.trim()) {
      return;
    }
    if (!retry) {
      this.#reconnectGen++;
      this.reconnecting = 0;
    }
    this.state = 'connecting';
    this.error = '';
    this.label = `${site.name} (${site.user ? `${site.user}@` : ''}${site.host}${site.port ? `:${site.port}` : ''})`;
    const params: Record<string, unknown> = {
      protocol: site.protocol,
      host: site.host.trim(),
      port: site.port,
      timeout: site.timeout ?? prefs.value.connectTimeout,
      pace_ms: site.pace ?? 0,
    };
    if (site.logon !== 'anonymous') {
      params.user = site.user;
    }
    if (site.logon === 'key') {
      params.keyfile = site.keyfile;
    } else if (site.logon !== 'anonymous') {
      params.password = password;
    }
    try {
      const res = await call<{ session: number }>('session.open', params);
      this.session = res.session;
      this.state = 'connected';
      this.site = site;
      this.#openArgs = params;
      this.#reopen = { kind: 'site', site, password };
      void prefs.set('lastConnection', { type: 'site', id: site.id });
      await this.list(site.remoteDir.trim() || undefined);
      this.siteRoot = this.remotePath;
      if (site.localDir.trim()) {
        this.localDirRequest = site.localDir.trim();
      }
    } catch (e) {
      this.state = 'disconnected';
      this.session = null;
      this.error = t('files.error.connect', { reason: describeError(e) });
    }
  }

  /** Updates the recent list and the stored password after a successful connect. */
  async #remember(server: RecentServer, params: ConnectParams): Promise<void> {
    const key = credentialKey(server);
    let remember = params.remember && params.password !== '';
    try {
      if (remember) {
        await setSecret(key, params.password);
      } else {
        await deleteSecret(key);
      }
    } catch (e) {
      remember = false;
      this.error = t('files.error.remember', { reason: String(e) });
    }

    const before = this.recent;
    this.recent = addRecent(before, { ...server, remember });
    saveRecent(this.recent);
    // Entries pushed off the list take their passwords with them.
    for (const old of before) {
      if (old.remember && !this.recent.some((s) => sameServer(s, old))) {
        void deleteSecret(credentialKey(old)).catch(() => {});
      }
    }
  }

  async disconnect(): Promise<void> {
    // Also stops a pending reconnect.
    this.#reconnectGen++;
    this.reconnecting = 0;
    this.#reopen = null;
    const session = this.session;
    if (session === null) {
      return;
    }
    try {
      await call('session.close', { session });
    } catch {
      // The session is gone either way.
    }
    this.#lost();
  }

  /** Lists a server folder; `quiet` (synchronized browsing) keeps the pane as it is when that fails. */
  async list(path?: string, quiet = false): Promise<void> {
    const session = this.session;
    if (session === null) {
      return;
    }
    this.remoteLoading = true;
    if (!quiet) {
      this.remoteError = '';
    }
    const cached = path ? this.#listings.get(path) : undefined;
    if (path && cached) {
      // Seen before in this session: show it now, the fresh listing follows.
      this.remotePath = path;
      this.remoteRows = cached;
    }
    try {
      const res = await call<{ path: string; entries: RemoteEntry[] }>('remote.list', path ? { session, path } : { session });
      if (session !== this.session) {
        return;
      }
      const rows = res.entries.map((e) => ({
        name: e.name,
        size: e.size,
        dir: e.dir,
        link: e.link,
        time: parseRemoteTime(e.time),
      }));
      this.#listings.set(res.path, rows);
      this.listed.add(res.path);
      this.remotePath = res.path;
      this.remoteRows = rows;
    } catch (e) {
      if (!quiet) {
        this.remoteError = describeError(e);
      }
    } finally {
      this.remoteLoading = false;
    }
  }

  /**
   * Folder names inside a server folder, for path suggestions: from the
   * listings this session already has, else one listing of that folder (kept
   * like any other, so it is not asked for again). The pane stays as it is.
   */
  async peekDirs(path: string): Promise<string[] | null> {
    const dir = path.length > 1 ? path.replace(/\/+$/, '') : path;
    const cached = this.#listings.get(dir);
    if (cached) {
      return cached.filter((r) => r.dir).map((r) => r.name);
    }
    const session = this.session;
    if (session === null) {
      return null;
    }
    try {
      const res = await call<{ path: string; entries: RemoteEntry[] }>('remote.list', { session, path: dir });
      const rows = res.entries.map((e) => ({ name: e.name, size: e.size, dir: e.dir, link: e.link, time: parseRemoteTime(e.time) }));
      this.#listings.set(res.path, rows);
      this.listed.add(res.path);
      return rows.filter((r) => r.dir).map((r) => r.name);
    } catch {
      return null;
    }
  }

  /** Answers a "file exists" question, optionally for every other one in this queue too. */
  async answerExists(req: EngineRequest, action: string, applyToAll: boolean): Promise<void> {
    if (applyToAll) {
      this.existsAll = action;
      for (const other of this.requests.filter((r) => r !== req && r.type === 'file_exists')) {
        void this.answer(other, { action });
      }
    }
    await this.answer(req, { action });
  }

  async answer(req: EngineRequest, reply: Record<string, unknown>): Promise<void> {
    this.requests = this.requests.filter((r) => r !== req);
    try {
      await call('request.reply', { session: req.session, request: req.request, ...reply });
    } catch {
      // The request may have been dropped with its session.
    }
  }

  /** Adds a row to the queue panel; the transfer starts with #run(). */
  #addRow(download: boolean, name: string): Transfer {
    this.transfers.push({ id: `t${this.#nextTransfer++}`, download, name, offset: 0, total: -1, state: 'running', sent: false });
    return this.transfers[this.transfers.length - 1];
  }

  /** How many transfers may run at once: Preferences, but one for sites that pace requests. */
  get #limit(): number {
    return (this.site?.pace ?? 0) > 0 ? 1 : Math.max(1, Math.min(5, prefs.value.simultaneous));
  }

  /** Opens the extra sessions for a batch once; failures just mean fewer slots. */
  #ensurePool(): Promise<void> {
    if (this.#poolIdle) {
      clearTimeout(this.#poolIdle);
      this.#poolIdle = null;
    }
    const want = this.#limit - 1 - this.#pool.length;
    if (want <= 0 || !this.#openArgs) {
      return Promise.resolve();
    }
    this.#poolReady ??= (async () => {
      const args = this.#openArgs!;
      const opened = await Promise.all(
        Array.from({ length: want }, () =>
          call<{ session: number }>('session.open', args).then(
            (r) => r.session,
            () => null,
          ),
        ),
      );
      if (this.#openArgs === args) {
        this.#pool.push(...opened.filter((id): id is number => id !== null));
      } else {
        // Disconnected meanwhile.
        opened.forEach((id) => id !== null && void call('session.close', { session: id }).catch(() => {}));
      }
      this.#poolReady = null;
    })();
    return this.#poolReady;
  }

  /** The least busy session: the main one or an extra one. */
  #pickSession(): number | null {
    if (this.session === null) {
      return null;
    }
    let best = this.session;
    for (const id of this.#pool) {
      if ((this.#busy.get(id) ?? 0) < (this.#busy.get(best) ?? 0)) {
        best = id;
      }
    }
    return best;
  }

  #dropFromPool(id: number): void {
    this.#pool = this.#pool.filter((x) => x !== id);
    this.#busy.delete(id);
    void call('session.close', { session: id }).catch(() => {});
  }

  #closePool(): void {
    if (this.#poolIdle) {
      clearTimeout(this.#poolIdle);
      this.#poolIdle = null;
    }
    for (const id of this.#pool) {
      void call('session.close', { session: id }).catch(() => {});
    }
    this.#pool = [];
    this.#busy.clear();
  }

  /** `persist`: a transfer the user started; kept in the queue store until it finishes. */
  async #run(tr: Transfer, params: Record<string, unknown>, persist = false): Promise<Transfer> {
    if (persist) {
      queueStore.add(tr.id, {
        server: this.serverKey ?? '',
        label: this.site?.name || this.label,
        download: tr.download,
        name: tr.name,
        params: { ...params },
      });
    }
    if (tr.state === 'canceled') {
      queueStore.finish(tr.id, false);
      this.onTransferDone?.(tr);
      return tr;
    }
    await this.#ensurePool();
    const session = this.#pickSession();
    // Canceled while the extra sessions opened (TypeScript cannot see that).
    if ((tr.state as Transfer['state']) === 'canceled') {
      queueStore.finish(tr.id, tr.state === 'failed');
      this.onTransferDone?.(tr);
      return tr;
    }
    if (session === null) {
      tr.state = 'failed';
      tr.error = t('status.disconnected');
      queueStore.finish(tr.id, tr.state === 'failed');
      this.onTransferDone?.(tr);
      return tr;
    }
    tr.sent = true;
    tr.session = session;
    this.#busy.set(session, (this.#busy.get(session) ?? 0) + 1);
    // A site can answer "file exists" for all its transfers.
    const preset = this.site && this.site.exists !== 'ask' ? this.site.exists : prefs.value.existsDefault;
    const exists = preset !== 'ask' ? { exists: preset } : {};
    try {
      const res = await call<{ size: number; skipped?: boolean }>(
        tr.download ? 'transfer.download' : 'transfer.upload',
        { session, ...exists, ...params },
        tr.id,
      );
      tr.state = 'done';
      tr.skipped = !!res.skipped;
      tr.offset = tr.total = res.size;
    } catch (e) {
      tr.state = isCanceled(e) ? 'canceled' : 'failed';
      tr.error = describeError(e);
    }
    this.#busy.set(session, Math.max(0, (this.#busy.get(session) ?? 1) - 1));
    if (!this.transfers.some((x) => x.state === 'running') && this.walks === 0) {
      this.existsAll = null;
      // Idle extra sessions are closed before the server times them out.
      if (this.#pool.length && !this.#poolIdle) {
        this.#poolIdle = setTimeout(() => this.#closePool(), 20_000);
      }
    }
    queueStore.finish(tr.id, tr.state === 'failed');
      this.onTransferDone?.(tr);
    return tr;
  }

  /** Queues an upload or download; the daemon runs a session's commands in order. */
  transfer(download: boolean, name: string, params: Record<string, unknown>, persist = false): Promise<Transfer> {
    return this.#run(this.#addRow(download, name), params, persist);
  }

  /** Cancels one transfer, whether it is moving bytes or still waiting. */
  async cancel(tr: Transfer): Promise<void> {
    if (tr.state !== 'running') {
      return;
    }
    if (!tr.sent || this.session === null) {
      tr.state = 'canceled';
      return;
    }
    try {
      await call('session.cancel_request', { session: tr.session ?? this.session, id: tr.id });
    } catch {
      // Already finished; its own result stands.
    }
  }

  /** Cancels everything still running, newest first so nothing new starts meanwhile, and stops folder walks. */
  async cancelAll(): Promise<void> {
    this.#abort++;
    const running = this.transfers.filter((x) => x.state === 'running').reverse();
    for (const tr of running) {
      await this.cancel(tr);
    }
  }
  /** Picks a recent server; disconnects first if needed. */
  async pick(server: RecentServer): Promise<void> {
    if (this.state === 'connected') {
      await this.disconnect();
    }
    this.picked = { ...server };
  }

  forget(server: RecentServer): void {
    this.recent = removeRecent(this.recent, server);
    saveRecent(this.recent);
    if (server.remember) {
      void deleteSecret(credentialKey(server)).catch(() => {});
    }
  }

  /** Uploads a local folder into `remotePath`, creating the folder tree first. */
  /** Uploads a folder; true when every file arrived (none failed, canceled or skipped). */
  async uploadFolder(localDir: string, separator: string, name: string, remotePath: string): Promise<boolean> {
    const session = this.session;
    if (session === null) {
      return false;
    }
    const gen = this.#abort;
    this.walks++;
    let rows: { rel: string; row: Transfer }[] = [];
    const root = remoteJoin(remotePath, name);
    try {
      const tree = await localWalk(localDir);
      if (gen !== this.#abort) {
        return false;
      }
      // Every file is in the queue before anything moves, so the count is final.
      rows = tree.files.map((rel) => ({ rel, row: this.#addRow(false, `${name}/${rel}`) }));
      for (const dir of [root, ...tree.dirs.map((d) => remoteJoin(root, d))]) {
        if (gen !== this.#abort) {
          break;
        }
        // Existing folders make mkdir fail; that is fine.
        await call('remote.mkdir', { session, path: dir }).catch(() => {});
      }
    } catch (e) {
      this.remoteError = String(e);
      return false;
    } finally {
      this.#walkDone();
    }
    if (gen !== this.#abort) {
      rows.forEach(({ row }) => (row.state = 'canceled'));
      return false;
    }
    const toLocal = (rel: string) => localJoin(localDir, rel.split('/').join(separator), separator);
    await Promise.all(
      rows.map(({ rel, row }) => {
        const slash = rel.lastIndexOf('/');
        const dir = slash < 0 ? root : remoteJoin(root, rel.slice(0, slash));
        return this.#run(row, { local: toLocal(rel), remote_path: dir, remote_name: rel.slice(slash + 1) }, true);
      }),
    );
    return rows.every(({ row }) => row.state === 'done' && !row.skipped);
  }

  /**
   * Downloads a remote folder into `localDir`. The whole tree is listed first
   * (the queue header shows the count growing), then every file is queued at
   * once, so the queue's total is right from the first transfer.
   */
  /** Downloads a folder; true when every file arrived (none failed, canceled or skipped). */
  async downloadFolder(remotePath: string, name: string, localDir: string, separator: string): Promise<boolean> {
    const session = this.session;
    if (session === null) {
      return false;
    }
    let complete = true;
    const gen = this.#abort;
    this.walks++;
    const files: { remote: string; name: string; local: string; rel: string }[] = [];
    const pending: { remote: string; local: string; rel: string }[] = [
      { remote: remoteJoin(remotePath, name), local: localJoin(localDir, name, separator), rel: name },
    ];
    try {
      while (pending.length && gen === this.#abort) {
        const dir = pending.shift()!;
        try {
          await localMkdir(dir.local);
          const res = await call<{ entries: RemoteEntry[] }>('remote.list', { session, path: dir.remote });
          for (const e of res.entries) {
            if (e.link && e.dir) {
              continue; // Do not follow links to folders: they can loop.
            }
            const next = { remote: remoteJoin(dir.remote, e.name), local: localJoin(dir.local, e.name, separator), rel: `${dir.rel}/${e.name}` };
            if (e.dir) {
              pending.push(next);
            } else {
              files.push({ remote: dir.remote, name: e.name, local: next.local, rel: next.rel });
              this.scanned++;
            }
          }
        } catch (e) {
          complete = false;
          this.remoteError = `${dir.rel}: ${describeError(e)}`;
        }
      }
    } finally {
      this.#walkDone();
    }
    if (gen !== this.#abort) {
      return false;
    }
    const rows = files.map((f) => ({ f, row: this.#addRow(true, f.rel) }));
    await Promise.all(rows.map(({ f, row }) => this.#run(row, { remote_path: f.remote, remote_name: f.name, local: f.local }, true)));
    return complete && rows.every(({ row }) => row.state === 'done' && !row.skipped);
  }

  #walkDone(): void {
    this.walks--;
    if (this.walks === 0) {
      this.scanned = 0;
    }
  }
  /** Runs a remote file operation in the current folder and refreshes it. */
  async #remoteOp(op: (session: number, path: string) => Promise<unknown>): Promise<boolean> {
    const session = this.session;
    if (session === null) {
      return false;
    }
    const path = this.remotePath;
    let failure = '';
    try {
      await op(session, path);
    } catch (e) {
      failure = describeError(e);
    }
    await this.list(path);
    // list() clears the error line; show why the operation failed.
    if (failure) {
      this.remoteError = failure;
    }
    return !failure;
  }

  renameRemote(from: string, to: string): Promise<boolean> {
    return this.#remoteOp((session, path) =>
      call('remote.rename', { session, from_path: path, from_name: from, to_path: path, to_name: to }),
    );
  }

  mkdirRemote(name: string): Promise<boolean> {
    return this.#remoteOp((session, path) => call('remote.mkdir', { session, path: remoteJoin(path, name) }));
  }

  /** Creates an empty file in the current folder (uploads an empty temp file). */
  mkfileRemote(name: string): Promise<boolean> {
    return this.#remoteOp(async (session, path) => {
      if (this.remoteRows.some((r) => r.name === name)) {
        throw new Error(`${name} already exists`);
      }
      const dir = await invoke<string>('edit_new_dir');
      const local = localJoin(dir, name, dir.includes('\\') ? '\\' : '/');
      await invoke('write_small_file', { path: local, content: '' });
      await call('transfer.upload', { session, local, remote_path: path, remote_name: name, exists: 'skip' });
    });
  }

  /** Deletes files and whole folders (contents first, deepest folders last). */
  deleteRemote(rows: FileRow[]): Promise<boolean> {
    return this.#remoteOp(async (session, path) => {
      const files = rows.filter((r) => !r.dir || r.link).map((r) => r.name);
      if (files.length) {
        await call('remote.delete', { session, path, names: files });
      }
      for (const dir of rows.filter((r) => r.dir && !r.link)) {
        await this.#deleteTree(session, path, dir.name);
      }
    });
  }

  async #deleteTree(session: number, parent: string, name: string): Promise<void> {
    const dir = remoteJoin(parent, name);
    const res = await call<{ entries: RemoteEntry[] }>('remote.list', { session, path: dir });
    const files = res.entries.filter((e) => !e.dir || e.link).map((e) => e.name);
    if (files.length) {
      await call('remote.delete', { session, path: dir, names: files });
    }
    for (const sub of res.entries.filter((e) => e.dir && !e.link)) {
      await this.#deleteTree(session, dir, sub.name);
    }
    await call('remote.rmdir', { session, path: parent, name });
  }

  clearFinished(): void {
    queueStore.clearFailed();
    this.transfers = this.transfers.filter((x) => x.state === 'running');
  }
}

export const connection = new Connection();
