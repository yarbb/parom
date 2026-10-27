<script lang="ts">
  import { untrack } from 'svelte';
  import { APP_INSTALL_URL, github, openGitHub, TOKEN_SETTINGS_URL } from '../lib/github.svelte';
  import { t } from '../lib/i18n';
  import {
    addComment,
    checkRuns,
    counts,
    countItems,
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
    loading = true;
    error = '';
    try {
      const list = await listItems(slug, kind, filter);
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

  async function loadDetail(n: number) {
    comments = [];
    pull = null;
    checks = null;
    try {
      comments = await listComments(slug, n);
      if (kind === 'pulls') {
        const p = await getPull(slug, n);
        if (selected === n) {
          pull = p;
          checks = p.head ? await checkRuns(slug, p.head.sha) : null;
        }
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
  <div class="list-pane" style:width="{colWidth('ghIssues', 380)}px">
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
    <div class="list">
      {#each shown as i (i.number)}
        <button class="row" class:selected={i.number === selected} onclick={() => (selected = i.number)}>
          <span class="line1">
            <span class="mono muted">#{i.number}</span>
            <span class="title">{i.title}</span>
            {#each i.labels.slice(0, 2) as l (l.name)}<span class="label">{l.name}</span>{/each}
            {#if i.labels.length > 2}
              <span class="label more" title={i.labels.slice(2).map((l) => l.name).join(', ')}>+{i.labels.length - 2}</span>
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
  </div>
  <Splitter
    axis="x"
    label={t('ui.resize')}
    onMove={(d) => resizeCol('ghIssues', 380, d, 260, 760)}
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
      <div class="head">
        <h2>{i.title} <span class="muted">#{i.number}</span></h2>
        <p class="muted">
          {pull?.merged ? t('github.merged') : t(`github.state.${i.state}`)}
          {#if i.labels.length}· {i.labels.map((l) => l.name).join(', ')}{/if}
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
    {:else if !error && !loading && github.user}
      <p class="muted note">{t(kind === 'issues' ? 'github.no_issues' : 'github.no_pulls')}</p>
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
    padding: 8px 14px;
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

  .label.more {
    color: var(--muted);
  }

  .label {
    flex: none;
    padding: 1px 6px;
    border: 1px solid var(--line-control);
    border-radius: 3px;
    font-size: 10.5px;
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

  .head {
    padding: 14px;
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
    padding: 6px 14px;
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
