// UI-wide switches shared by components that are far apart.
import type { Tab } from './types';
import { prefs } from './prefs.svelte';

class Ui {
  tab = $state<Tab>('files');
  /** The product name (productName in tauri.conf.json), once known. */
  appName = $state('');
  siteManager = $state(false);
  /** Open the Site Manager with a new site (first run). */
  siteManagerNew = $state(false);
  preferences = $state(false);
  /** Page Preferences open on (set before opening them). */
  preferencesPage = $state<string | null>(null);
  /** Help → About. */
  about = $state(false);
  /** The message log panel above the status bar. */
  log = $state(false);
  /** Open sign-in dialog: device flow ("browser") or personal access token. */
  githubSignIn = $state<'' | 'browser' | 'token'>('');
  /** Synchronized browsing (Ctrl+Y): both panes follow each other inside the site's folders; remembered in prefs. */
  get syncBrowse(): boolean {
    return prefs.value.syncBrowse;
  }

  set syncBrowse(on: boolean) {
    void prefs.set('syncBrowse', on);
  }
}

export const ui = new Ui();
