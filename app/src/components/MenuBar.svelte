<script lang="ts">
  import { connection } from '../lib/connection.svelte';
  import {
    canSync,
    closeWindow,
    editCommand,
    openProject,
    reconnectLast,
    setTheme,
    zoom,
  } from '../lib/commands.svelte';
  import { t } from '../lib/i18n';
  import { prefs } from '../lib/prefs.svelte';
  import { sync } from '../lib/sync/engine.svelte';
  import { ui } from '../lib/ui.svelte';
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte';

  // File / Edit / View / Server / Help in the title bar. Opening one and
  // moving the mouse over the others switches menus, like a native menu bar.
  let { hideAddress = $bindable() }: { hideAddress: boolean } = $props();

  type MenuId = 'file' | 'edit' | 'view' | 'server' | 'help';
  const ids: MenuId[] = ['file', 'edit', 'view', 'server', 'help'];
  let open = $state<{ id: MenuId; x: number; y: number } | null>(null);
  /** Focus before the menu took it: Edit commands act on it. */
  let lastFocus: Element | null = null;
  /** The menu that a click outside just closed (its own button then must not reopen it). */
  let justClosed: MenuId | null = null;

  function close() {
    justClosed = open?.id ?? null;
    open = null;
    setTimeout(() => (justClosed = null));
  }

  function toggle(id: MenuId, button: HTMLElement) {
    if (justClosed === id) {
      return;
    }
    if (open?.id === id) {
      open = null;
    } else {
      show(id, button);
    }
  }

  const check = (on: boolean, label: string) => `${on ? '✓' : '  '} ${label}`;

  function items(id: MenuId): MenuItem[] {
    const connected = connection.state === 'connected';
    switch (id) {
      case 'file':
        return [
          { label: t('menu.site_manager'), hint: 'Ctrl+S', action: () => (ui.siteManager = true) },
          { label: t('menu.preferences'), hint: 'Ctrl+,', action: () => (ui.preferences = true) },
          { separator: true, label: '' },
          { label: t('menu.exit'), hint: 'Alt+F4', action: () => void closeWindow() },
        ];
      case 'edit':
        return [
          { label: t('menu.cut'), hint: 'Ctrl+X', action: () => void editCommand('cut', lastFocus) },
          { label: t('menu.copy'), hint: 'Ctrl+C', action: () => void editCommand('copy', lastFocus) },
          { label: t('menu.paste'), hint: 'Ctrl+V', action: () => void editCommand('paste', lastFocus) },
          { separator: true, label: '' },
          { label: t('menu.select_all'), hint: 'Ctrl+A', action: () => void editCommand('selectAll', lastFocus) },
        ];
      case 'view':
        return [
          { label: check(ui.tab === 'files', t('tab.files')), hint: 'Ctrl+1', action: () => (ui.tab = 'files') },
          { label: check(ui.tab === 'github', t('tab.github')), hint: 'Ctrl+2', action: () => (ui.tab = 'github') },
          { separator: true, label: '' },
          { label: check(ui.log, t('log.title')), hint: 'Ctrl+L', action: () => (ui.log = !ui.log) },
          { label: check(ui.syncBrowse, t('files.sync_browse')), hint: 'Ctrl+Y', action: () => (ui.syncBrowse = !ui.syncBrowse) },
          { label: check(hideAddress, t('files.hide_address')), action: () => (hideAddress = !hideAddress) },
          { separator: true, label: '' },
          { label: check(prefs.value.theme === 'dark', t('prefs.theme.dark')), action: () => setTheme('dark') },
          { label: check(prefs.value.theme === 'light', t('prefs.theme.light')), action: () => setTheme('light') },
          { label: check(prefs.value.theme === 'system', t('prefs.theme.system')), action: () => setTheme('system') },
          { separator: true, label: '' },
          { label: t('menu.zoom_in'), hint: 'Ctrl+=', action: () => zoom(10) },
          { label: t('menu.zoom_out'), hint: 'Ctrl+-', action: () => zoom(-10) },
          { label: t('menu.zoom_reset', { percent: prefs.value.fontScale }), hint: 'Ctrl+0', action: () => zoom(null) },
        ];
      case 'server':
        return [
          { label: t('menu.reconnect'), hint: 'Ctrl+R', disabled: connection.state !== 'disconnected', action: reconnectLast },
          { label: t('common.disconnect'), hint: 'Ctrl+D', disabled: !connected, action: () => void connection.disconnect() },
          { separator: true, label: '' },
          { label: t('sync.sync_with_server'), disabled: !canSync(), action: () => (sync.choosing = true) },
          { label: t('sync.check'), disabled: !sync.active || sync.checking, action: () => void sync.refresh() },
          { label: t('sync.scan_edits'), disabled: !sync.active || sync.checking, action: () => void sync.refresh({ scanEdits: true }) },
          { separator: true, label: '' },
          { label: t('menu.site_manager'), hint: 'Ctrl+S', action: () => (ui.siteManager = true) },
        ];
      case 'help':
        return [
          { label: t('menu.about', { name: ui.appName }), action: () => (ui.about = true) },
          { separator: true, label: '' },
          { label: t('menu.project_page'), action: () => void openProject() },
          { label: t('menu.report_problem'), danger: true, action: () => void openProject('/issues/new') },
        ];
    }
  }

  function show(id: MenuId, button: HTMLElement) {
    const r = button.getBoundingClientRect();
    open = { id, x: r.left, y: r.bottom };
  }

  function press(e: PointerEvent) {
    // The element focused before the menu; menus take the focus when they open.
    if (!open) {
      lastFocus = document.activeElement;
    }
    e.stopPropagation();
  }
</script>

<nav class="menubar" aria-label={t('menu.label')}>
  {#each ids as id (id)}
    <button
      class="menu"
      class:active={open?.id === id}
      aria-haspopup="menu"
      aria-expanded={open?.id === id}
      onpointerdown={press}
      onclick={(e) => toggle(id, e.currentTarget)}
      onmouseenter={(e) => open && open.id !== id && show(id, e.currentTarget)}
    >
      {t(`menu.${id}`)}
    </button>
  {/each}
</nav>

{#if open}
  {#key open.id}
    <ContextMenu x={open.x} y={open.y} items={items(open.id)} onClose={close} />
  {/key}
{/if}

<style>
  .menubar {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-right: 14px;
  }

  .menu {
    height: 26px;
    padding: 0 8px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 12.5px;
    cursor: default;
  }

  .menu:hover,
  .menu.active {
    background: var(--selected-bg);
    color: var(--text-strong);
  }
</style>
