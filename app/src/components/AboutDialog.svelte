<script lang="ts">
  import { onMount } from 'svelte';
  import { getVersion } from '@tauri-apps/api/app';
  import { isTauri } from '@tauri-apps/api/core';
  import { openProject } from '../lib/commands.svelte';
  import { t } from '../lib/i18n';
  import { ui } from '../lib/ui.svelte';
  import Modal from './Modal.svelte';

  // Help → About: name, version and build, licenses.
  let { onClose }: { onClose: () => void } = $props();
  let version = $state('');
  const build = import.meta.env.VITE_BUILD as string | undefined;

  onMount(() => {
    if (isTauri()) {
      void getVersion().then((v) => (version = v));
    }
  });
</script>

<Modal title={t('menu.about', { name: ui.appName })} onCancel={onClose}>
  <p class="name">{ui.appName}</p>
  <p class="mono muted">v{version}{build ? ` · ${build}` : ''}</p>
  <p>{t('about.body', { name: ui.appName })}</p>
  <p class="muted small">{t('about.licenses')}</p>
  {#snippet actions()}
    <button class="control" onclick={() => openProject()}>{t('menu.project_page')}</button>
    <button class="control primary" onclick={onClose}>{t('common.ok')}</button>
  {/snippet}
</Modal>

<style>
  p {
    margin: 0 0 10px;
  }

  .name {
    margin-bottom: 2px;
    color: var(--text-strong);
    font-size: 18px;
    font-weight: 600;
  }

  .small {
    font-size: 11.5px;
  }
</style>
