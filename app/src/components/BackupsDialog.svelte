<script lang="ts">
  import { connection } from '../lib/connection.svelte';
  import { t } from '../lib/i18n';
  import BackupsList from './BackupsList.svelte';
  import Modal from './Modal.svelte';

  // Backups of the connected site, opened from the sync bar.
  let { onClose }: { onClose: () => void } = $props();
</script>

<Modal title={t('backups.title', { server: connection.site?.name ?? '' })} onCancel={onClose}>
  {#if connection.site}
    <div class="scroll"><BackupsList site={connection.site} onRestore={onClose} /></div>
  {/if}
  {#snippet actions()}
    <button class="control primary" onclick={onClose}>{t('common.ok')}</button>
  {/snippet}
</Modal>

<style>
  .scroll {
    max-height: 340px;
    overflow: auto;
  }
</style>
