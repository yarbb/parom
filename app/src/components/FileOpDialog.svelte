<script lang="ts" module>
  // Name prompts (rename, new folder) and delete confirmation for both panes.
  export type FileOp =
    | { kind: 'rename'; name: string; onSubmit: (name: string) => void }
    | { kind: 'mkdir'; onSubmit: (name: string) => void }
    | { kind: 'mkfile'; onSubmit: (name: string) => void }
    | { kind: 'delete'; names: string[]; remote: boolean; onSubmit: () => void };
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '../lib/i18n';
  import Modal from './Modal.svelte';

  let { op, onClose }: { op: FileOp; onClose: () => void } = $props();

  let value = $state('');
  let input: HTMLInputElement | undefined = $state();

  $effect(() => {
    value = op.kind === 'rename' ? op.name : '';
    if (op.kind === 'rename') {
      // Select the name without its extension, like file managers do.
      const dot = op.name.lastIndexOf('.');
      const end = dot > 0 ? dot : op.name.length;
      void tick().then(() => input?.setSelectionRange(0, end));
    }
  });

  const invalid = $derived(value.trim() === '' || /[\\/]/.test(value) || value === '.' || value === '..');

  function submit(e: SubmitEvent) {
    e.preventDefault();
    // Keep the operation: closing clears the parent's state, and with it `op`.
    const current = op;
    const name = value.trim();
    if (current.kind === 'delete') {
      onClose();
      current.onSubmit();
    } else if (!invalid) {
      onClose();
      current.onSubmit(name);
    }
  }

  const title = $derived(
    op.kind === 'rename' ? t('fileop.rename.title') : op.kind === 'mkdir' ? t('fileop.mkdir.title') : op.kind === 'mkfile' ? t('fileop.mkfile.title') : t('fileop.delete.title'),
  );
</script>

<Modal {title} onCancel={onClose}>
  <form id="fileop-form" onsubmit={submit}>
    {#if op.kind === 'delete'}
      <p>{t(op.remote ? 'fileop.delete.remote' : 'fileop.delete.local', { count: op.names.length })}</p>
      <ul class="mono names">
        {#each op.names.slice(0, 8) as n (n)}<li>{n}</li>{/each}
        {#if op.names.length > 8}<li class="muted">{t('fileop.delete.more', { count: op.names.length - 8 })}</li>{/if}
      </ul>
    {:else}
      <input class="field mono wide" aria-label={title} bind:this={input} bind:value />
    {/if}
  </form>
  {#snippet actions()}
    <button class="control" onclick={onClose}>{t('common.cancel')}</button>
    <button class="control primary" type="submit" form="fileop-form" disabled={op.kind !== 'delete' && invalid}>
      {op.kind === 'delete' ? t('common.remove') : t('common.ok')}
    </button>
  {/snippet}
</Modal>

<style>
  p {
    margin: 0 0 8px;
  }

  .wide {
    width: 100%;
  }

  .names {
    margin: 0;
    padding-left: 18px;
    max-height: 160px;
    overflow: auto;
    word-break: break-all;
  }
</style>
