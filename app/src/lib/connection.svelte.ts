// The Files tab's connection: one daemon session, its remote listing,
// questions the engine asks (host key, passwords, file exists) and transfers.
import { call, DaemonError, onEvent, onExit, type DaemonEvent } from './daemon';
import { localJoin, parseHost, parseRemoteTime, remoteJoin, type FileRow } from './files';
import { localMkdir, localWalk } from './local';
import { t } from './i18n';
import { addRecent, credentialKey, loadRecent, removeRecent, saveRecent, sameServer, type RecentServer } from './recent';
import { deleteSecret, setSecret } from './secrets';

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
  error?: string;
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

class Connection {
  state = $state<ConnectionState>('disconnected');
  session = $state<number | null>(null);
  /** "user@host:port" for display. */
  label = $state('');
  error = $state('');

  remotePath = $state('');
  remoteRows = $state<FileRow[]>([]);
  remoteLoading = $state(false);
  remoteError = $state('');

  requests = $state<EngineRequest[]>([]);
  transfers = $state<Transfer[]>([]);
  /** "File exists" answer chosen with "apply to all"; cleared when the queue drains. */
  existsAll = $state<string | null>(null);

  /** Servers connected to before, newest first. */
  recent = $state<RecentServer[]>(loadRecent());
  /** A server picked in the top bar menu; the Files tab fills its connect bar from it. */
  picked = $state<RecentServer | null>(null);

  #nextTransfer = 1;
  #started = false;
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
        if (p.session === this.session) {
          this.#lost(e.method === 'session.disconnected' ? t('files.error.disconnected') : '');
        }
        break;
    }
  }

  #lost(reason = ''): void {
    this.state = 'disconnected';
    this.session = null;
    this.requests = [];
    this.remoteRows = [];
    this.remotePath = '';
    this.error = reason;
  }

  async connect(params: ConnectParams): Promise<void> {
    if (this.state !== 'disconnected') {
      return;
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
      const res = await call<{ session: number }>('session.open', {
        protocol: target.protocol,
        host: target.host,
        port: target.port,
        user,
        password: params.password,
      });
      this.session = res.session;
      this.state = 'connected';
      const port = Number.isFinite(target.port) ? target.port : undefined;
      await this.#remember({ protocol: target.protocol, host: target.host, port, user }, params);
      await this.list();
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

  async list(path?: string): Promise<void> {
    const session = this.session;
    if (session === null) {
      return;
    }
    this.remoteLoading = true;
    this.remoteError = '';
    try {
      const res = await call<{ path: string; entries: RemoteEntry[] }>('remote.list', path ? { session, path } : { session });
      this.remotePath = res.path;
      this.remoteRows = res.entries.map((e) => ({
        name: e.name,
        size: e.size,
        dir: e.dir,
        link: e.link,
        time: parseRemoteTime(e.time),
      }));
    } catch (e) {
      this.remoteError = describeError(e);
    } finally {
      this.remoteLoading = false;
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

  async #run(tr: Transfer, params: Record<string, unknown>): Promise<void> {
    const session = this.session;
    if (tr.state === 'canceled') {
      this.onTransferDone?.(tr);
      return;
    }
    if (session === null) {
      tr.state = 'failed';
      tr.error = t('status.disconnected');
      this.onTransferDone?.(tr);
      return;
    }
    tr.sent = true;
    try {
      const res = await call<{ size: number }>(tr.download ? 'transfer.download' : 'transfer.upload', { session, ...params }, tr.id);
      tr.state = 'done';
      tr.offset = tr.total = res.size;
    } catch (e) {
      tr.state = isCanceled(e) ? 'canceled' : 'failed';
      tr.error = describeError(e);
    }
    if (!this.transfers.some((x) => x.state === 'running')) {
      this.existsAll = null;
    }
    this.onTransferDone?.(tr);
  }

  /** Queues an upload or download; the daemon runs a session's commands in order. */
  transfer(download: boolean, name: string, params: Record<string, unknown>): Promise<void> {
    return this.#run(this.#addRow(download, name), params);
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
      await call('session.cancel_request', { session: this.session, id: tr.id });
    } catch {
      // Already finished; its own result stands.
    }
  }

  /** Cancels everything still running, newest first so nothing new starts meanwhile. */
  async cancelAll(): Promise<void> {
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
  async uploadFolder(localDir: string, separator: string, name: string, remotePath: string): Promise<void> {
    const session = this.session;
    if (session === null) {
      return;
    }
    let tree: { dirs: string[]; files: string[] };
    try {
      tree = await localWalk(localDir);
    } catch (e) {
      this.remoteError = String(e);
      return;
    }
    const root = remoteJoin(remotePath, name);
    // Show every file in the queue right away; creating the folders can take a while.
    const rows = tree.files.map((rel) => ({ rel, row: this.#addRow(false, `${name}/${rel}`) }));
    for (const dir of [root, ...tree.dirs.map((d) => remoteJoin(root, d))]) {
      // Existing folders make mkdir fail; that is fine.
      await call('remote.mkdir', { session, path: dir }).catch(() => {});
    }
    const toLocal = (rel: string) => localJoin(localDir, rel.split('/').join(separator), separator);
    await Promise.all(
      rows.map(({ rel, row }) => {
        const slash = rel.lastIndexOf('/');
        const dir = slash < 0 ? root : remoteJoin(root, rel.slice(0, slash));
        return this.#run(row, { local: toLocal(rel), remote_path: dir, remote_name: rel.slice(slash + 1) });
      }),
    );
  }

  /** Downloads a remote folder into `localDir`, walking it breadth first. */
  async downloadFolder(remotePath: string, name: string, localDir: string, separator: string): Promise<void> {
    const session = this.session;
    if (session === null) {
      return;
    }
    const jobs: Promise<void>[] = [];
    const pending: { remote: string; local: string; rel: string }[] = [
      { remote: remoteJoin(remotePath, name), local: localJoin(localDir, name, separator), rel: name },
    ];
    while (pending.length) {
      const dir = pending.shift()!;
      try {
        await localMkdir(dir.local);
        const res = await call<{ entries: RemoteEntry[] }>('remote.list', { session, path: dir.remote });
        for (const e of res.entries) {
          if (e.link && e.dir) {
            continue; // Do not follow links to folders: they can loop.
          }
          const next = {
            remote: remoteJoin(dir.remote, e.name),
            local: localJoin(dir.local, e.name, separator),
            rel: `${dir.rel}/${e.name}`,
          };
          if (e.dir) {
            pending.push(next);
          } else {
            jobs.push(this.transfer(true, next.rel, { remote_path: dir.remote, remote_name: e.name, local: next.local }));
          }
        }
      } catch (e) {
        this.remoteError = `${dir.rel}: ${describeError(e)}`;
      }
    }
    await Promise.all(jobs);
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
    this.transfers = this.transfers.filter((x) => x.state === 'running');
  }
}

export const connection = new Connection();
