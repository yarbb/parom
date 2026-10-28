// The File menu acts on the file pane used last (click or focus) and on its
// selection; each pane registers what it can do.
import type { FileRow } from './files';
import type { PaneSide } from './panedrag.svelte';

export type PaneCommand = 'rename' | 'delete' | 'refresh' | 'mkdir' | 'mkfile';

export interface PaneOps {
  /** False while the pane cannot act (server pane disconnected, local drive list). */
  ready: () => boolean;
  selected: () => FileRow[];
  command: (cmd: PaneCommand, rows: FileRow[]) => void;
  /** Upload (local pane) or download (server pane). */
  transfer: (rows: FileRow[]) => void;
  canTransfer: () => boolean;
  edit: (row: FileRow) => void;
  copyPath: (rows: FileRow[]) => void;
}

class FileOps {
  active = $state<PaneSide>('local');
  #panes = new Map<PaneSide, PaneOps>();

  register(side: PaneSide, ops: PaneOps): () => void {
    this.#panes.set(side, ops);
    return () => this.#panes.delete(side);
  }

  get pane(): PaneOps | undefined {
    return this.#panes.get(this.active);
  }
}

export const fileOps = new FileOps();
