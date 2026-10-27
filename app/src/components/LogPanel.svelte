<script lang="ts">
  import { tick } from 'svelte';
  import { connection } from '../lib/connection.svelte';
  import { t } from '../lib/i18n';

  // The engine's message log (status, commands, server replies, errors),
  // newest at the bottom; opened from the status bar.
  let { onClose }: { onClose: () => void } = $props();

  let box: HTMLDivElement;
  let follow = true;
  let lines = $derived.by(() => {
    void connection.logVersion;
    return connection.log.slice();
  });

  const pad = (n: number) => String(n).padStart(2, '0');
  const clock = (ms: number) => {
    const d = new Date(ms);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  // Keep the newest line in view unless the user scrolled up to read.
  $effect(() => {
    void lines;
    if (follow) {
      void tick().then(() => box && (box.scrollTop = box.scrollHeight));
    }
  });

  function onscroll() {
    follow = box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
  }

  function copy() {
    const text = lines.map((l) => `${clock(l.time)} ${l.level.padEnd(7)} ${l.text}`).join('\n');
    void navigator.clipboard.writeText(text).catch(() => {});
  }
</script>

<section class="log" aria-label={t('log.title')}>
  <div class="section-label head">
    <span>{t('log.title')}</span>
    <span class="buttons">
      <button class="control small" onclick={copy}>{t('common.copy')}</button>
      <button class="control small" onclick={() => connection.clearLog()}>{t('log.clear')}</button>
      <button class="control small" onclick={onClose}>{t('common.close')}</button>
    </span>
  </div>
  <div class="lines mono" bind:this={box} {onscroll}>
    {#each lines as l, i (i)}
      <div class="line {l.level}">
        <span class="time">{clock(l.time)}</span>
        <span class="level">{l.level}</span>
        <span class="text">{l.text}</span>
      </div>
    {:else}
      <p class="muted empty">{t('log.empty')}</p>
    {/each}
  </div>
</section>

<style>
  .log {
    height: 190px;
    flex: none;
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--line);
  }

  .lines {
    flex: 1;
    overflow: auto;
    padding: 4px 0;
    font-size: 11.5px;
    line-height: 18px;
  }

  .line {
    display: flex;
    gap: 10px;
    padding: 0 14px;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .time,
  .level {
    flex: none;
    color: var(--muted);
  }

  .level {
    width: 52px;
  }

  .text {
    flex: 1;
    min-width: 0;
  }

  .command .text {
    color: var(--muted);
  }

  .error .text,
  .error .level {
    color: var(--removed);
  }

  .status .text {
    color: var(--text-strong);
  }

  .empty {
    margin: 0;
    padding: 8px 14px;
  }
</style>
