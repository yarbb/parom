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
  sizeUnits: 'binary' | 'decimal';
  /** Percent of the normal UI size. */
  fontScale: number;
  /** Start with the server address hidden. */
  hideAddress: boolean;
  showHidden: boolean;
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
  /** Program for editing server files; empty uses the system's choice. */
  editorPath: string;
  editUploadOnSave: boolean;
  editAsk: boolean;
  // Server sync (Preferences: Marker and history).
  syncLock: boolean;
  syncDetectEdits: boolean;
  syncBackup: boolean;
  syncAskVersionsDiffer: boolean;
  syncAskSomeoneElse: boolean;
  syncAskLocalOnly: boolean;
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
  /** Repository shown in the GitHub tab. */
  githubRepo: string;
}

export const defaultPrefs: Prefs = {
  theme: 'system',
  density: 'comfortable',
  sizeUnits: 'binary',
  fontScale: 100,
  hideAddress: false,
  showHidden: true,
  language: 'en',
  foldersFirst: true,
  caseSensitive: false,
  dateFormat: 'short',
  doubleClick: 'transfer',
  rememberDirs: true,
  lastLocalDir: '',
  existsDefault: 'ask',
  connectTimeout: 20,
  editorPath: '',
  editUploadOnSave: true,
  editAsk: true,
  syncLock: true,
  syncDetectEdits: true,
  syncBackup: true,
  syncAskVersionsDiffer: true,
  syncAskSomeoneElse: true,
  syncAskLocalOnly: false,
  syncCloseIssues: true,
  backupKeep: 5,
  backupDir: '',
  lastConnection: null,
  repos: [],
  githubRepo: '',
};

/** Applies the parts of the preferences that change the page itself. */
export function applyPrefs(p: Prefs): void {
  applyTheme(p.theme);
  const root = document.documentElement;
  root.dataset.density = p.density;
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
