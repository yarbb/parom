// Transfers the user started survive a restart or a crash: each one is
// written to the daemon's store (document "queue", written atomically like
// sites and preferences) until it finishes; failed ones stay until the queue
// is cleared. After a restart, connecting to the same server again asks
// whether to continue them. Sync, backup restore and editor uploads are not
// kept: they belong to an operation that cannot be continued blindly.
import { call } from './daemon';

export interface SavedTransfer {
  /** "host:port", as connection.serverKey. */
  server: string;
  /** Site name or "user@host:port", for the question. */
  label: string;
  download: boolean;
  name: string;
  params: Record<string, unknown>;
  failed?: boolean;
}

class QueueStore {
  /** Left over from the last run and not continued or dropped yet. */
  pending = $state<SavedTransfer[]>([]);
  /** This run's transfers, by transfer id. */
  #current = new Map<string, SavedTransfer>();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #loaded = false;

  async load(): Promise<void> {
    try {
      const res = await call<{ value: { items?: SavedTransfer[] } | null }>('store.get', { name: 'queue' });
      this.pending = res.value?.items ?? [];
    } catch {
      this.pending = [];
    }
    this.#loaded = true;
  }

  add(id: string, item: SavedTransfer): void {
    this.#current.set(id, item);
    this.#save();
  }

  /** A transfer ended: done and canceled ones are dropped, failed ones kept. */
  finish(id: string, failed: boolean): void {
    const item = this.#current.get(id);
    if (!item) {
      return;
    }
    if (failed) {
      item.failed = true;
    } else {
      this.#current.delete(id);
    }
    this.#save();
  }

  /** "Clear finished" in the queue panel: failed transfers are gone too. */
  clearFailed(): void {
    for (const [id, item] of this.#current) {
      if (item.failed) {
        this.#current.delete(id);
      }
    }
    this.#save();
  }

  /** The leftovers for a server, removed from the list (continued or dropped by the caller). */
  take(server: string): SavedTransfer[] {
    const mine = this.pending.filter((p) => p.server === server);
    this.pending = this.pending.filter((p) => p.server !== server);
    this.#save();
    return mine;
  }

  /** Writes at most every 800 ms: big folders start many transfers at once. */
  #save(): void {
    if (!this.#loaded || this.#timer) {
      return;
    }
    this.#timer = setTimeout(() => {
      this.#timer = null;
      const items = [...$state.snapshot(this.pending), ...this.#current.values()];
      void call('store.set', { name: 'queue', value: { items } }).catch(() => undefined);
    }, 800);
  }
}

export const queueStore = new QueueStore();
