<script lang="ts">
  import { t } from '../lib/i18n';
  import type { FileDiff } from '../lib/repo.svelte';

  // Unified diff of one file (board Bd, right side).
  let { path, diff, loading = false, error = '' }: { path: string; diff: FileDiff | null; loading?: boolean; error?: string } = $props();
</script>

<div class="diff">
  <div class="section-label mono name">{path}</div>
  <div class="body mono">
    {#if error}
      <p class="status-removed note">{error}</p>
    {:else if loading && !diff}
      <p class="muted note">{t('files.loading')}</p>
    {:else if diff?.binary}
      <p class="muted note">{t('github.diff.binary')}</p>
    {:else if diff && diff.lines.length === 0}
      <p class="muted note">{t('github.diff.empty')}</p>
    {:else if diff}
      {#each diff.lines as l, i (i)}
        <div class="line" class:add={l.kind === '+'} class:del={l.kind === '-'} class:hunk={l.kind === '@'}>
          <span class="no">{l.kind === '@' ? '' : (l.old ?? '')}</span>
          <span class="no">{l.kind === '@' ? '' : (l.new ?? '')}</span>
          <span class="text">{l.kind === '@' ? l.text : `${l.kind}${l.text}`}</span>
        </div>
      {/each}
      {#if diff.truncated}<p class="muted note">{t('github.diff.truncated')}</p>{/if}
    {/if}
  </div>
</div>

<style>
  .diff {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .name {
    text-transform: none;
    letter-spacing: normal;
    font-size: 12px;
    color: var(--text);
  }

  .body {
    flex: 1;
    overflow: auto;
    font-size: 12px;
    line-height: 20px;
  }

  .line {
    display: flex;
    min-width: max-content;
  }

  .no {
    width: 48px;
    flex: none;
    padding-right: 8px;
    text-align: right;
    color: var(--muted);
    user-select: none;
  }

  .text {
    padding: 0 12px 0 4px;
    white-space: pre;
  }

  .add {
    background: color-mix(in srgb, var(--new) 14%, transparent);
  }

  .add .text {
    color: var(--new);
  }

  .del {
    background: color-mix(in srgb, var(--removed) 14%, transparent);
  }

  .del .text {
    color: var(--removed);
  }

  .hunk {
    color: var(--muted);
    background: var(--panel);
  }

  .note {
    margin: 0;
    padding: 12px 14px;
    font-family: inherit;
  }
</style>
