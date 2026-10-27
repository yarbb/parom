// App commands shared by the menu bar and the keyboard shortcuts.
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '@tauri-apps/api/core';
import { connection } from './connection.svelte';
import { openGitHub } from './github.svelte';
import { applyPrefs, prefs } from './prefs.svelte';
import { sites } from './sites.svelte';
import { sync } from './sync/engine.svelte';
import type { ThemeChoice } from './theme';
import { ui } from './ui.svelte';

/** The project's page; issues go to its tracker. */
export const PROJECT_URL = 'https://github.com/yarbb/parom';

/** Connects to the last server again (a saved site, else the newest quick connection). */
export function reconnectLast(): void {
  if (connection.state !== 'disconnected') {
    return;
  }
  const last = prefs.value.lastConnection;
  const site = last?.type === 'site' ? sites.list.find((s) => s.id === last.id) : undefined;
  if (site) {
    connection.pickedSite = { site };
  } else if (connection.recent[0]) {
    void connection.pick(connection.recent[0]);
  }
}

export function zoom(step: number | null): void {
  prefs.value.fontScale = step === null ? 100 : Math.max(70, Math.min(200, prefs.value.fontScale + step));
  applyPrefs(prefs.value);
  void prefs.persist();
}

export function setTheme(theme: ThemeChoice): void {
  prefs.value.theme = theme;
  applyPrefs(prefs.value);
  void prefs.persist();
}

/**
 * Edit commands act on the element that had the focus before the menu
 * opened (`target`): text fields get the usual clipboard commands; "Select
 * all" in a file list selects its rows.
 */
export async function editCommand(command: 'cut' | 'copy' | 'paste' | 'selectAll', target: Element | null): Promise<void> {
  const el = target instanceof HTMLElement ? target : null;
  el?.focus();
  if (command === 'paste') {
    const text = await navigator.clipboard.readText().catch(() => '');
    if (text && el?.matches('input, textarea')) {
      document.execCommand('insertText', false, text);
    }
  } else if (command === 'selectAll') {
    if (el?.matches('input, textarea')) {
      (el as HTMLInputElement).select();
    } else if (el) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
    }
  } else {
    document.execCommand(command);
  }
}

export const closeWindow = () => (isTauri() ? getCurrentWindow().close() : undefined);
export const openProject = (path = '') => openGitHub(`${PROJECT_URL}${path}`);

/** Global shortcuts (the file lists handle their own keys). Returns true if handled. */
export function shortcut(e: KeyboardEvent): boolean {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod || e.altKey) {
    return false;
  }
  const key = e.key.toLowerCase();
  const run: Record<string, () => void> = {
    ',': () => (ui.preferences = true),
    s: () => (ui.siteManager = true),
    '1': () => (ui.tab = 'files'),
    '2': () => (ui.tab = 'github'),
    l: () => (ui.log = !ui.log),
    r: reconnectLast,
    d: () => void connection.disconnect(),
    '=': () => zoom(10),
    '+': () => zoom(10),
    '-': () => zoom(-10),
    '0': () => zoom(null),
  };
  const action = run[key];
  if (!action) {
    return false;
  }
  e.preventDefault();
  action();
  return true;
}

/** Whether "Sync with server" can be offered right now. */
export const canSync = () => sync.active && !!sync.check && !sync.run && !sync.preparing;
