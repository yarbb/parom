// Several app windows can run at once, each with its own connections. When
// two of them talk to the same server, it sees twice the requests, and hosts
// that limit requests may block for a while; the Files tab warns once per
// connection (Preferences can turn the warning off).
import { invoke, isTauri } from '@tauri-apps/api/core';
import { connection } from './connection.svelte';

/** Seconds between beats; the Rust side treats a window silent for 75 s as closed. */
const BEAT = 30;

class Instances {
  /** Servers the other windows are connected to ("host:port"). */
  others = $state<string[]>([]);
  #timer: ReturnType<typeof setInterval> | null = null;

  async beat(): Promise<void> {
    if (!isTauri()) {
      return;
    }
    try {
      this.others = await invoke<string[]>('instance_beat', { server: connection.serverKey });
    } catch {
      this.others = [];
    }
  }

  start(): () => void {
    void this.beat();
    this.#timer = setInterval(() => void this.beat(), BEAT * 1000);
    return () => {
      if (this.#timer) {
        clearInterval(this.#timer);
      }
    };
  }

  /** True when another window is connected to this window's server. */
  get shared(): boolean {
    const key = connection.serverKey;
    return !!key && this.others.includes(key);
  }
}

export const instances = new Instances();
