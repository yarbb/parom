// Updates from this project's GitHub releases (Tauri updater): checked at
// start and once a day (Preferences → Updates can turn that off), installed
// only when the user asks. The app accepts an update only if it is signed
// with the project's key (pubkey in tauri.conf.json).
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
      this.#update = update;
      this.available = update ? { version: update.version, notes: update.body ?? '', date: update.date ?? null } : null;
      this.checkedAt = Date.now();
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
