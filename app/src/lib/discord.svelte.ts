// Optional Discord Rich Presence (Preferences → Interface; off by default).
// Private by default: it says what the app is doing, never a server address
// or a site name. A repository's name shows only when asked for, and only
// for public GitHub repositories. The Rust side talks to Discord
// (src-tauri/src/discord.rs) and keeps to its rate limit.
import { invoke, isTauri } from '@tauri-apps/api/core';
import { SvelteMap } from 'svelte/reactivity';
import { PROJECT_URL } from './commands.svelte';
import { connection } from './connection.svelte';
import { api, github } from './github.svelte';
import { t } from './i18n';
import { prefs } from './prefs.svelte';
import { repo } from './repo.svelte';
import { sync } from './sync/engine.svelte';
import { ui } from './ui.svelte';

const ICON = 'https://raw.githubusercontent.com/yarbb/parom/main/app/src-tauri/icons/128x128@2x.png';

/** Repository slug to "is public", asked GitHub once per session; unknown counts as private. */
const visibility = new SvelteMap<string, boolean>();

function isPublic(slug: string): boolean {
  if (!visibility.has(slug)) {
    visibility.set(slug, false);
    if (github.user) {
      void api<{ private: boolean }>('GET', `/repos/${slug}`)
        .then((r) => visibility.set(slug, !r.private))
        .catch(() => undefined);
    }
  }
  return visibility.get(slug) ?? false;
}

interface Doing {
  kind: string;
  details: string;
  state?: string;
}

function doing(): Doing {
  const run = sync.run;
  if (run && !run.finished) {
    return { kind: 'sync', details: t('discord.syncing'), state: run.total ? t('discord.files', { done: run.done, total: run.total }) : undefined };
  }
  const moving = connection.transfers.filter((x) => x.state === 'running').length;
  if (moving > 0 || connection.walks > 0) {
    return { kind: 'transfer', details: t('discord.moving'), state: moving ? t('discord.queue', { count: moving }) : undefined };
  }
  if (ui.tab === 'github') {
    const slug = repo.info?.github;
    const named = prefs.value.discordShowRepo && slug && isPublic(slug);
    return { kind: 'github', details: t('discord.github'), state: named ? slug : undefined };
  }
  if (connection.state === 'connected') {
    return { kind: 'server', details: t('discord.connected') };
  }
  return { kind: 'idle', details: t('discord.idle') };
}

/** Keeps Discord up to date while the app runs; returns a stop function. */
export function startPresence(): () => void {
  if (!isTauri()) {
    return () => {};
  }
  let kind = '';
  let since = 0;
  return $effect.root(() => {
    $effect(() => {
      if (!prefs.value.discordPresence) {
        kind = '';
        void invoke('discord_presence', { activity: null }).catch(() => undefined);
        return;
      }
      const d = doing();
      if (d.kind !== kind) {
        // The timer counts from when the app started doing this.
        kind = d.kind;
        since = Math.floor(Date.now() / 1000);
      }
      const activity = {
        details: d.details,
        ...(d.state ? { state: d.state } : {}),
        timestamps: { start: since },
        assets: { large_image: ICON, large_text: ui.appName || 'Parom' },
        buttons: [{ label: t('discord.get'), url: PROJECT_URL }],
      };
      void invoke('discord_presence', { activity }).catch(() => undefined);
    });
  });
}
