<script lang="ts">
  import { onMount } from 'svelte';
  import { getName, getVersion } from '@tauri-apps/api/app';
  import { isTauri } from '@tauri-apps/api/core';
  import TopBar from './components/TopBar.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import FilesTab from './components/FilesTab.svelte';
  import GitHubTab from './components/GitHubTab.svelte';
  import SiteManager from './components/SiteManager.svelte';
  import { siteSecretKey, sites } from './lib/sites.svelte';
  import { migrateSecrets } from './lib/secrets';
  import { credentialKey } from './lib/recent';
  import { GITHUB_TOKEN_KEY } from './lib/github.svelte';
  import { github } from './lib/github.svelte';
  import { ui } from './lib/ui.svelte';
  import { prefs } from './lib/prefs.svelte';
  import { sync } from './lib/sync/engine.svelte';
  import Preferences from './components/Preferences.svelte';
  import SignInDialogs from './components/SignInDialogs.svelte';
  import AboutDialog from './components/AboutDialog.svelte';
  import { shortcut } from './lib/commands.svelte';
  import { repo } from './lib/repo.svelte';
  import LogPanel from './components/LogPanel.svelte';
  import { connection } from './lib/connection.svelte';
  import { call, onExit } from './lib/daemon';
  import { loadTheme, watchSystemTheme } from './lib/theme';
  import { t } from './lib/i18n';
  import type { EngineState } from './lib/types';

  // The product name lives only in tauri.conf.json (productName).
  let name = $state('');
  let version = $state('');
  let engine = $state<EngineState>('starting');
  let hideAddress = $state(false);
  let githubSeen = $state(false);
  $effect(() => {
    if (ui.tab === 'github') {
      githubSeen = true;
    }
  });

  /** After the rename: passwords saved under the old name are copied once. */
  async function moveOldPasswords() {
    if (prefs.value.secretsMigrated) {
      return;
    }
    const keys = [
      GITHUB_TOKEN_KEY,
      ...sites.list.filter((s) => s.savedPassword).map(siteSecretKey),
      ...connection.recent.filter((r) => r.remember).map(credentialKey),
    ];
    await migrateSecrets(keys).catch(() => 0);
    await prefs.set('secretsMigrated', true);
  }

  onMount(() => {
    const stopWatching = watchSystemTheme(loadTheme);
    void prefs.load().then(() => (hideAddress = prefs.value.hideAddress));
    // App shortcuts (Ctrl+, Ctrl+S, Ctrl+1/2, Ctrl+L, Ctrl+R, Ctrl+D, zoom); see the menus.
    const onKey = (e: KeyboardEvent) => void shortcut(e);
    window.addEventListener('keydown', onKey);
    let stopExit = () => {};

    if (isTauri()) {
      getName().then((n) => {
        name = n;
        ui.appName = n;
        document.title = n;
      });
      getVersion().then((v) => (version = v));
      onExit(() => (engine = 'unavailable')).then((un) => (stopExit = un));
    }
    call('daemon.hello')
      .then(async () => {
        engine = 'ready';
        await sites.load();
        await moveOldPasswords();
        // Needed outside the GitHub tab too: syncs close fixed issues.
        void github.load();
        // The GitHub tab's repository is fetched in the background from the start.
        void repo.refresh().then(() => repo.startAutoFetch());
      })
      .catch(() => (engine = 'unavailable'));

    return () => {
      stopWatching();
      stopExit();
      window.removeEventListener('keydown', onKey);
    };
  });
</script>

{#if prefs.loaded}
<div class="app">
  <TopBar {name} tab={ui.tab} onTab={(next) => (ui.tab = next)} bind:hideAddress />
  <main>
    <!-- The Files tab stays mounted: it connects to servers picked in the top
         bar and shows server questions, whichever tab is open. -->
    <FilesTab {engine} visible={ui.tab === 'files'} />
    <!-- Mounted on first visit, then kept (hidden): typed text and lists survive tab switches. -->
    {#if githubSeen}
      <div class="tab-view" class:hidden={ui.tab !== 'github'}><GitHubTab {name} /></div>
    {/if}
  </main>
  {#if ui.log}<LogPanel onClose={() => (ui.log = false)} />{/if}
  <StatusBar
    onLog={() => (ui.log = !ui.log)}
    logOpen={ui.log}
    queued={ui.log ? connection.transfers.length : 0}
    queueOpen={prefs.value.queueWithLog}
    onQueue={() => prefs.set('queueWithLog', !prefs.value.queueWithLog)}
    state={engine === 'unavailable'
      ? t('status.engine_unavailable')
      : connection.state === 'connected'
        ? t('status.connected_to', { server: hideAddress && prefs.value.hideStyle === 'text' ? t('topbar.address_hidden') : connection.label }) +
          (sync.check?.marker?.sha ? `  ·  ${t('status.marker', { sha: sync.check.marker.sha.slice(0, 7) })}` : '')
        : t(`status.${connection.state}`)}
    secret={hideAddress && prefs.value.hideStyle === 'blur' && connection.state === 'connected' ? connection.label : null}
    error={engine === 'unavailable'}
    ok={engine === 'ready' && connection.state === 'connected'}
    message={connection.message}
    version={version ? t('app.version', { name, version }) + (import.meta.env.VITE_BUILD ? ` · ${import.meta.env.VITE_BUILD}` : '') : ''}
  />
</div>
{/if}

{#if ui.siteManager}
  <SiteManager onClose={() => (ui.siteManager = false)} />
{/if}
{#if ui.preferences}
  <Preferences onClose={() => (ui.preferences = false)} />
{/if}
<SignInDialogs />
{#if ui.about}
  <AboutDialog onClose={() => (ui.about = false)} />
{/if}

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  main {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .tab-view {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    animation: from-right calc(var(--motion) * 1.6) cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .tab-view.hidden {
    display: none;
  }
</style>
