<script lang="ts">
  import { connection } from '../lib/connection.svelte';
  import { t } from '../lib/i18n';
  import type { Tab } from '../lib/types';
  import EyeIcon from './EyeIcon.svelte';

  interface Props {
    name: string;
    tab: Tab;
    onTab: (tab: Tab) => void;
    hideAddress: boolean;
  }

  let { name, tab, onTab, hideAddress = $bindable() }: Props = $props();
</script>

<header>
  <b class="brand mono">{name}</b>
  <div class="tabs" role="tablist">
    <button role="tab" class="tab" class:active={tab === 'files'} aria-selected={tab === 'files'} onclick={() => onTab('files')}>
      {t('tab.files')}
    </button>
    <button role="tab" class="tab" class:active={tab === 'github'} aria-selected={tab === 'github'} onclick={() => onTab('github')}>
      {t('tab.github')}
    </button>
  </div>
  <span class="spacer"></span>
  <div class="server">
    <button class="control mono" disabled>
      {connection.state === 'disconnected' ? t('topbar.no_server') : hideAddress ? t('topbar.address_hidden') : connection.label} ▾
    </button>
    <button
      class="control icon"
      aria-label={hideAddress ? t('topbar.show_address') : t('files.hide_address')}
      aria-pressed={hideAddress}
      title={hideAddress ? t('topbar.show_address') : t('files.hide_address')}
      onclick={() => (hideAddress = !hideAddress)}
    >
      <EyeIcon closed={hideAddress} />
    </button>
    <span
      class="dot"
      class:muted={connection.state === 'disconnected'}
      class:status-modified={connection.state === 'connecting'}
      class:status-new={connection.state === 'connected'}
      aria-hidden="true">●</span
    >
    <span class="muted">{t(`status.${connection.state}`)}</span>
  </div>
</header>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 44px;
    padding: 0 16px;
    border-bottom: 1px solid var(--line);
    flex: none;
  }

  .brand {
    margin-right: 18px;
  }

  .tabs {
    display: flex;
    height: 100%;
  }

  .tab {
    height: 44px;
    padding: 0 14px;
    border: 0;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
  }

  .tab.active {
    color: var(--text-strong);
    box-shadow: inset 0 -2px 0 var(--selected-mark);
  }

  .spacer {
    flex: 1;
  }

  .server {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .icon {
    width: 28px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
</style>
