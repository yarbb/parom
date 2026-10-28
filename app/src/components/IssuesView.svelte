<script lang="ts">
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte';
  import EmptyState from './EmptyState.svelte';
  import CircleDot from '@lucide/svelte/icons/circle-dot';
  import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
  import IssueLabel from './IssueLabel.svelte';
  import { untrack } from 'svelte';
  import { APP_INSTALL_URL, github, openGitHub, TOKEN_SETTINGS_URL } from '../lib/github.svelte';
  import { t } from '../lib/i18n';
  import {
    addComment,
    checkRuns,
    counts,
    countItems,
    detailCache,
    keepUnchanged,
    listCache,
    getPull,
    listComments,
    listItems,
    mergePull,
    setState,
    type CheckRun,
    type Comment,
    type Item,
    type Kind,
    type PullDetail,
  } from '../lib/issues.svelte';
  import { repo } from '../lib/repo.svelte';
  import { relativeTime } from '../lib/when';
  import Markdown from './Markdown.svelte';
  import NewIssueDialog from './NewIssueDialog.svelte';
  import MarkdownEditor from './MarkdownEditor.svelte';
  import Modal from './Modal.svelte';
  import Splitter from './Splitter.svelte';
  import { colWidth, prefs, resetCol, resizeCol } from '../lib/prefs.svelte';

  // Boards Ix and Pr: list (search, open / closed) and the selected item with
  // its comments, a comment box, close / reopen and (pull requests) merge.
  let { kind, slug }: { kind: Kind; slug: string } = $props();

  let filter = $state<'open' | 'closed'>('open');
  let items = $state<Item[]>([]);
  let closedCount = $state<number | null>(null);
  let query = $state('');
  let selected = $state<number | null>(null);
  let comments = $state<Comment[]>([]);
  let pull = $state<PullDetail | null>(null);
  let checks = $state<CheckRun[] | null>(null);
  let draft = $state('');
  let loading = $state(false);
  let busy = $state(false);
  let error = $state('');
  let confirmMerge = $state(false);
  let creating = $state(false);

  async function created(issue: Item) {
    filter = 'open';
    await load();
    selected = issue.number;
    void counts.load(slug);
  }

  const ms = (iso: string) => Date.parse(iso);

  async function load() {
    const want = { kind, slug, filter };
    const key = `${slug}:${kind}:${filter}`;
    const cached = listCache.get(key);
    if (cached) {
      // Seen in this session: show it now; the fresh list follows.
      items = cached;
      if (!cached.some((i) => i.number === selected)) {
        selected = cached[0]?.number ?? null;
      }
    }
    loading = !cached;
    error = '';
    try {
      const list = keepUnchanged(await listItems(slug, kind, filter), listCache.get(key), (i) => i.number);
      listCache.set(key, list);
      if (want.kind === kind && want.slug === slug && want.filter === filter) {
        items = list;
        if (!list.some((i) => i.number === selected)) {
          selected = list[0]?.number ?? null;
        }
      }
    } catch (e) {
      error = String(e);
      items = [];
      selected = null;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void kind;
    void slug;
    void filter;
    void load();
  });

  $effect(() => {
    void kind;
    countItems(slug, kind, 'closed')
      .then((n) => (closedCount = n))
      .catch(() => (closedCount = null));
  });

  const detailKey = (n: number) => `${slug}:${kind}:${n}`;

  async function loadDetail(n: number) {
    const cached = detailCache.get(detailKey(n));
    comments = cached?.comments ?? [];
    pull = cached?.pull ?? null;
    checks = cached?.checks ?? null;
    try {
      const fresh = keepUnchanged(await listComments(slug, n), cached?.comments, (c) => c.id);
      let p = cached?.pull ?? null;
      let runs = cached?.checks ?? null;
      if (kind === 'pulls') {
        const got = await getPull(slug, n);
        p = cached?.pull && cached.pull.updated_at === got.updated_at ? cached.pull : got;
        runs = p.head ? await checkRuns(slug, p.head.sha) : null;
      }
      detailCache.set(detailKey(n), { comments: fresh, pull: p, checks: runs });
      if (selected === n) {
        comments = fresh;
        pull = p;
        checks = runs;
      }
    } catch (e) {
      error = String(e);
    }
  }

  // Each issue keeps its own unsent comment while others are looked at.
  const drafts = new Map<number, string>();
  let draftFor: number | null = null;

  $effect(() => {
    const n = selected;
    untrack(() => {
      if (draftFor !== null) {
        drafts.set(draftFor, draft);
      }
      draftFor = n;
      draft = n !== null ? (drafts.get(n) ?? '') : '';
    });
    if (n !== null) {
      void loadDetail(n);
    }
  });

  let shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return items;
    }
    const num = Number(q.replace(/^#/, ''));
    return items.filter((i) => i.title.toLowerCase().includes(q) || i.number === num);
  });
  let item = $derived(items.find((i) => i.number === selected) ?? null);

  async function act(f: () => Promise<unknown>) {
    busy = true;
    error = '';
    try {
      await f();
    } catch (e) {
      error = String(e);
    } finally {
      busy = false;
    }
  }

  async function postComment(n: number) {
    const c = await addComment(slug, n, draft.trim());
    comments = [...comments, c];
    const d = detailCache.get(detailKey(n));
    if (d) {
      d.comments = comments;
    }
    items = items.map((i) => (i.number === n ? { ...i, comments: i.comments + 1 } : i));
    draft = '';
  }

  const comment = (n: number) => act(() => postComment(n));

  const toggleState = (i: Item) =>
    act(async () => {
      // A comment typed before closing goes with it, like on github.com.
      if (draft.trim()) {
        await postComment(i.number);
      }
      await setState(slug, kind, i.number, i.state === 'open' ? 'closed' : 'open');
      await load();
      void counts.load(slug);
    });

  let rowMenu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const copy = (text: string) => void navigator.clipboard?.writeText(text);

  /** Right click on an issue or pull request in the list. */
  function openRowMenu(e: MouseEvent, i: Item) {
    e.preventDefault();
    const open = i.state === 'open';
    rowMenu = {
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: t('issues.menu.open'), action: () => (selected = i.number) },
        { label: t('github.view_on_github'), action: () => openGitHub(i.html_url) },
        { separator: true, label: '' },
        { label: t('issues.menu.copy_link'), action: () => copy(i.html_url) },
        { label: t('issues.menu.copy_number', { number: i.number }), action: () => copy(`#${i.number}`) },
        { label: t('issues.menu.copy_title'), action: () => copy(i.title) },
        // Commits with "Fixes #N" close the issue once a sync deploys them.
        ...(kind === 'issues' ? [{ label: t('issues.menu.copy_fixes', { number: i.number }), action: () => copy(`Fixes #${i.number}`) }] : []),
        { separator: true, label: '' },
        {
          label: open ? t(kind === 'issues' ? 'github.close_issue' : 'github.close_pr') : t('github.reopen'),
          danger: open,
          disabled: busy || !!i.merged_at,
          action: () =>
            act(async () => {
              await setState(slug, kind, i.number, open ? 'closed' : 'open');
              await load();
              void counts.load(slug);
            }),
        },
      ],
    };
  }

  const merge = (n: number) =>
    act(async () => {
      confirmMerge = false;
      await mergePull(slug, n);
      await load();
      void counts.load(slug);
      // The merge commit is on GitHub; fetching shows it under "Pull origin".
      void repo.remote('fetch');
    });

  let noAccess = $derived(/not accessible|404|403/i.test(error));
  let openCount = $derived(kind === 'issues' ? counts.issues : counts.pulls);

  function checkTone(c: CheckRun): string {
    if (c.status !== 'completed') {
      return 'status-modified';
    }
    return c.conclusion === 'success' || c.conclusion === 'skipped' || c.conclusion === 'neutral' ? 'status-new' : 'status-removed';
  }

  const duration = (c: CheckRun) =>
    c.started_at && c.completed_at ? `${Math.max(0, Math.round((ms(c.completed_at) - ms(c.started_at)) / 1000))}s` : '';
</script>

<div class="issues">
  <div class="list-pane" style:width="{colWidth('ghIssues', 400)}px">
    <div class="filters">
      <div class="search-row">
        <input class="field search" placeholder={t(kind === 'issues' ? 'github.search_issues' : 'github.search_pulls')} bind:value={query} />
        {#if kind === 'issues'}
          <button class="control" onclick={() => (creating = true)}>{t('github.new_issue.button')}</button>
        {/if}
      </div>
      <div class="states">
        <button class="state" class:active={filter === 'open'} onclick={() => (filter = 'open')}>
          {t('github.state.open')}{openCount !== null ? ` ${openCount}` : ''}
        </button>
        <button class="state" class:active={filter === 'closed'} onclick={() => (filter = 'closed')}>
          {t('github.state.closed')}{closedCount !== null ? ` ${closedCount}` : ''}
        </button>
      </div>
    </div>
    {#key filter}
    <div class="list">
      {#each shown as i (i.number)}
        <button
          class="row"
          class:selected={i.number === selected}
          onclick={() => (selected = i.number)}
          oncontextmenu={(e) => openRowMenu(e, i)}
        >
          <span class="line1">
            <span class="mono muted">#{i.number}</span>
            <span class="title">{i.title}</span>
            {#each i.labels.slice(0, 2) as l (l.name)}<IssueLabel name={l.name} color={l.color} />{/each}
            {#if i.labels.length > 2}
              <IssueLabel name="+{i.labels.length - 2}" title={i.labels.slice(2).map((l) => l.name).join(', ')} />
            {/if}
          </span>
          <span class="line2 muted">
            {#if kind === 'pulls'}
              {i.merged_at ? t('github.merged') : ''}{i.draft ? t('github.draft') : ''}
              {t('github.wants_to_merge', { user: i.user?.login ?? '', base: i.base?.ref ?? '' })}
            {:else}
              {t('github.opened_by', { user: i.user?.login ?? '', when: relativeTime(ms(i.created_at)) })}
              {#if i.comments}· {t('github.comments', { count: i.comments })}{/if}
            {/if}
          </span>
        </button>
      {:else}
        <p class="muted note">{loading ? t('files.loading') : t(kind === 'issues' ? 'github.no_issues' : 'github.no_pulls')}</p>
      {/each}
    </div>
    {/key}
  </div>
  <Splitter
    axis="x"
    label={t('ui.resize')}
    onMove={(d) => resizeCol('ghIssues', 400, d, 260, 760)}
    onEnd={() => prefs.persist()}
    onReset={() => resetCol('ghIssues')}
  />
  <div class="detail">
    {#if error}
      <div class="note">
        <p class="status-removed">{error}</p>
        {#if noAccess}
          {@const how = github.user?.kind ?? 'other'}
          <p class="muted">{t(`github.no_access.${how}`, { repo: slug, owner: slug.split('/')[0] })}</p>
          {#if how === 'app'}
            <button class="control" onclick={() => openGitHub(APP_INSTALL_URL)}>{t('github.install_app')}</button>
          {:else if TOKEN_SETTINGS_URL[how]}
            <button class="control" onclick={() => openGitHub(TOKEN_SETTINGS_URL[how])}>{t('github.edit_token')}</button>
          {/if}
        {/if}
      </div>
    {/if}
    {#if item}
      {@const i = item}
      {#key i.number}
      <div class="opened">
      <div class="head">
        <h2>{i.title} <span class="muted">#{i.number}</span></h2>
        <p class="muted">
          {pull?.merged ? t('github.merged') : t(`github.state.${i.state}`)}
          {#each i.labels as l (l.name)} <IssueLabel name={l.name} color={l.color} />{/each}
          {#if i.assignees.length}· {t('github.assigned', { users: i.assignees.map((a) => a.login).join(', ') })}{/if}
        </p>
        {#if pull}
          <p class="mono muted">
            {pull.head?.label} → {pull.base?.ref} · <span class="status-new">+{pull.additions}</span>
            <span class="status-removed">−{pull.deletions}</span> · {t('github.files_count', { count: pull.changed_files })}
          </p>
        {/if}
      </div>
      <div class="thread">
        {#if checks && checks.length}
          <div class="section-label">{t('github.checks')}</div>
          <div class="checks">
            {#each checks as c (c.id)}
              <div class="check mono">
                <span class={checkTone(c)}>{c.status !== 'completed' ? '●' : c.conclusion === 'success' ? '✓' : '✕'}</span>
                <span class="grow">{c.name}</span>
                <span class="muted">{duration(c)}</span>
              </div>
            {/each}
          </div>
        {/if}
        <div class="post">
          <div class="who muted">{i.user?.login} · {relativeTime(ms(i.created_at))}</div>
          {#if i.body?.trim()}
            <Markdown html={(pull ?? i).body_html} text={i.body} />
          {:else}
            <div class="muted">{t('github.no_description')}</div>
          {/if}
        </div>
        {#each comments as c (c.id)}
          <div class="post">
            <div class="who muted">{c.user?.login} · {relativeTime(ms(c.created_at))}</div>
            <Markdown html={c.body_html} text={c.body} />
          </div>
        {/each}
      </div>
      <div class="reply">
        <MarkdownEditor bind:value={draft} rows={3} placeholder={t('github.leave_comment')} />
        <div class="buttons">
          <button class="control" onclick={() => openGitHub(i.html_url)}>{t('github.view_on_github')}</button>
          <span class="grow"></span>
          {#if !pull?.merged}
            <!-- Like on github.com: a typed comment is posted with the close / reopen. -->
            <button class="control" disabled={busy} onclick={() => toggleState(i)}>
              {i.state === 'open'
                ? draft.trim()
                  ? t('github.close_with_comment')
                  : t(kind === 'issues' ? 'github.close_issue' : 'github.close_pr')
                : draft.trim()
                  ? t('github.reopen_with_comment')
                  : t('github.reopen')}
            </button>
          {/if}
          <button class="control" class:primary={!(pull && i.state === 'open')} disabled={busy || !draft.trim()} onclick={() => comment(i.number)}>
            {t('github.comment')}
          </button>
          {#if pull && i.state === 'open'}
            <button
              class="control primary"
              disabled={busy || pull.mergeable === false || pull.draft}
              title={pull.mergeable === false ? t('github.not_mergeable') : ''}
              onclick={() => (confirmMerge = true)}
            >
              {t('github.merge_pr')}
            </button>
          {/if}
        </div>
      </div>
      </div>
      {/key}
    {:else if !error && !loading && github.user}
      {#if items.length}
        <EmptyState icon={kind === 'issues' ? CircleDot : GitPullRequest} title={t('empty.pick_issue')} />
      {:else}
        <EmptyState icon={kind === 'issues' ? CircleDot : GitPullRequest} title={t(kind === 'issues' ? 'github.no_issues' : 'github.no_pulls')} />
      {/if}
    {/if}
  </div>
</div>

{#if creating}
  <NewIssueDialog {slug} onClose={() => (creating = false)} onCreated={created} />
{/if}

{#if confirmMerge && item}
  {@const i = item}
  <Modal title={t('github.merge_pr')} onCancel={() => (confirmMerge = false)}>
    <p>{t('github.merge_confirm', { number: i.number, head: pull?.head?.label ?? '', base: pull?.base?.ref ?? '' })}</p>
    {#snippet actions()}
      <button class="control" onclick={() => (confirmMerge = false)}>{t('common.cancel')}</button>
      <button class="control primary" onclick={() => merge(i.number)}>{t('github.merge_pr')}</button>
    {/snippet}
  </Modal>
{/if}

{#if rowMenu}
  <ContextMenu x={rowMenu.x} y={rowMenu.y} items={rowMenu.items} onClose={() => (rowMenu = null)} />
{/if}

<style>
  .issues {
    flex: 1;
    min-height: 0;
    display: flex;
  }

  .list-pane {
    flex: none;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--line);
  }

  .filters {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--line);
  }

  .search-row {
    display: flex;
    gap: 8px;
  }

  .search {
    flex: 1;
    min-width: 0;
  }

  .states {
    display: flex;
    gap: 14px;
  }

  .state {
    padding: 2px 0;
    border: 0;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .state.active {
    color: var(--text-strong);
    box-shadow: inset 0 -2px 0 var(--selected-mark);
  }

  .list {
    flex: 1;
    overflow: auto;
  }

  .row {
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 100%;
    padding: 10px 14px;
    border: 0;
    border-bottom: 1px solid var(--line-row);
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .row.selected {
    background: var(--selected-bg);
    box-shadow: inset 2px 0 0 var(--selected-mark);
    color: var(--text-strong);
  }

  .line1 {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    font-size: 12.5px;
  }

  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .line2 {
    font-size: 11px;
  }

  .detail {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .opened {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    animation: fade-in var(--motion) ease-out;
  }

  .list {
    animation: fade-in var(--motion) ease-out;
  }

  .head {
    padding: 18px 22px 14px;
    border-bottom: 1px solid var(--line);
  }

  h2 {
    margin: 0 0 6px;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-strong);
  }

  p {
    margin: 0 0 6px;
  }

  .thread {
    flex: 1;
    overflow: auto;
  }

  .checks {
    padding: 6px 22px;
  }

  .check {
    display: flex;
    gap: 10px;
    padding: 3px 0;
    font-size: 12px;
  }

  .grow {
    flex: 1;
  }

  .post {
    padding: 12px 14px;
    border-bottom: 1px solid var(--line-row);
  }

  .who {
    margin-bottom: 6px;
    font-size: 11.5px;
  }


  .reply {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
    border-top: 1px solid var(--line);
  }


  .buttons {
    display: flex;
    gap: 8px;
  }

  .note {
    padding: 12px 14px;
    margin: 0;
  }
</style>
