<script lang="ts">
  import { t } from '../lib/i18n';
  import Modal from './Modal.svelte';

  // A failure that needs reading: stays until closed, text can be selected
  // and copied (the toolbar only keeps a short line that reopens it).
  let { title, message, onClose }: { title: string; message: string; onClose: () => void } = $props();
  let copied = $state(false);

  async function copy() {
    await navigator.clipboard?.writeText(message).catch(() => {});
    copied = true;
  }
</script>

<Modal {title} onCancel={onClose} wide>
  <pre class="message">{message}</pre>
  {#snippet actions()}
    <button class="control" onclick={copy}>{copied ? t('error.copied') : t('common.copy')}</button>
    <button class="control primary" onclick={onClose}>{t('common.close')}</button>
  {/snippet}
</Modal>

<style>
  .message {
    max-height: 320px;
    overflow: auto;
    margin: 0;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
    user-select: text;
  }
</style>
