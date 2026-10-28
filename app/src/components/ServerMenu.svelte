<script lang="ts">
  import { connection } from '../lib/connection.svelte';
  import { t } from '../lib/i18n';
  import { recentLabel, type RecentServer } from '../lib/recent';
  import { sites, type Site } from '../lib/sites.svelte';
  import { ui } from '../lib/ui.svelte';
  import { prefs } from '../lib/prefs.svelte';

  // Top bar server selector: the current server, plus recent ones to reconnect.
  let { hideAddress }: { hideAddress: boolean } = $props();

  let open = $state(false);
  let root: HTMLDivElement;

  const hidden = $derived(t('topbar.address_hidden'));
  const blur = $derived(prefs.value.hideStyle === 'blur');
  let current = $derived(
    connection.state === 'disconnected' ? t('topbar.no_server') : hideAddress && !blur ? hidden : connection.label,
  );

  function choose(s: RecentServer) {
    open = false;
    void connection.pick(s);
  }

  function chooseSite(s: Site) {
    open = false;
    connection.pickedSite = { site: s };
  }

  function onWindowClick(e: MouseEvent) {
    if (open && !root.contains(e.target as Node)) {
      open = false;
    }
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      open = false;
    }
  }
</script>

<svelte:window onclick={onWindowClick} />

<div class="menu" bind:this={root} {onkeydown} role="presentation">
  <button class="control mono" aria-haspopup="menu" aria-expanded={open} onclick={() => (open = !open)}
    ><span class:secret={hideAddress && blur && connection.state !== 'disconnected'}>{current}</span> ▾</button
  >
  {#if open}
    <div class="list" role="menu">
      <button class="pick" role="menuitem" onclick={() => ((open = false), (ui.siteManager = true))}>{t('sites.title')}...</button>
      {#if sites.list.length}
        <div class="title">{t('sites.sites')}</div>
        {#each sites.list as s (s.id)}
          <button class="pick mono" role="menuitem" onclick={() => chooseSite(s)}>
            {s.folder ? `${s.folder} / ` : ''}{s.name}{#if !hideAddress || blur}<span class:secret={hideAddress}>{`  ·  ${s.host}`}</span>{/if}
          </button>
        {/each}
      {/if}
      <div class="title">{t('topbar.recent')}</div>
      {#each connection.recent as s (recentLabel(s, false, ''))}
        <div class="item">
          <button class="pick mono" role="menuitem" onclick={() => choose(s)}
            ><span class:secret={hideAddress && blur}>{recentLabel(s, hideAddress && !blur, hidden)}</span></button
          >
          <button class="forget" aria-label={t('topbar.forget')} title={t('topbar.forget')} onclick={() => connection.forget(s)}>✕</button>
        </div>
      {:else}
        <div class="empty muted">{t('topbar.no_recent')}</div>
      {/each}
      {#if connection.state === 'connected'}
        <button class="pick disconnect" role="menuitem" onclick={() => ((open = false), connection.disconnect())}>
          {t('common.disconnect')}
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .menu {
    position: relative;
  }

  .list {
    position: absolute;
    right: 0;
    top: 32px;
    min-width: 280px;
    max-width: 420px;
    padding: 4px 0;
    border: 1px solid var(--line-control);
    border-radius: 4px;
    background: var(--panel);
    z-index: 5;
    transform-origin: top right;
    animation: pop-in var(--motion) ease-out;
  }

  .title {
    padding: 6px 12px;
    color: var(--muted);
    font-size: 10.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .item {
    display: flex;
    align-items: center;
  }

  .pick,
  .forget {
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  /* Rows are as wide as the menu, so the highlight reaches its edge. */
  .pick {
    display: block;
    width: 100%;
    flex: 1;
    min-width: 0;
    padding: 7px 12px;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* A recent server is one row: the highlight covers the name and the ✕. */
  .pick:hover,
  .item:hover {
    background: var(--selected-bg);
    color: var(--text-strong);
  }

  .item:hover .pick,
  .forget:hover {
    color: var(--text-strong);
  }

  .item .pick:hover {
    background: none;
  }

  .forget {
    width: 30px;
    padding: 7px 0;
    color: var(--muted);
  }

  .disconnect {
    display: block;
    width: 100%;
    border-top: 1px solid var(--line-row);
    margin-top: 4px;
  }

  .empty {
    padding: 7px 12px;
    font-size: 12px;
  }
</style>
