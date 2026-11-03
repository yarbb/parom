// Updates from this project's GitHub releases (Tauri updater): checked at
// start and once a day (Preferences → Updates can turn that off), installed
// when the user asks, or, with "Install updates automatically" (off by
// default), downloaded in the background and installed when the app closes.
// The app accepts an update only if it is signed with the project's key
// (pubkey in tauri.conf.json).
import { isTauri } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { prefs } from './prefs.svelte';

const DAY = 24 * 60 * 60 * 1000;

class Updates {
  /** A newer version, once a check found one. */
  available = $state<{ version: string; notes: string; date: string | null } | null>(null);
  checking = $state(false);
  /** Download progress while installing (bytes); total is null when unknown. */
  progress = $state<{ done: number; total: number | null } | null>(null);
  error = $state('');
  checkedAt = $state<number | null>(null);
  /** The update dialog: after a manual check, or from the status bar. */
  dialog = $state(false);
  /** Downloaded in the background, installed when the app closes. */
  ready = $state<string | null>(null);
  /** "Updated to X" with its notes, once after an automatic update. */
  updated = $state<{ version: string; notes: string } | null>(null);
  #update: Update | null = null;

  /** `manual`: opened from the menu or Preferences, so the result is shown either way. */
  async check(manual = false): Promise<void> {
    if (!isTauri() || this.checking || this.progress) {
      return;
    }
    this.checking = true;
    this.error = '';
    if (manual) {
      this.dialog = true;
    }
    try {
      const update = await check();
      if (update && update.version === this.ready) {
        // Already downloaded: keep that one for the install on close.
        void update.close();
        return;
      }
      this.#update = update;
      this.available = update ? { version: update.version, notes: update.body ?? '', date: update.date ?? null } : null;
      this.checkedAt = Date.now();
      if (update && prefs.value.autoUpdate && this.ready !== update.version) {
        void this.#prefetch(update);
      }
    } catch (e) {
      // Quiet in the background; a manual check shows why it failed.
      this.error = manual ? String(e) : '';
    } finally {
      this.checking = false;
    }
  }

  /** Downloads the update, runs its installer and starts the new version. */
  async install(): Promise<void> {
    const update = this.#update;
    if (!update || this.progress) {
      return;
    }
    this.error = '';
    this.progress = { done: 0, total: null };
    try {
      await update.downloadAndInstall((ev) => {
        if (ev.event === 'Started') {
          this.progress = { done: 0, total: ev.data.contentLength ?? null };
        } else if (ev.event === 'Progress' && this.progress) {
          this.progress = { ...this.progress, done: this.progress.done + ev.data.chunkLength };
        }
      });
      await relaunch();
    } catch (e) {
      this.error = String(e);
      this.progress = null;
    }
  }

  async #prefetch(update: Update): Promise<void> {
    try {
      await update.download();
      if (this.#update === update) {
        this.ready = update.version;
      }
    } catch {
      // Quiet: the status bar button still offers the update.
    }
  }

  /**
   * When the app closes: installs the update downloaded in the background,
   * without starting the app again. False when there is none or it failed
   * (the update window then shows why).
   */
  async installOnClose(): Promise<boolean> {
    const update = this.#update;
    if (!update || this.ready !== update.version) {
      return false;
    }
    this.ready = null;
    await prefs.set('updatedTo', { version: update.version, notes: update.body ?? '' });
    try {
      await update.install({ restartAfterInstall: false });
      return true;
    } catch (e) {
      await prefs.set('updatedTo', null);
      this.error = String(e);
      this.dialog = true;
      return false;
    }
  }

  /** At start: "Updated to X" once, if the last close installed X. */
  async announce(version: string): Promise<void> {
    const done = prefs.value.updatedTo;
    if (!done) {
      return;
    }
    if (done.version === version) {
      this.updated = done;
    }
    await prefs.set('updatedTo', null);
  }

  /** Background checks: shortly after start, then once a day. */
  start(): () => void {
    const run = () => prefs.value.checkUpdates && void this.check();
    const first = setTimeout(run, 8000);
    const daily = setInterval(run, DAY);
    return () => {
      clearTimeout(first);
      clearInterval(daily);
    };
  }
}

export const updates = new Updates();
