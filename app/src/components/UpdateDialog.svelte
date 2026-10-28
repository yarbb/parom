<script lang="ts">
  import { t } from '../lib/i18n';
  import { ui } from '../lib/ui.svelte';
  import { updates } from '../lib/updates.svelte';
  import Modal from './Modal.svelte';

  // "Check for updates" result, and the update itself: what is new, then
  // download, install and restart.
  const percent = $derived(
    updates.progress?.total ? Math.min(100, Math.round((updates.progress.done / updates.progress.total) * 100)) : null,
  );
  const mb = (n: number) => (n / 1024 / 1024).toFixed(1);

  function close() {
    if (!updates.progress) {
      updates.dialog = false;
    }
  }
</script>

<Modal
  title={updates.available ? t('update.available', { name: ui.appName, version: updates.available.version }) : t('update.title')}
  onCancel={close}
>
  {#if updates.checking}
    <p class="muted">{t('update.checking')}</p>
  {:else if updates.available}
    {#if updates.available.notes.trim()}
      <div class="label">{t('update.whats_new')}</div>
      <pre class="notes">{updates.available.notes.trim()}</pre>
    {/if}
    {#if updates.progress}
      <div class="bar" role="progressbar" aria-valuenow={percent ?? undefined} aria-valuemin={0} aria-valuemax={100}>
        <i class:busy={percent === null} style:width={percent === null ? undefined : `${percent}%`}></i>
      </div>
      <p class="muted small">
        {percent === null ? t('update.downloading', { done: mb(updates.progress.done) }) : t('update.downloading_of', { done: mb(updates.progress.done), total: mb(updates.progress.total ?? 0) })}
      </p>
    {:else}
      <p class="muted small">{t('update.restart_note')}</p>
    {/if}
  {:else if !updates.error}
    <p>{t('update.up_to_date', { name: ui.appName })}</p>
  {/if}
  {#if updates.error}<p class="status-removed small">{updates.error}</p>{/if}
  {#snippet actions()}
    {#if updates.available}
      <button class="control" disabled={!!updates.progress} onclick={close}>{t('update.later')}</button>
      <button class="control primary" disabled={!!updates.progress} onclick={() => void updates.install()}>{t('update.install')}</button>
    {:else}
      <button class="control primary" disabled={updates.checking} onclick={close}>{t('common.ok')}</button>
    {/if}
  {/snippet}
</Modal>

<style>
  .label {
    margin-bottom: 6px;
    color: var(--muted);
    font-size: 10.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .notes {
    max-height: 220px;
    overflow: auto;
    margin: 0 0 12px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 4px;
    background: var(--bg);
    font-family: var(--font-ui);
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
  }

  .bar {
    height: 3px;
    margin: 4px 0 8px;
    overflow: hidden;
    background: var(--line);
  }

  .bar i {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width var(--motion);
  }

  .bar i.busy {
    width: 30%;
    animation: slide 1.2s ease-in-out infinite;
  }

  .small {
    font-size: 11.5px;
  }

  @keyframes slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(340%);
    }
  }
</style>
