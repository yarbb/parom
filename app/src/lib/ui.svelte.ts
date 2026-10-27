// UI-wide switches shared by components that are far apart.
import type { Tab } from './types';

class Ui {
  tab = $state<Tab>('files');
  /** The product name (productName in tauri.conf.json), once known. */
  appName = $state('');
  siteManager = $state(false);
  preferences = $state(false);
  /** The message log panel above the status bar. */
  log = $state(false);
  /** Open sign-in dialog: device flow ("browser") or personal access token. */
  githubSignIn = $state<'' | 'browser' | 'token'>('');
}

export const ui = new Ui();
