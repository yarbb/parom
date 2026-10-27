<script lang="ts">
  import { t } from '../lib/i18n';
  import { labelColors, setLabel, type LabelColor } from '../lib/labels';
  import Modal from './Modal.svelte';

  // Right-click → Color label: one colour (or none) for the chosen folders.
  let { keys, names, onClose }: { keys: string[]; names: string[]; onClose: () => void } = $props();

  async function pick(color: LabelColor | null) {
    await setLabel(keys, color);
    onClose();
  }
</script>

<Modal title={t('labels.title', { count: names.length })} onCancel={onClose}>
  <p class="mono muted names">{names.slice(0, 4).join(', ')}{names.length > 4 ? ` +${names.length - 4}` : ''}</p>
  <div class="swatches">
    {#each Object.entries(labelColors) as [name, color] (name)}
      <button class="swatch" style:--c={color} title={t(`labels.${name}`)} aria-label={t(`labels.${name}`)} onclick={() => pick(name as LabelColor)}></button>
    {/each}
    <button class="swatch none" title={t('labels.none')} aria-label={t('labels.none')} onclick={() => pick(null)}>✕</button>
  </div>
  <p class="muted small">{t('labels.hint')}</p>
  {#snippet actions()}
    <button class="control" onclick={onClose}>{t('common.cancel')}</button>
  {/snippet}
</Modal>

<style>
  p {
    margin: 0 0 12px;
  }

  .names {
    word-break: break-all;
  }

  .small {
    font-size: 11.5px;
  }

  .swatches {
    display: flex;
    gap: 10px;
    margin-bottom: 12px;
  }

  .swatch {
    width: 28px;
    height: 28px;
    border: 2px solid transparent;
    border-radius: 50%;
    background: var(--c);
    cursor: pointer;
    transition: transform var(--motion-fast);
  }

  .swatch:hover,
  .swatch:focus-visible {
    transform: scale(1.12);
    border-color: var(--text-strong);
    outline: none;
  }

  .swatch.none {
    background: none;
    border-color: var(--line-control);
    color: var(--muted);
    font-size: 12px;
  }
</style>
