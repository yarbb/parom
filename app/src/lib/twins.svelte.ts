// Folders with the same name on both sides are tinted grey (Preferences →
// File lists): they show where the two sides match and which folders
// synchronized browsing can follow.
import { connection } from './connection.svelte';

class Twins {
  /** Folder names in the local pane (none while it shows the drives). */
  local = $state<string[]>([]);

  /** Folder names in the server pane, while connected. */
  get remote(): string[] {
    return connection.state === 'connected' ? connection.remoteRows.filter((r) => r.dir).map((r) => r.name) : [];
  }
}

export const twins = new Twins();

/** Tint of a folder that has a twin; manual colour labels win over it. */
export const twinColor = 'var(--muted)';
