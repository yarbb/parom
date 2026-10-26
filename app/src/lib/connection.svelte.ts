// The Files tab's connection: one daemon session, its remote listing,
// questions the engine asks (host key, passwords, file exists) and transfers.
import { call, DaemonError, onEvent, onExit, type DaemonEvent } from './daemon';
import { parseHost, parseRemoteTime, type FileRow } from './files';
import { t } from './i18n';

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
  state: 'running' | 'done' | 'failed';
  error?: string;
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
      case 'request':
        this.requests.push(p as unknown as EngineRequest);
        break;
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
      await this.list();
    } catch (e) {
      this.state = 'disconnected';
      this.session = null;
      this.error = t('files.error.connect', { reason: describeError(e) });
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

  async answer(req: EngineRequest, reply: Record<string, unknown>): Promise<void> {
    this.requests = this.requests.filter((r) => r !== req);
    try {
      await call('request.reply', { session: req.session, request: req.request, ...reply });
    } catch {
      // The request may have been dropped with its session.
    }
  }

  /** Queues an upload or download; the daemon runs a session's commands in order. */
  async transfer(download: boolean, name: string, params: Record<string, unknown>): Promise<void> {
    const session = this.session;
    if (session === null) {
      return;
    }
    const id = `t${this.#nextTransfer++}`;
    this.transfers.push({ id, download, name, offset: 0, total: -1, state: 'running' });
    const tr = this.transfers[this.transfers.length - 1];
    try {
      const res = await call<{ size: number }>(download ? 'transfer.download' : 'transfer.upload', { session, ...params }, id);
      tr.state = 'done';
      tr.offset = tr.total = res.size;
    } catch (e) {
      tr.state = 'failed';
      tr.error = describeError(e);
    }
    this.onTransferDone?.(tr);
  }

  clearFinished(): void {
    this.transfers = this.transfers.filter((x) => x.state === 'running');
  }
}

export const connection = new Connection();
