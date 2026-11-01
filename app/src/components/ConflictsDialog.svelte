<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import { t } from '../lib/i18n';
  import { openInEditor } from '../lib/local';
  import { prefs } from '../lib/prefs.svelte';
  import { repo, type ConflictFile } from '../lib/repo.svelte';
  import Modal from './Modal.svelte';

  // Like GitHub Desktop: a pull that stops at conflicting lines lists the
  // files; each one takes my version, theirs, or is edited in the editor
  // (the list follows the disk), then Continue commits the result or Abort
  // puts everything back as it was before the pull.
  let { onClose }: { onClose: () => void } = $props();
  let confirmAbort = $state(false);

  let c = $derived(repo.conflicts);
  let left = $derived(c?.files.filter((f) => f.markers > 0).length ?? 0);
  let busy = $derived(!!repo.busy);

  const full = (rel: string) => `${repo.dir.replace(/[\\/]+$/, '')}/${rel}`;

  function status(f: ConflictFile): string {
    if (f.markers > 0) {
      return t('conflicts.left', { count: f.markers });
    }
    if (f.mine_deleted || f.theirs_deleted) {
      return t(f.mine_deleted ? 'conflicts.deleted_by_me' : 'conflicts.deleted_by_them');
    }
    return t('conflicts.resolved');
  }
</script>

{#if c}
  <Modal title={t('conflicts.title')} onCancel={onClose} wide>
    <p>
      {t('conflicts.body', { branch: c.branch ?? 'HEAD', upstream: c.upstream ?? t('conflicts.the_remote') })}
    </p>
    {#if c.op === 'rebase' && c.commit}
      <p class="muted step">{t('conflicts.rebase_step', { commit: c.commit, step: c.step, steps: c.steps })}</p>
    {/if}
    <div class="files">
      {#each c.files as f (f.path)}
        <div class="file" class:done={f.markers === 0}>
          <span class="mark">{#if f.markers === 0}<Check size={14} />{/if}</span>
          <span class="name mono" title={f.path}>{f.path}</span>
          <span class="state" class:status-modified={f.markers > 0}>{status(f)}</span>
          <span class="buttons">
            <button class="control small" disabled={busy || f.mine_deleted} onclick={() => void openInEditor(full(f.path), prefs.value.editorPath)}>
              {t('conflicts.open')}
            </button>
            <button class="control small" disabled={busy} title={t('conflicts.mine_hint')} onclick={() => repo.resolve(f.path, 'mine')}>
              {t('conflicts.mine')}
            </button>
            <button class="control small" disabled={busy} title={t('conflicts.theirs_hint', { upstream: c.upstream ?? '' })} onclick={() => repo.resolve(f.path, 'theirs')}>
              {t('conflicts.theirs')}
            </button>
          </span>
        </div>
      {:else}
        <p class="muted">{t('conflicts.none_left')}</p>
      {/each}
    </div>
    <p class="muted hint">{t('conflicts.hint')}</p>
    {#if confirmAbort}
      <p class="status-removed">{t('conflicts.abort_confirm')}</p>
    {/if}
    {#snippet actions()}
      {#if confirmAbort}
        <button class="control" onclick={() => (confirmAbort = false)}>{t('common.cancel')}</button>
        <button class="control danger" disabled={busy} onclick={() => ((confirmAbort = false), repo.abortConflicts())}>
          {t(c.op === 'rebase' ? 'conflicts.abort_rebase' : 'conflicts.abort_merge')}
        </button>
      {:else}
        <button class="control danger-text" disabled={busy} onclick={() => (confirmAbort = true)}>
          {t(c.op === 'rebase' ? 'conflicts.abort_rebase' : 'conflicts.abort_merge')}
        </button>
        <span class="grow"></span>
        <button class="control" onclick={onClose}>{t('conflicts.later')}</button>
        <button class="control primary" disabled={busy || left > 0} title={left ? t('conflicts.files_left', { count: left }) : ''} onclick={() => repo.continueConflicts()}>
          {t(c.op === 'rebase' ? 'conflicts.continue_rebase' : 'conflicts.continue_merge')}
        </button>
      {/if}
    {/snippet}
  </Modal>
{/if}

<style>
  .step {
    margin-top: -4px;
  }

  .files {
    max-height: 300px;
    overflow-y: auto;
    margin: 10px 0;
    border: 1px solid var(--line);
    border-radius: 4px;
  }

  .file {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 36px;
    padding: 4px 10px;
    border-bottom: 1px solid var(--line-row);
    font-size: 12px;
  }

  .file:last-child {
    border-bottom: 0;
  }

  .mark {
    width: 14px;
    flex: none;
    display: flex;
    color: var(--new);
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
  }

  .file.done .name {
    color: var(--muted);
  }

  .state {
    flex: none;
    color: var(--muted);
    font-size: 11px;
  }

  .buttons {
    flex: none;
    display: flex;
    gap: 4px;
  }

  .hint {
    margin: 0;
    font-size: 12px;
  }

  .grow {
    flex: 1;
  }

  .danger-text {
    color: color-mix(in srgb, var(--removed) 85%, var(--text));
  }
</style>
