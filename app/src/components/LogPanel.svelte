<script lang="ts">
  import { tick } from 'svelte';
  import { connection } from '../lib/connection.svelte';
  import { t } from '../lib/i18n';
  import { prefs } from '../lib/prefs.svelte';
  import Splitter from './Splitter.svelte';

  // The engine's message log (status, commands, server replies, errors),
  // newest at the bottom; opened from the status bar.
  let { onClose }: { onClose: () => void } = $props();

  let box: HTMLDivElement;
  let follow = true;
  // Repeats in a row (keep-alive and the like) fold into one line with a count.
  let lines = $derived.by(() => {
    void connection.logVersion;
    const out: { time: number; level: string; text: string; count: number }[] = [];
    for (const l of connection.log) {
      const prev = out[out.length - 1];
      if (prev && prev.level === l.level && prev.text === l.text) {
        prev.count++;
        prev.time = l.time;
      } else {
        out.push({ ...l, count: 1 });
      }
    }
    return out;
  });

  const resize = (delta: number) => {
    prefs.value.logHeight = Math.max(80, Math.min(window.innerHeight - 220, prefs.value.logHeight - delta));
  };

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
    const text = lines.map((l) => `${clock(l.time)} ${l.level.padEnd(7)} ${l.text}${l.count > 1 ? ` (x${l.count})` : ''}`).join('\n');
    void navigator.clipboard.writeText(text).catch(() => {});
  }
</script>

<Splitter
  axis="y"
  label={t('ui.resize')}
  onMove={resize}
  onEnd={() => prefs.persist()}
  onReset={() => prefs.set('logHeight', 190)}
/>
<section class="log" aria-label={t('log.title')} style:height="{prefs.value.logHeight}px">
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
        <span class="text">{l.text}{#if l.count > 1}<span class="count"> (x{l.count})</span>{/if}</span>
      </div>
    {:else}
      <p class="muted empty">{t('log.empty')}</p>
    {/each}
  </div>
</section>

<style>
  .log {
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
    padding: 2px 14px;
    border-bottom: 1px solid var(--line-row);
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

  .count {
    color: var(--muted);
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
