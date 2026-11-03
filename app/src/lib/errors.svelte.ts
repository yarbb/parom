// One place for the errors the app shows outside dialogs (GitHub tab, sync
// bar, connect bar, file lists, server replies in the status bar). The short
// red line where it happened stays; a click on it opens the error window with
// the whole text (selectable, Copy); long errors open it by themselves; recent
// errors can be reopened from the status bar ("Errors").
import { untrack } from 'svelte';

export type ErrorSource = 'github' | 'sync' | 'connection' | 'files' | 'server' | 'update' | 'editor';

export interface AppError {
  id: number;
  source: ErrorSource;
  text: string;
  /** ms since the epoch. */
  time: number;
}

/** Too long for one line, or several lines: worth its own window. */
export const isLong = (text: string) => text.length > 90 || text.includes('\n');

const KEEP = 50;

class Errors {
  /** Newest first. */
  recent = $state<AppError[]>([]);
  /** The error the window shows; null with the window closed. */
  shown = $state<AppError | null>(null);
  /** Errors since the window was last open (the status bar button's count). */
  unseen = $state(0);
  #next = 1;

  /** Records an error; `open` (default: long ones) opens the window. Returns the text. */
  report(source: ErrorSource, e: unknown, open?: boolean): string {
    const text = String(e instanceof Error ? e.message : e)
      .replace(/^Error: /, '')
      .trim();
    if (!text) {
      return text;
    }
    // The same error again (a retry, or two places showing it): one entry.
    const same = this.recent.find((r) => r.source === source && r.text === text && Date.now() - r.time < 10_000);
    const entry = same ?? { id: this.#next++, source, text, time: Date.now() };
    if (!same) {
      this.recent = [entry, ...this.recent].slice(0, KEEP);
      this.unseen++;
    }
    if (open ?? isLong(text)) {
      this.show(entry);
    }
    return text;
  }

  /** Opens the window on an error (one from the list, or a line clicked where it is shown). */
  show(entry: AppError | { source: ErrorSource; text: string }): void {
    const known = 'id' in entry ? entry : this.recent.find((r) => r.source === entry.source && r.text === entry.text);
    this.shown = known ?? { id: this.#next++, time: Date.now(), ...entry };
    this.unseen = 0;
  }

  /** Opens the window on the newest error. */
  showRecent(): void {
    if (this.recent[0]) {
      this.show(this.recent[0]);
    }
  }

  close(): void {
    this.shown = null;
  }

  clear(): void {
    this.recent = [];
    this.shown = null;
    this.unseen = 0;
  }
}

export const errors = new Errors();

/**
 * Records the errors a store or prop shows as they appear (call while a
 * component is set up). `open: false` never opens the window by itself.
 */
export function trackErrors(source: ErrorSource, get: () => string | null | undefined, open?: boolean): void {
  $effect(() => {
    const text = get();
    if (text) {
      untrack(() => errors.report(source, text, open));
    }
  });
}
