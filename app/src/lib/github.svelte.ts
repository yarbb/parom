// GitHub account and REST calls (src-tauri/src/github.rs). The token never
// reaches the UI: Rust reads it from the credential store for every call.
import { invoke, isTauri } from '@tauri-apps/api/core';

export interface GitHubUser {
  login: string;
  id: number;
  name: string | null;
  avatar_url: string;
}

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

/** Fine-grained token page, prefilled with what the app needs. */
export const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

/** Where people add repositories to the GitHub App after signing in with the browser. */
export const APP_INSTALL_URL = 'https://github.com/settings/installations';

export const openGitHub = (url: string) => invoke<void>('open_github_url', { url });

class GitHubAccount {
  user = $state<GitHubUser | null>(null);
  /** The stored token was checked (signed in or not). */
  checked = $state(false);
  error = $state('');

  async load(): Promise<void> {
    if (!isTauri()) {
      this.checked = true;
      return;
    }
    try {
      this.user = await invoke<GitHubUser | null>('github_user');
      this.error = '';
    } catch (e) {
      // Offline: keep the token, try again on the next load.
      this.error = String(e);
    } finally {
      this.checked = true;
    }
  }

  async signInWithToken(token: string): Promise<void> {
    this.user = await invoke<GitHubUser>('github_sign_in_token', { token });
    this.error = '';
  }

  startDevice = () => invoke<DeviceCode>('github_device_start');

  /** True once the user approved the code on github.com. */
  async pollDevice(code: DeviceCode): Promise<boolean> {
    const user = await invoke<GitHubUser | null>('github_device_poll', { deviceCode: code.device_code });
    if (user) {
      this.user = user;
      this.error = '';
    }
    return !!user;
  }

  async signOut(): Promise<void> {
    await invoke('github_sign_out');
    this.user = null;
  }

  /** Author for commits when git has no user.name / user.email. */
  get author(): { name: string; email: string } | null {
    const u = this.user;
    return u ? { name: u.name || u.login, email: `${u.id}+${u.login}@users.noreply.github.com` } : null;
  }
}

export const github = new GitHubAccount();

/** One REST call as the signed-in user; `html` adds GitHub-rendered Markdown (`body_html`). */
export function api<T>(method: string, path: string, body?: unknown, html = false): Promise<T> {
  return invoke<T>('github_api', { method, path, body: body ?? null, html });
}
