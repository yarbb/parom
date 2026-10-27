// Dragging files between the local and server panes. The webview's own
// drag and drop is taken by file drops from the system (Tauri), so rows are
// dragged with plain mouse events instead.
import type { FileRow } from './files';

export type PaneSide = 'local' | 'server';

/** Pixels the mouse moves before a press on a row becomes a drag. */
export const dragThreshold = 6;

/** The pane under a window point (panes carry `data-pane`). */
export function paneAt(x: number, y: number): PaneSide | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-pane]');
  const side = el?.dataset.pane;
  return side === 'local' || side === 'server' ? side : null;
}

class PaneDrag {
  /** Rows being dragged and where the mouse is. */
  active = $state<{ from: PaneSide; rows: FileRow[]; x: number; y: number } | null>(null);
  /** Pane under the mouse while dragging (files from the system included). */
  over = $state<PaneSide | null>(null);
  /** Files dragged in from the system, while over the window. */
  external = $state(false);
  /** Set by the Files tab: transfers dropped rows to the other pane. */
  onDrop: ((from: PaneSide, rows: FileRow[]) => void) | null = null;

  move(x: number, y: number): void {
    if (this.active) {
      this.active.x = x;
      this.active.y = y;
    }
    this.over = paneAt(x, y);
  }

  end(): void {
    const a = this.active;
    const to = this.over;
    this.active = null;
    this.over = null;
    if (a && to && to !== a.from) {
      this.onDrop?.(a.from, a.rows);
    }
  }
}

export const paneDrag = new PaneDrag();
