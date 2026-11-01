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
import { commandFor, comboOf } from './keys';
import { updates } from './updates.svelte';

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

/** Synchronized browsing needs a session of a site with a local folder. */
export const canSyncBrowse = () => connection.state === 'connected' && !!connection.site?.localDir.trim();

/** What each global shortcut does (ids from lib/keys.ts). */
const actions: Record<string, () => void> = {
  siteManager: () => (ui.siteManager = true),
  preferences: () => (ui.preferences = true),
  tabFiles: () => (ui.tab = 'files'),
  tabGithub: () => (ui.tab = 'github'),
  log: () => (ui.log = !ui.log),
  syncBrowse: () => (ui.syncBrowse = !ui.syncBrowse),
  reconnect: reconnectLast,
  disconnect: () => void connection.disconnect(),
  sync: () => canSync() && (sync.choosing = true),
  checkUpdates: () => void updates.check(true),
  zoomIn: () => zoom(10),
  zoomOut: () => zoom(-10),
  zoomReset: () => zoom(null),
};

/** Editing keys keep their meaning in text fields (undo, redo, clipboard). */
const textKeys = new Set(['Ctrl+A', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+Shift+Z']);

/** Global shortcuts (Preferences → Keyboard shortcuts). Returns true if handled. */
export function shortcut(e: KeyboardEvent): boolean {
  if (ui.capturingKeys || e.defaultPrevented) {
    return false;
  }
  const combo = comboOf(e);
  if (!combo) {
    return false;
  }
  const inText = e.target instanceof Element && !!e.target.closest('input, textarea, [contenteditable]');
  // In a text field only combinations with Ctrl or Alt, and never the editing ones.
  if (inText && (textKeys.has(combo) || !/^(Ctrl|Alt)\+/.test(combo))) {
    return false;
  }
  const command = commandFor(combo, 'global');
  const action = command && actions[command.id];
  if (!action) {
    return false;
  }
  e.preventDefault();
  action();
  return true;
}

/** Whether "Sync with server" can be offered right now. */
export const canSync = () => sync.active && !!sync.check && !sync.run && !sync.preparing;
