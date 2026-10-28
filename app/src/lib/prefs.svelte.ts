// Preferences, stored by the daemon as the "preferences" document. The theme
// is mirrored in local storage so the first paint already has the right one.
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { call } from './daemon';
import type { ExistsDefault } from './sites.svelte';
import { setLocale } from './i18n';
import { applyTheme, type ThemeChoice } from './theme';

export interface Prefs {
  theme: ThemeChoice;
  density: 'comfortable' | 'compact';
  /** Colour of selection marks, focus and primary buttons. */
  accent: 'neutral' | 'blue' | 'green' | 'purple' | 'orange' | 'pink' | 'teal';
  sizeUnits: 'binary' | 'decimal';
  /** Percent of the normal UI size. */
  fontScale: number;
  /** Start with the server address hidden. */
  hideAddress: boolean;
  /** How a hidden address looks: blurred in place, or replaced by a word. */
  hideStyle: 'blur' | 'text';
  showHidden: boolean;
  /** Show local paths with "/" like server paths, so a path can be pasted from one side into the other. */
  forwardSlashes: boolean;
  /** Tint folders grey that exist with the same name in both panes. */
  markTwins: boolean;
  /** The first matching folders asked whether to tint them (and to turn on synchronized browsing). */
  twinsAsked: boolean;
  /** Warn when another app window is connected to the same server. */
  warnSharedServer: boolean;
  /** Windows 11: snap layouts when the mouse rests on the maximize button. */
  snapLayouts: boolean;
  /** Synchronized browsing (Ctrl+Y), kept between sessions. */
  syncBrowse: boolean;
  /** Discord Rich Presence: what the app is doing, never addresses (off by default). */
  discordPresence: boolean;
  /** Also the repository's name, for public GitHub repositories only. */
  discordShowRepo: boolean;
  /** Look for a new version at start and once a day (installing always asks). */
  checkUpdates: boolean;
  /** Shortcut changes by command id (lib/keys.ts); "" removes a shortcut. */
  keybindings: Record<string, string>;
  /** Pull when both sides have new commits: replay mine on top (rebase) or a merge commit. */
  pullMode: 'rebase' | 'merge';
  language: string;
  foldersFirst: boolean;
  caseSensitive: boolean;
  dateFormat: 'short' | 'iso';
  doubleClick: 'transfer' | 'nothing';
  rememberDirs: boolean;
  lastLocalDir: string;
  /** Used when a site says "ask" or for quick connections. */
  existsDefault: ExistsDefault;
  /** Seconds. */
  connectTimeout: number;
  /** Transfers at once (extra connections to the server); sites that pace requests use one. */
  simultaneous: number;
  /** Open the session again when the server drops it. */
  autoReconnect: boolean;
  /** Program for editing server files; empty uses the system's choice. */
  editorPath: string;
  editUploadOnSave: boolean;
  editAsk: boolean;
  // Server sync (Preferences: Marker and history).
  syncLock: boolean;
  /** Walk the whole server for hand edits on connect and Check (slow on big servers). */
  syncScanEdits: boolean;
  syncBackup: boolean;
  syncAskVersionsDiffer: boolean;
  syncAskSomeoneElse: boolean;
  syncAskLocalOnly: boolean;
  /** Show what a sync will change (and let files be skipped) before it runs. */
  syncPreview: boolean;
  /** After a sync, comment on and close issues the deployed commits fix. */
  syncCloseIssues: boolean;
  /** Backups kept per site; older ones are deleted. */
  backupKeep: number;
  /** Folder for backups; empty uses the app's data folder. */
  backupDir: string;
  /** What "Reconnect" connects to: a saved site, or the newest quick connection. */
  lastConnection: { type: 'site'; id: string } | { type: 'quick' } | null;
  /** Repositories added in the GitHub tab (site repositories are listed anyway). */
  repos: string[];
  /** Site repositories removed from the GitHub tab's list. */
  hiddenRepos: string[];
  /** Width of the local pane, percent of the Files tab. */
  paneSplit: number;
  /** Heights in pixels. */
  logHeight: number;
  queueHeight: number;
  /** Show the queue while the log is open (otherwise a status bar button opens it). */
  queueWithLog: boolean;
  /** Folder colour labels by folder key (lib/labels.ts). */
  folderLabels: Record<string, string>;
  /** Widths of resizable columns in the GitHub tab (px), by column. */
  widths: Record<string, number>;
  /** Passwords from the app's old name were copied (once). */
  secretsMigrated: boolean;
  /** Repository shown in the GitHub tab. */
  githubRepo: string;
}

export const defaultPrefs: Prefs = {
  theme: 'system',
  density: 'comfortable',
  accent: 'neutral',
  sizeUnits: 'binary',
  fontScale: 100,
  hideAddress: false,
  hideStyle: 'blur',
  showHidden: true,
  forwardSlashes: false,
  markTwins: false,
  twinsAsked: false,
  warnSharedServer: true,
  snapLayouts: true,
  syncBrowse: false,
  discordPresence: false,
  discordShowRepo: false,
  checkUpdates: true,
  keybindings: {},
  pullMode: 'rebase',
  language: 'system',
  foldersFirst: true,
  caseSensitive: false,
  dateFormat: 'short',
  doubleClick: 'transfer',
  rememberDirs: true,
  lastLocalDir: '',
  existsDefault: 'ask',
  connectTimeout: 20,
  simultaneous: 2,
  autoReconnect: true,
  editorPath: '',
  editUploadOnSave: true,
  editAsk: true,
  syncLock: true,
  syncScanEdits: false,
  syncBackup: true,
  syncAskVersionsDiffer: true,
  syncAskSomeoneElse: true,
  syncAskLocalOnly: false,
  syncCloseIssues: true,
  syncPreview: true,
  backupKeep: 5,
  backupDir: '',
  lastConnection: null,
  repos: [],
  hiddenRepos: [],
  githubRepo: '',
  secretsMigrated: false,
  widths: {},
  folderLabels: {},
  paneSplit: 50,
  logHeight: 190,
  queueHeight: 160,
  queueWithLog: false,
};

/** Applies the parts of the preferences that change the page itself. */
export function applyPrefs(p: Prefs): void {
  applyTheme(p.theme);
  const root = document.documentElement;
  root.dataset.density = p.density;
  if (p.accent === 'neutral') {
    delete root.dataset.accent;
  } else {
    root.dataset.accent = p.accent;
  }
  // Webview zoom (like Ctrl+wheel in a browser) scales everything and keeps
  // vw/vh and mouse coordinates consistent, so dialogs still fit the window.
  if (isTauri()) {
    void getCurrentWebview()
      .setZoom(p.fontScale / 100)
      .catch(() => {});
  }
}

class PrefsStore {
  value = $state<Prefs>({ ...defaultPrefs });
  loaded = $state(false);

  async load(): Promise<void> {
    try {
      const res = await call<{ value: Partial<Prefs> | null }>('store.get', { name: 'preferences' });
      this.value = { ...defaultPrefs, ...(res.value ?? {}) };
    } catch {
      // Keep the defaults; the app works without saved preferences.
    }
    setLocale(this.value.language);
    applyPrefs(this.value);
    this.loaded = true;
  }

  async save(next: Prefs): Promise<void> {
    this.value = { ...next };
    applyPrefs(this.value);
    await call('store.set', { name: 'preferences', value: $state.snapshot(this.value) });
  }

  /** Saves the current values (after a field was changed in place, e.g. while dragging a splitter). */
  async persist(): Promise<void> {
    await call('store.set', { name: 'preferences', value: $state.snapshot(this.value) }).catch(() => {});
  }

  /** Saves one field without a dialog (e.g. the last local folder). */
  async set<K extends keyof Prefs>(key: K, value: Prefs[K]): Promise<void> {
    if (this.value[key] === value) {
      return;
    }
    this.value[key] = value;
    await call('store.set', { name: 'preferences', value: $state.snapshot(this.value) }).catch(() => {});
  }
}

export const prefs = new PrefsStore();

/** Width of a resizable column, or its default. */
export const colWidth = (key: string, fallback: number) => prefs.value.widths[key] ?? fallback;

/** Drags a column's right edge by `delta` px, within [min, max]. */
export function resizeCol(key: string, fallback: number, delta: number, min: number, max: number): void {
  prefs.value.widths = { ...prefs.value.widths, [key]: Math.max(min, Math.min(max, colWidth(key, fallback) + delta)) };
}

/** Back to the default width (double-click on the bar). */
export function resetCol(key: string): void {
  const next = { ...prefs.value.widths };
  delete next[key];
  prefs.value.widths = next;
  void prefs.persist();
}

/** Largest height for the log or queue so the file panes keep room (the other panel open counts). */
export function bottomPanelMax(other: number): number {
  return Math.max(80, window.innerHeight - 360 - other);
}
