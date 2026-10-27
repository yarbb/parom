<script lang="ts">
  import { connection } from '../lib/connection.svelte';
  import { openGitHub } from '../lib/github.svelte';
  import { t } from '../lib/i18n';
  import { commitFiles, fileDiff, repo, type CommitFile, type FileDiff } from '../lib/repo.svelte';
  import { sync } from '../lib/sync/engine.svelte';
  import { relativeTime } from '../lib/when';
  import DiffView from './DiffView.svelte';
  import Splitter from './Splitter.svelte';
  import { colWidth, prefs, resetCol, resizeCol } from '../lib/prefs.svelte';
  import Avatar from './Avatar.svelte';
  import { avatars, coAuthors } from '../lib/people.svelte';

  // Board Hi: commits with "local HEAD" and "on server" badges, the files a
  // commit changed, and the diff of one of them.
  let selected = $state('');
  let files = $state<CommitFile[]>([]);
  let file = $state('');
  let diff = $state<FileDiff | null>(null);
  let error = $state('');
  let copied = $state(false);

  /** The deployed commit, when the connected site deploys this repository. */
  let serverSha = $derived(
    connection.site?.localDir.trim().toLowerCase() === repo.dir.toLowerCase() ? (sync.check?.marker?.sha ?? null) : null,
  );
  let serverIndex = $derived(serverSha ? repo.log.findIndex((c) => c.sha === serverSha) : -1);
  let commit = $derived(repo.log.find((c) => c.sha === selected) ?? null);
  /** Co-authors come from the message trailers, which are not shown as text. */
  let people = $derived(new Map(repo.log.map((c) => [c.sha, coAuthors(c.body)])));
  let detail = $derived(commit ? people.get(commit.sha) : undefined);

  // Avatars of authors from GitHub's commit list (once per branch and session).
  $effect(() => {
    const slug = repo.info?.github;
    const branch = repo.info?.branch;
    if (slug && branch) {
      void avatars.load(slug, branch);
    }
  });
  let index = $derived(repo.log.findIndex((c) => c.sha === selected));

  $effect(() => {
    if (!repo.log.some((c) => c.sha === selected)) {
      selected = repo.log[0]?.sha ?? '';
    }
  });

  $effect(() => {
    const sha = selected;
    copied = false;
    files = [];
    file = '';
    if (!sha) {
      return;
    }
    commitFiles(repo.dir, sha)
      .then((f) => {
        if (sha === selected) {
          files = f;
          file = f[0]?.path ?? '';
          error = '';
        }
      })
      .catch((e) => (error = String(e)));
  });

  $effect(() => {
    const sha = selected;
    const path = file;
    diff = null;
    if (!sha || !path) {
      return;
    }
    fileDiff(repo.dir, path, sha)
      .then((d) => sha === selected && path === file && (diff = d))
      .catch((e) => (error = String(e)));
  });

  async function copySha() {
    await navigator.clipboard.writeText(selected).catch(() => {});
    copied = true;
  }

  const tone: Record<CommitFile['status'], string> = { new: 'status-new', modified: 'status-modified', deleted: 'status-removed' };
</script>

<div class="history">
  <div class="commits" style:width="{colWidth('ghHistory', 340)}px">
    <div class="section-label">{t('github.commits', { branch: repo.info?.branch ?? 'HEAD', count: repo.log.length })}</div>
    <div class="list">
      {#each repo.log as c (c.sha)}
        {@const co = people.get(c.sha)?.people ?? []}
        <button class="row" class:selected={c.sha === selected} onclick={() => (selected = c.sha)}>
          <span class="line1">
            <span class="summary">{c.summary}</span>
            {#if c.sha === repo.info?.head}<span class="badge">{t('github.badge.head')}</span>{/if}
            {#if c.sha === serverSha}<span class="badge server">{t('github.badge.server')}</span>{/if}
          </span>
          <span class="line2 muted">
            <span class="faces" title={[c.author, ...co.map((p) => p.name)].join(', ')}>
              <Avatar name={c.author} src={avatars.of(c.email, c.sha)} size={16} />
              {#each co as p (p.email)}<span class="co"><Avatar name={p.name} src={avatars.of(p.email)} size={16} /></span>{/each}
            </span>
            <span class="mono">{c.sha.slice(0, 7)}</span> · {c.author}{co.length ? ` +${co.length}` : ''} · {relativeTime(c.time * 1000)}
          </span>
        </button>
      {:else}
        <p class="muted empty">{t('github.no_commits')}</p>
      {/each}
    </div>
  </div>
  <Splitter
    axis="x"
    label={t('ui.resize')}
    onMove={(d) => resizeCol('ghHistory', 340, d, 240, 700)}
    onEnd={() => prefs.persist()}
    onReset={() => resetCol('ghHistory')}
  />
  {#if commit}
    <div class="detail">
      <div class="info">
        <h2>{commit.summary}</h2>
        <p class="muted">
          <span class="mono">{commit.sha.slice(0, 7)}</span> · {relativeTime(commit.time * 1000)}
          {#if serverIndex > index && index >= 0}· {t('github.ahead_of_server', { count: serverIndex - index })}{/if}
        </p>
        <div class="authors">
          <span class="person"><Avatar name={commit.author} src={avatars.of(commit.email, commit.sha)} size={20} />{commit.author}</span>
          {#each detail?.people ?? [] as p (p.email)}
            <span class="person co-person" title={p.email}><Avatar name={p.name} src={avatars.of(p.email)} size={20} />{p.name}</span>
          {/each}
        </div>
        {#if detail?.body}<p class="body">{detail.body}</p>{/if}
        <div class="buttons">
          <button class="control small" onclick={copySha}>{copied ? t('github.copied') : t('github.copy_sha')}</button>
          {#if repo.info?.github}
            <button class="control small" onclick={() => openGitHub(`https://github.com/${repo.info!.github}/commit/${commit!.sha}`)}>
              {t('github.view_on_github')}
            </button>
          {/if}
        </div>
      </div>
      <div class="section-label">{t('github.files_changed', { count: files.length })}</div>
      <div class="files">
        {#each files as f (f.path)}
          <button class="file" class:selected={f.path === file} onclick={() => (file = f.path)}>
            <span class="mono path {tone[f.status]}">{f.path}</span>
            {#if f.additions}<span class="mono status-new">+{f.additions}</span>{/if}
            {#if f.deletions}<span class="mono status-removed">−{f.deletions}</span>{/if}
          </button>
        {/each}
      </div>
      {#if error}<p class="status-removed empty">{error}</p>{/if}
      {#if file}<DiffView path={file} {diff} loading={!diff} />{/if}
    </div>
  {/if}
</div>

<style>
  .history {
    flex: 1;
    min-height: 0;
    display: flex;
  }

  .commits {
    flex: none;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--line);
  }

  .list {
    flex: 1;
    overflow: auto;
  }

  .detail {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .row,
  .file {
    display: flex;
    width: 100%;
    border: 0;
    border-bottom: 1px solid var(--line-row);
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .row {
    flex-direction: column;
    gap: 3px;
    padding: 8px 14px;
  }

  .row.selected,
  .file.selected {
    background: var(--selected-bg);
    box-shadow: inset 2px 0 0 var(--selected-mark);
    color: var(--text-strong);
  }

  .line1 {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .summary,
  .path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .faces {
    display: inline-flex;
    align-items: center;
    margin-right: 6px;
    vertical-align: -4px;
  }

  .co {
    display: inline-flex;
    margin-left: -6px;
  }

  .authors {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    margin: 0 0 8px;
  }

  .person {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }

  .co-person {
    color: var(--muted);
  }

  .line2 {
    font-size: 11px;
  }

  .badge {
    flex: none;
    padding: 1px 6px;
    border: 1px solid var(--line-control);
    border-radius: 3px;
    font-size: 10.5px;
  }

  .badge.server {
    border-color: var(--new);
    color: var(--new);
  }

  .info {
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
    margin: 0 0 8px;
  }

  .body {
    white-space: pre-wrap;
  }

  .buttons {
    display: flex;
    gap: 6px;
  }

  .files {
    flex: none;
    max-height: 30%;
    overflow: auto;
  }

  .file {
    gap: 10px;
    padding: 6px 14px;
    font-size: 12px;
  }

  .empty {
    padding: 12px 14px;
    margin: 0;
  }
</style>
