<script lang="ts">
  import { onMount } from 'svelte';
  import { getName, getVersion } from '@tauri-apps/api/app';
  import { isTauri } from '@tauri-apps/api/core';
  import TopBar from './components/TopBar.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import FilesTab from './components/FilesTab.svelte';
  import GitHubTab from './components/GitHubTab.svelte';
  import SiteManager from './components/SiteManager.svelte';
  import { sites } from './lib/sites.svelte';
  import { github } from './lib/github.svelte';
  import { ui } from './lib/ui.svelte';
  import { prefs } from './lib/prefs.svelte';
  import { sync } from './lib/sync/engine.svelte';
  import Preferences from './components/Preferences.svelte';
  import SignInDialogs from './components/SignInDialogs.svelte';
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

  onMount(() => {
    const stopWatching = watchSystemTheme(loadTheme);
    void prefs.load().then(() => (hideAddress = prefs.value.hideAddress));
    // Ctrl+, opens Preferences, like most desktop apps.
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        ui.preferences = true;
      }
    };
    window.addEventListener('keydown', onKey);
    let stopExit = () => {};

    if (isTauri()) {
      getName().then((n) => {
        name = n;
        document.title = n;
      });
      getVersion().then((v) => (version = v));
      onExit(() => (engine = 'unavailable')).then((un) => (stopExit = un));
    }
    call('daemon.hello')
      .then(() => {
        engine = 'ready';
        void sites.load();
        // Needed outside the GitHub tab too: syncs close fixed issues.
        void github.load();
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
    {#if ui.tab === 'github'}
      <GitHubTab {name} />
    {/if}
  </main>
  <StatusBar
    state={engine === 'unavailable'
      ? t('status.engine_unavailable')
      : connection.state === 'connected'
        ? t('status.connected_to', { server: hideAddress ? t('topbar.address_hidden') : connection.label }) +
          (sync.check?.marker?.sha ? `  ·  ${t('status.marker', { sha: sync.check.marker.sha.slice(0, 7) })}` : '')
        : t(`status.${connection.state}`)}
    error={engine === 'unavailable'}
    ok={engine === 'ready' && connection.state === 'connected'}
    message={connection.message}
    version={version ? t('app.version', { name, version }) : ''}
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
</style>
