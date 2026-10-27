<script lang="ts">
  import { openGitHub } from '../lib/github.svelte';
  import { sanitizeHtml } from '../lib/markdown';

  // GitHub-rendered Markdown (body_html) after the app's own allowlist; plain
  // text when there is no rendered version. Links open in the browser.
  let { html, text }: { html?: string | null; text: string } = $props();

  let clean = $derived(html ? sanitizeHtml(html) : '');

  function onclick(e: MouseEvent) {
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
