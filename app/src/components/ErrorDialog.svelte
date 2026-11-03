<script lang="ts">
  import { errors, type AppError } from '../lib/errors.svelte';
  import { t } from '../lib/i18n';
  import Modal from './Modal.svelte';

  // The error window (one for the whole app): the whole text, selectable
  // and copyable, stays until closed; the recent errors below switch to
  // another one.
  let copied = $state(false);
  let current = $derived(errors.shown);

  const time = (e: AppError) => new Date(e.time).toLocaleTimeString();
  const firstLine = (text: string) => text.split('\n')[0];

  async function copy() {
    if (current) {
      await navigator.clipboard?.writeText(current.text).catch(() => {});
      copied = true;
    }
  }

  $effect(() => {
    void current;
    copied = false;
  });
</script>

{#if current}
  <Modal title={t('error.title')} onCancel={() => errors.close()} wide>
    <p class="meta muted">{t(`error.source.${current.source}`)} · <span class="mono">{time(current)}</span></p>
    <pre class="message">{current.text}</pre>
    {#if errors.recent.length > 1}
      <p class="section-label recent-label">{t('error.recent')}</p>
      <ul class="recent">
        {#each errors.recent as e (e.id)}
          <li>
            <button class:current={e.id === current.id} title={e.text} onclick={() => errors.show(e)}>
              <span class="mono muted">{time(e)}</span>
              <span class="muted source">{t(`error.source.${e.source}`)}</span>
              <span class="line">{firstLine(e.text)}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    {#snippet actions()}
      <button class="control" onclick={() => errors.clear()}>{t('error.clear')}</button>
      <button class="control" onclick={copy}>{copied ? t('error.copied') : t('common.copy')}</button>
      <button class="control primary" onclick={() => errors.close()}>{t('common.close')}</button>
    {/snippet}
  </Modal>
{/if}

<style>
  .meta {
    margin: 0 0 8px;
    font-size: 11.5px;
  }

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

  .recent-label {
    margin: 14px 0 6px;
  }

  .recent {
    max-height: 160px;
    overflow-y: auto;
    margin: 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--line);
    border-radius: 4px;
  }

  .recent button {
    display: flex;
    gap: 10px;
    width: 100%;
    padding: 5px 10px;
    border: none;
    border-bottom: 1px solid var(--line-row);
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }

  .recent li:last-child button {
    border-bottom: none;
  }

  .recent button:hover,
  .recent button.current {
    background: var(--selected-bg);
  }

  .source {
    flex: none;
  }

  .line {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
