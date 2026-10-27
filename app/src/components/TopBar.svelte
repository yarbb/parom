<script lang="ts">
  import { connection } from '../lib/connection.svelte';
  import { t } from '../lib/i18n';
  import type { Tab } from '../lib/types';
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import MenuBar from './MenuBar.svelte';
  import WindowControls from './WindowControls.svelte';
  import ServerMenu from './ServerMenu.svelte';
  import { ui } from '../lib/ui.svelte';

  interface Props {
    name: string;
    tab: Tab;
    onTab: (tab: Tab) => void;
    hideAddress: boolean;
  }

  let { name, tab, onTab, hideAddress = $bindable() }: Props = $props();
  /** Files are moving: the "_" blinks like a cursor at work. */
  const transferring = $derived(connection.transfers.some((x) => x.state === 'running') || connection.walks > 0);
</script>

<!-- The window's title bar: drag it by any empty spot (or the name),
     double-click to maximize. Buttons and menus stay clickable. -->
<header data-tauri-drag-region>
  <!-- "_" before the name, like the "_P" app icon. -->
  <b class="brand mono" class:busy={transferring} data-tauri-drag-region
    ><span class="prompt" data-tauri-drag-region>_</span>{#each [...name] as ch, i (i)}<span class="ch" style:--i={i} data-tauri-drag-region>{ch}</span>{/each}</b
  >
  <MenuBar bind:hideAddress />
  <div class="tabs" role="tablist">
    <button role="tab" class="tab" class:active={tab === 'files'} aria-selected={tab === 'files'} onclick={() => onTab('files')}>
      {t('tab.files')}
    </button>
    <button role="tab" class="tab" class:active={tab === 'github'} aria-selected={tab === 'github'} onclick={() => onTab('github')}>
      {t('tab.github')}
    </button>
  </div>
  <span class="spacer" data-tauri-drag-region></span>
  <div class="server">
    <ServerMenu {hideAddress} />
    <button class="control icon" aria-label={t('prefs.title')} title="{t('prefs.title')} (Ctrl+,)" onclick={() => (ui.preferences = true)}>
      <!-- Sliders: reads as "settings", unlike a gear that looks like a sun. -->
      <SlidersHorizontal size={15} strokeWidth={1.6} />
    </button>
    <button
      class="control icon"
      aria-label={hideAddress ? t('topbar.show_address') : t('files.hide_address')}
      aria-pressed={hideAddress}
      title={hideAddress ? t('topbar.show_address') : t('files.hide_address')}
      onclick={() => (hideAddress = !hideAddress)}
    >
      {#if hideAddress}<EyeOff size={15} strokeWidth={1.6} />{:else}<Eye size={15} strokeWidth={1.6} />{/if}
    </button>
    <span
      class="dot"
      class:muted={connection.state === 'disconnected'}
      class:status-modified={connection.state === 'connecting'}
      class:status-new={connection.state === 'connected'}
      aria-hidden="true">●</span
    >
    <span class="muted" data-tauri-drag-region>{t(`status.${connection.state}`)}</span>
  </div>
  <WindowControls />
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
    margin-right: 10px;
    user-select: none;
  }

  .prompt {
    display: inline-block;
    margin-right: 1px;
    color: var(--accent);
  }

  .ch {
    display: inline-block;
  }

  .brand.busy .prompt {
    animation: blink 1s steps(1) infinite;
  }

  /* On hover the letters ride a small wave, one after another. */
  .brand:hover .ch {
    animation: wave 0.9s ease-in-out;
    animation-delay: calc(var(--i) * 60ms);
  }

  @keyframes blink {
    50% {
      opacity: 0;
    }
  }

  @keyframes wave {
    0%,
    100% {
      transform: translateY(0);
    }
    40% {
      transform: translateY(-2px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .brand.busy .prompt,
    .brand:hover .ch {
      animation: none;
    }
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
