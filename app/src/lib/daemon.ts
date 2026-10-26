// Bridge to totzillad through the Tauri backend (see daemon/PROTOCOL.md).
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface DaemonEvent {
  method: string;
  params: Record<string, unknown>;
}

export class DaemonError extends Error {
  constructor(
    public code: number,
    message: string,
    public data?: unknown,
  ) {
    super(message);
  }
}

interface RpcError {
  code?: number;
  message?: string;
  data?: unknown;
}

export async function call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!isTauri()) {
    throw new DaemonError(-32099, 'Not running inside the desktop app');
  }
  try {
    return await invoke<T>('daemon_call', { method, params });
  } catch (e) {
    const err = (typeof e === 'object' && e !== null ? e : { message: String(e) }) as RpcError;
    throw new DaemonError(err.code ?? -32099, err.message ?? 'Unknown error', err.data);
  }
}

export async function onEvent(handler: (event: DaemonEvent) => void): Promise<UnlistenFn> {
  if (!isTauri()) {
    return () => {};
  }
  return listen<DaemonEvent>('daemon-event', (e) => handler(e.payload));
}

export async function onExit(handler: () => void): Promise<UnlistenFn> {
  if (!isTauri()) {
    return () => {};
  }
  return listen('daemon-exit', () => handler());
}
