<script lang="ts">
  import { indicator } from '../lib/indicator';
  import { onMount } from 'svelte';
  import { open as openDialog } from '@tauri-apps/plugin-dialog';
  import { isTauri } from '@tauri-apps/api/core';
  import { connection } from '../lib/connection.svelte';
  import { github } from '../lib/github.svelte';
  import { t } from '../lib/i18n';
  import { repo, repoName } from '../lib/repo.svelte';
  import { sync } from '../lib/sync/engine.svelte';
  import { ui } from '../lib/ui.svelte';
  import { relativeTime } from '../lib/when';
  import ChangesView from './ChangesView.svelte';
  import HistoryView from './HistoryView.svelte';
  import IssuesView from './IssuesView.svelte';
  import BackupsList from './BackupsList.svelte';
  import { sites } from '../lib/sites.svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { openGitHub } from '../lib/github.svelte';
  import { openInEditor } from '../lib/local';
  import type { BranchInfo, RepoChoice } from '../lib/repo.svelte';
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte';
  import { counts } from '../lib/issues.svelte';
  import SignedOut from './SignedOut.svelte';
  import SyncBar from './SyncBar.svelte';
  import Splitter from './Splitter.svelte';
  import { colWidth, prefs, resetCol, resizeCol } from '../lib/prefs.svelte';

  // Boards Bd, Hi, Ix, Pr, Bk: toolbar (repository, branch, fetch / pull /
  // push), sidebar, and the page. Changes and History work without signing in.
  let { name }: { name: string } = $props();

  type Page = 'changes' | 'history' | 'issues' | 'pulls' | 'backups';
  let page = $state<Page>('changes');
  /** Pages opened so far; they stay mounted (hidden) so nothing typed is lost. */
  let visited = $state<Page[]>(['changes']);
  $effect(() => {
    if (!visited.includes(page)) {
      visited = [...visited, page];
    }
  });
  let menuOpen = $state(false);
  let accountOpen = $state(false);
  let menuRoot: HTMLDivElement;
  let accountRoot: HTMLDivElement;
  let addError = $state('');

  onMount(() => {
    if (!github.checked) {
      void github.load();
    }
    if (!repo.dir && repo.choices.length) {
      void repo.select(repo.choices[0].dir);
    } else {
      void repo.refresh();
    }
    // Picks up commits and edits made in other programs, like GitHub Desktop.
    const onFocus = () => void repo.refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  });

  // Connecting to a site with a repository shows that repository.
  $effect(() => {
    const dir = connection.site?.localDir.trim();
    if (dir && dir !== repo.dir) {
      void repo.select(dir);
    }
  });

  // Right-click on a repository in the menu.
  let context = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);

  async function openContext(e: MouseEvent, c: RepoChoice) {
    e.preventDefault();
    const info = await invoke<BranchInfo>('repo_info', { dir: c.dir }).catch(() => null);
    context = {
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: t('github.repo.open'), action: () => void openInEditor(c.dir, '') },
        {
          label: t('github.view_on_github'),
          disabled: !info?.github,
          action: () => void openGitHub(`https://github.com/${info?.github}`),
        },
        { label: t('github.repo.copy_path'), action: () => void navigator.clipboard.writeText(c.dir).catch(() => {}) },
        { separator: true, label: '' },
        {
          label: c.site ? t('github.repo.hide', { site: c.site }) : t('github.repo.remove'),
          action: () => {
            menuOpen = false;
            void repo.remove(c.dir);
          },
        },
      ],
    };
  }

  async function addRepo() {
    menuOpen = false;
    addError = '';
    if (!isTauri()) {
      return;
    }
    const dir = await openDialog({ directory: true, multiple: false });
    if (typeof dir === 'string') {
      await repo.add(dir).catch((e) => (addError = t('github.not_a_repo', { reason: String(e) })));
    }
  }

  function onWindowClick(e: MouseEvent) {
    if (menuOpen && !context && !menuRoot?.contains(e.target as Node)) {
      menuOpen = false;
    }
    if (accountOpen && !accountRoot?.contains(e.target as Node)) {
      accountOpen = false;
    }
  }

  let info = $derived(repo.info);
  let remoteAction = $derived.by((): { op: 'fetch' | 'pull' | 'push'; label: string } => {
    const remote = info?.remote ?? 'origin';
    if (repo.busy === 'fetch' || repo.busy === 'pull' || repo.busy === 'push') {
      return { op: repo.busy, label: t(`github.busy.${repo.busy}`) };
    }
    if (info?.branch && !info.upstream && info.remote_url) {
      return { op: 'push', label: t('github.publish_branch') };
    }
    if (info?.behind) {
      return { op: 'pull', label: t('github.pull_origin', { remote, count: info.behind }) };
    }
    if (info?.ahead) {
      return { op: 'push', label: t('github.push_origin', { remote, count: info.ahead }) };
    }
    return { op: 'fetch', label: t('github.fetch_origin', { remote }) };
  });
  // Sidebar counts need an account and a remote on github.com.
  $effect(() => {
    const slug = github.user ? (info?.github ?? null) : null;
    void counts.load(slug);
  });

  /** Sites that deploy this repository (their backups are listed). */
  let repoSites = $derived(sites.list.filter((s) => s.localDir.trim() && s.localDir.trim().toLowerCase() === repo.dir.toLowerCase()));

  let showSyncBar = $derived(sync.active && connection.site?.localDir.trim().toLowerCase() === repo.dir.toLowerCase());
</script>

<svelte:window onclick={onWindowClick} />

<div class="toolbar">
  <div class="menu" bind:this={menuRoot}>
    <button class="control mono" aria-haspopup="menu" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>
      {repo.dir ? (info?.github ?? repoName(repo.dir)) : t('github.choose_repo')} ▾
    </button>
    {#if menuOpen}
      <div class="list menu-unroll" role="menu">
        {#each repo.choices as c (c.dir)}
          <button
            class="pick"
            role="menuitem"
            class:current={c.dir === repo.dir}
            onclick={() => ((menuOpen = false), repo.select(c.dir))}
            oncontextmenu={(e) => openContext(e, c)}
          >
            <span class="mono">{repoName(c.dir)}</span>
            <span class="muted small">{c.site ? `${c.site} · ` : ''}{c.dir}</span>
          </button>
        {/each}
        <button class="pick add" role="menuitem" onclick={addRepo}>{t('github.add_repo')}</button>
      </div>
    {/if}
  </div>
  {#if info?.branch}<span class="mono branch" title={info.upstream ?? ''}>⎇ {info.branch}</span>{/if}
  {#if repo.dir && info?.remote_url}
    <button
      class="control"
      disabled={!!repo.busy}
      title={`${info.remote}: ${info.remote_url}${repo.fetchedAt ? ` · ${t('github.last_fetched', { when: relativeTime(repo.fetchedAt) })}` : ''}`}
      onclick={() => repo.remote(remoteAction.op)}
    >
      ⟳ {remoteAction.label}
    </button>
  {/if}
  {#if repo.error || addError}
    <span class="error status-removed" title={repo.error || addError}>{repo.error || addError}</span>
  {/if}
</div>

{#if showSyncBar}<SyncBar />{/if}

{#if context}
  <ContextMenu x={context.x} y={context.y} items={context.items} onClose={() => (context = null)} />
{/if}

<div class="body">
  <nav class="sidebar" use:indicator={'y'} style:width="{colWidth('ghSidebar', 200)}px">
    <button class="nav" class:active={page === 'changes'} onclick={() => (page = 'changes')}>
      <span>{t('github.changes')}</span>{#if repo.changes.length}<span class="count mono status-modified">{repo.changes.length}</span>{/if}
    </button>
    <button class="nav" class:active={page === 'history'} onclick={() => (page = 'history')}>
      <span>{t('github.history')}</span>
    </button>
    <button class="nav" class:active={page === 'issues'} onclick={() => (page = 'issues')}>
      <span>{t('github.issues')}</span>{#if counts.issues}<span class="count mono">{counts.issues}</span>{/if}
    </button>
    <button class="nav" class:active={page === 'pulls'} onclick={() => (page = 'pulls')}>
      <span>{t('github.pull_requests')}</span>{#if counts.pulls}<span class="count mono">{counts.pulls}</span>{/if}
    </button>
    {#if repoSites.length}
      <div class="group">{t('github.server')}</div>
      <button class="nav" class:active={page === 'backups'} onclick={() => (page = 'backups')}>
        <span>{t('github.backups')}</span>
      </button>
    {/if}
    <span class="spacer"></span>
    <div class="account" bind:this={accountRoot}>
      {#if github.user}
        <button class="who" onclick={() => (accountOpen = !accountOpen)}>
          <img src={github.user.avatar_url} alt="" width="24" height="24" />
          <span class="mono">@{github.user.login}</span>
        </button>
        {#if accountOpen}
          <div class="list up menu-unroll" role="menu">
            <button class="pick" role="menuitem" onclick={() => ((accountOpen = false), openGitHub(`https://github.com/${github.user?.login}`))}>
              {t('github.open_profile')}
            </button>
            <button class="pick" role="menuitem" onclick={() => ((accountOpen = false), (ui.preferencesPage = 'account'), (ui.preferences = true))}>
              {t('menu.preferences')}
            </button>
            <button class="pick danger" role="menuitem" onclick={() => ((accountOpen = false), github.signOut())}>{t('github.sign_out')}</button>
          </div>
        {/if}
      {:else}
        <button class="control wide" onclick={() => (ui.githubSignIn = 'browser')}>{t('github.sign_in')}</button>
      {/if}
    </div>
  </nav>
  <Splitter
    axis="x"
    label={t('ui.resize')}
    onMove={(d) => resizeCol('ghSidebar', 200, d, 150, 360)}
    onEnd={() => prefs.persist()}
    onReset={() => resetCol('ghSidebar')}
  />
  <section class="page">
    {#if !repo.dir}
      <SignedOut {name} repoMissing onAddRepo={addRepo} />
    {:else}
      {#if visited.includes('changes')}
        <div class="view" class:hidden={page !== 'changes'}><ChangesView /></div>
      {/if}
      {#if visited.includes('history')}
        <div class="view" class:hidden={page !== 'history'}><HistoryView /></div>
      {/if}
      {#if visited.includes('backups')}
        <div class="view backups" class:hidden={page !== 'backups'}>
          {#each repoSites as s (s.id)}
            <div class="section-label">{t('backups.title', { server: s.name })}</div>
            <div class="backup-list"><BackupsList site={s} /></div>
          {/each}
        </div>
      {/if}
      {#each ['issues', 'pulls'] as const as kind (kind)}
        {#if visited.includes(kind)}
          <div class="view" class:hidden={page !== kind}>
            {#if !github.user}
              <SignedOut {name} />
            {:else if !info?.github}
              <p class="muted note">{t('github.not_on_github')}</p>
            {:else}
              {#key info.github}<IssuesView {kind} slug={info.github} />{/key}
            {/if}
          </div>
        {/if}
      {/each}
    {/if}
  </section>
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 44px;
    padding: 0 14px;
    border-bottom: 1px solid var(--line);
    flex: none;
  }

  .branch {
    color: var(--muted);
    font-size: 12px;
  }

  .error {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }

  .menu,
  .account {
    position: relative;
  }

  .list {
    position: absolute;
    left: 0;
    top: 32px;
    min-width: 320px;
    max-width: 480px;
    padding: 4px 0;
    border: 1px solid var(--line-control);
    border-radius: 4px;
    background: var(--panel);
    z-index: 5;
  }

  /* The account menu opens upwards, from the account button. */
  .list.up {
    top: auto;
    bottom: 34px;
    min-width: 180px;
  }

  .pick {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    padding: 7px 12px;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }

  .pick:hover,
  .pick.current {
    background: var(--selected-bg);
    color: var(--text-strong);
  }

  .pick .small {
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pick.danger {
    border-top: 1px solid var(--line-row);
    margin-top: 4px;
    color: color-mix(in srgb, var(--removed) 80%, var(--text));
  }

  .pick.danger:hover {
    background: color-mix(in srgb, var(--removed) 12%, transparent);
    color: var(--removed);
  }

  .pick.add {
    border-top: 1px solid var(--line-row);
    margin-top: 4px;
  }

  .body {
    flex: 1;
    min-height: 0;
    display: flex;
  }

  .sidebar {
    position: relative;
    flex: none;
    display: flex;
    flex-direction: column;
    padding: 8px 0;
    border-right: 1px solid var(--line);
  }

  .nav {
    display: flex;
    justify-content: space-between;
    padding: 7px 16px;
    border: 0;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
  }

  .nav.active {
    background: var(--selected-bg);
    color: var(--text-strong);
  }

  .group {
    padding: 14px 16px 6px;
    color: var(--muted);
    font-size: 10.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .backups {
    flex: 1;
    overflow: auto;
  }

  .backup-list {
    padding: 12px 14px;
  }

  .count {
    font-size: 11px;
  }

  .spacer {
    flex: 1;
  }

  .account {
    padding: 8px 12px 4px;
    border-top: 1px solid var(--line);
  }

  .who {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 4px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .who:hover {
    background: var(--selected-bg);
  }

  .who img {
    border-radius: 50%;
  }

  .wide {
    width: 100%;
  }

  .note {
    margin: 0;
    padding: 14px;
  }

  .view {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    animation: fade-in var(--motion) ease-out;
  }

  .view.hidden {
    display: none;
  }

  .page {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
</style>
