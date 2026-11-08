// Windows inside the app (dialogs, Preferences, Site Manager) stack in the
// order they open, so one opened from another (the update window from
// Preferences → Updates) is drawn on top of it. The numbers start again
// once all are closed, so they stay below menus and drop-downs (20 and up).

const BASE = 10;
let open = 0;
let top = BASE;

/** The z-index for a window that just opened; call `closeLayer` when it closes. */
export function openLayer(): number {
  open++;
  top++;
  return top;
}

export function closeLayer(): void {
  open = Math.max(0, open - 1);
  if (open === 0) {
    top = BASE;
  }
}
