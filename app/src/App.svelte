<script lang="ts">
  import { onMount } from 'svelte';
  import { getName, getVersion } from '@tauri-apps/api/app';
  import { isTauri } from '@tauri-apps/api/core';
  import TopBar from './components/TopBar.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import FilesTab from './components/FilesTab.svelte';
  import GitHubTab from './components/GitHubTab.svelte';
  import { call, onExit } from './lib/daemon';
  import { loadTheme, watchSystemTheme } from './lib/theme';
  import { t } from './lib/i18n';
  import type { EngineState, Tab } from './lib/types';

  // The product name lives only in tauri.conf.json (productName).
  let name = $state('');
  let version = $state('');
  let tab = $state<Tab>('files');
  let engine = $state<EngineState>('starting');
  let hideAddress = $state(false);

  onMount(() => {
    const stopWatching = watchSystemTheme(loadTheme);
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
      .then(() => (engine = 'ready'))
      .catch(() => (engine = 'unavailable'));

    return () => {
      stopWatching();
      stopExit();
    };
  });
</script>

<div class="app">
  <TopBar {name} {tab} onTab={(next) => (tab = next)} bind:hideAddress />
  <main>
    {#if tab === 'files'}
      <FilesTab {engine} />
    {:else}
      <GitHubTab {name} />
    {/if}
  </main>
  <StatusBar
    state={engine === 'unavailable' ? t('status.engine_unavailable') : t('status.not_connected')}
    error={engine === 'unavailable'}
    version={version ? t('app.version', { name, version }) : ''}
  />
</div>

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
