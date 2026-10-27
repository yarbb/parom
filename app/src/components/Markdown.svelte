<script lang="ts">
  import { openGitHub } from '../lib/github.svelte';
  import { t } from '../lib/i18n';
  import { sanitizeHtml } from '../lib/markdown';

  // GitHub-rendered Markdown (body_html) after the app's own allowlist; plain
  // text when there is no rendered version. Links open in the browser.
  let { html, text }: { html?: string | null; text: string } = $props();

  let clean = $derived(html ? sanitizeHtml(html) : '');
  /** Image opened large inside the app (click on a picture). */
  let viewing = $state<{ src: string; alt: string } | null>(null);

  function onclick(e: MouseEvent) {
    const img = (e.target as Element).closest('img');
    if (img) {
      e.preventDefault();
      viewing = { src: img.currentSrc || img.src, alt: img.alt };
      return;
    }
    const link = (e.target as Element).closest('a');
    if (link) {
      e.preventDefault();
      const href = link.getAttribute('href') ?? '';
      if (href.startsWith('https://')) {
        void openGitHub(href);
      }
    }
  }
</script>

{#if clean}
  <div class="markdown" role="presentation" {onclick}>{@html clean}</div>
{:else}
  <div class="plain">{text}</div>
{/if}

{#if viewing}
  {@const v = viewing}
  <div
    class="viewer"
    role="dialog"
    aria-modal="true"
    aria-label={v.alt || 'Image'}
    tabindex="-1"
    onclick={() => (viewing = null)}
    onkeydown={(e) => e.key === 'Escape' && (viewing = null)}
  >
    <img src={v.src} alt={v.alt} />
    <div class="viewer-bar">
      <button class="control small" onclick={(e) => (e.stopPropagation(), openGitHub(v.src))}>{t('github.open_in_browser')}</button>
      <button class="control small" onclick={() => (viewing = null)}>{t('common.close')}</button>
    </div>
  </div>
{/if}

<svelte:window onkeydown={(e) => viewing && e.key === 'Escape' && (viewing = null)} />

<style>
  .plain {
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.5;
  }

  .markdown {
    line-height: 1.55;
    word-break: break-word;
  }

  .markdown :global(> :first-child) {
    margin-top: 0;
  }

  .markdown :global(> :last-child) {
    margin-bottom: 0;
  }

  .markdown :global(p),
  .markdown :global(ul),
  .markdown :global(ol),
  .markdown :global(pre),
  .markdown :global(blockquote),
  .markdown :global(table),
  .markdown :global(details) {
    margin: 0 0 10px;
  }

  .markdown :global(h1),
  .markdown :global(h2),
  .markdown :global(h3),
  .markdown :global(h4) {
    margin: 14px 0 8px;
    color: var(--text-strong);
    font-size: 13.5px;
    font-weight: 600;
  }

  .markdown :global(h1) {
    font-size: 15px;
  }

  .markdown :global(ul),
  .markdown :global(ol) {
    padding-left: 22px;
  }

  .markdown :global(a) {
    color: var(--text-strong);
    text-decoration: underline;
    cursor: pointer;
  }

  .markdown :global(code) {
    padding: 1px 4px;
    border-radius: 3px;
    background: var(--panel);
    font-family: Consolas, 'Cascadia Code', ui-monospace, monospace;
    font-size: 11.5px;
  }

  .markdown :global(pre) {
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: 4px;
    background: var(--panel);
    overflow: auto;
  }

  .markdown :global(pre code) {
    padding: 0;
    background: none;
  }

  .markdown :global(blockquote) {
    padding-left: 10px;
    border-left: 2px solid var(--line-control);
    color: var(--muted);
  }

  .markdown :global(img) {
    max-width: 100%;
    height: auto;
    cursor: zoom-in;
  }

  .viewer {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 24px;
    background: rgb(0 0 0 / 0.85);
    cursor: zoom-out;
    outline: none;
  }

  .viewer img {
    max-width: 100%;
    max-height: calc(100% - 44px);
    object-fit: contain;
    box-shadow: 0 8px 40px rgb(0 0 0 / 0.6);
  }

  .viewer-bar {
    display: flex;
    gap: 8px;
  }

  .markdown :global(table) {
    border-collapse: collapse;
  }

  .markdown :global(th),
  .markdown :global(td) {
    padding: 4px 8px;
    border: 1px solid var(--line);
  }

  .markdown :global(hr) {
    border: 0;
    border-top: 1px solid var(--line);
  }
</style>
