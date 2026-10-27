// UI-wide switches shared by components that are far apart.
class Ui {
  siteManager = $state(false);
  preferences = $state(false);
  /** Open sign-in dialog: device flow ("browser") or personal access token. */
  githubSignIn = $state<'' | 'browser' | 'token'>('');
}

export const ui = new Ui();
