<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke, isTauri } from '@tauri-apps/api/core';
  import { prefs } from '../lib/prefs.svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import Copy from '@lucide/svelte/icons/copy';
  import Minus from '@lucide/svelte/icons/minus';
  import Square from '@lucide/svelte/icons/square';
  import X from '@lucide/svelte/icons/x';
  import { t } from '../lib/i18n';

  // Minimize, maximize / restore and close, drawn by the app since the
  // window has no system title bar (decorations: false).
  let maximized = $state(false);

  onMount(() => {
    if (!isTauri()) {
      return;
    }
    const win = getCurrentWindow();
    const update = () => void win.isMaximized().then((m) => (maximized = m));
    update();
    let stop = () => {};
    void win.onResized(update).then((un) => (stop = un));
    return () => stop();
  });

  const win = () => getCurrentWindow();

  // Windows 11 snap layouts: Windows cannot see our own maximize button, so
  // resting the mouse on it asks for the layouts as Win+Z does.
  const windows = typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows');
  let snapTimer: ReturnType<typeof setTimeout> | null = null;

  function hoverMaximize() {
    if (!windows || !prefs.value.snapLayouts) {
      return;
    }
    snapTimer = setTimeout(() => {
      snapTimer = null;
      if (document.hasFocus()) {
        void invoke('snap_layouts').catch(() => undefined);
      }
    }, 550);
  }

  function leaveMaximize() {
    if (snapTimer) {
      clearTimeout(snapTimer);
      snapTimer = null;
    }
  }
</script>

{#if isTauri()}
  <div class="controls">
    <button class="win" aria-label={t('window.minimize')} title={t('window.minimize')} onclick={() => win().minimize()}>
      <Minus size={15} strokeWidth={1.4} />
    </button>
    <button
      class="win"
      aria-label={maximized ? t('window.restore') : t('window.maximize')}
      title={windows && prefs.value.snapLayouts ? undefined : maximized ? t('window.restore') : t('window.maximize')}
      onmouseenter={hoverMaximize}
      onmouseleave={leaveMaximize}
      onclick={() => (leaveMaximize(), win().toggleMaximize())}
    >
      {#if maximized}<Copy size={13} strokeWidth={1.4} />{:else}<Square size={12} strokeWidth={1.4} />{/if}
    </button>
    <button class="win close" aria-label={t('window.close')} title={t('window.close')} onclick={() => win().close()}>
      <X size={16} strokeWidth={1.4} />
    </button>
  </div>
{/if}

<style>
  .controls {
    display: flex;
    align-self: stretch;
    margin-right: -16px;
    margin-left: 8px;
  }

  .win {
    width: 46px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    background: none;
    color: var(--text);
    cursor: default;
  }

  .win:hover {
    background: var(--selected-bg);
    color: var(--text-strong);
  }

  .win.close:hover {
    background: #c42b1c;
    color: #fff;
  }
</style>
