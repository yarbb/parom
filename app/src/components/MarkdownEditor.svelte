<script lang="ts">
  import { tick } from 'svelte';
  import Bold from '@lucide/svelte/icons/bold';
  import Code from '@lucide/svelte/icons/code';
  import Heading from '@lucide/svelte/icons/heading';
  import Italic from '@lucide/svelte/icons/italic';
  import Link from '@lucide/svelte/icons/link';
  import List from '@lucide/svelte/icons/list';
  import ListChecks from '@lucide/svelte/icons/list-checks';
  import ListOrdered from '@lucide/svelte/icons/list-ordered';
  import Quote from '@lucide/svelte/icons/quote';
  import Strikethrough from '@lucide/svelte/icons/strikethrough';
  import { t } from '../lib/i18n';

  // A Markdown text area with a formatting bar, like GitHub's comment box:
  // the buttons (and Ctrl+B / Ctrl+I / Ctrl+K / Ctrl+E) wrap the selection or
  // prefix the selected lines.
  interface Props {
    value: string;
    placeholder?: string;
    rows?: number;
    label?: string;
  }

  let { value = $bindable(), placeholder = '', rows = 4, label = '' }: Props = $props();
  let area: HTMLTextAreaElement;

  /** Replaces the selection, keeping the inner text selected. */
  async function replace(before: string, inner: string, after: string, start: number, end: number) {
    value = value.slice(0, start) + before + inner + after + value.slice(end);
    await tick();
    area.focus();
    area.setSelectionRange(start + before.length, start + before.length + inner.length);
  }

  function wrap(mark: string, fallback: string, closing = mark) {
    const { selectionStart: s, selectionEnd: e } = area;
    const text = value.slice(s, e) || fallback;
    void replace(mark, text, closing, s, e);
  }

  /** Prefixes every selected line (lists, quotes, headings). */
  function prefix(make: (i: number) => string) {
    const s = value.lastIndexOf('\n', area.selectionStart - 1) + 1;
    let e = value.indexOf('\n', area.selectionEnd);
    if (e < 0) {
      e = value.length;
    }
    const lines = value.slice(s, e).split('\n');
    const text = lines.map((l, i) => make(i) + l).join('\n');
    void replace('', text, '', s, e);
  }

  function link() {
    const { selectionStart: s, selectionEnd: e } = area;
    const text = value.slice(s, e) || t('editor.link_text');
    void replace('[', text, '](https://)', s, e);
  }

  function code() {
    const selected = value.slice(area.selectionStart, area.selectionEnd);
    if (selected.includes('\n')) {
      wrap('```\n', selected, '\n```');
    } else {
      wrap('`', 'code');
    }
  }

  const tools = [
    { icon: Heading, title: 'editor.heading', run: () => prefix(() => '### ') },
    { icon: Bold, title: 'editor.bold', key: 'b', run: () => wrap('**', t('editor.bold')) },
    { icon: Italic, title: 'editor.italic', key: 'i', run: () => wrap('_', t('editor.italic')) },
    { icon: Strikethrough, title: 'editor.strike', run: () => wrap('~~', t('editor.strike')) },
    { icon: Code, title: 'editor.code', key: 'e', run: code },
    { icon: Link, title: 'editor.link', key: 'k', run: link },
    { icon: Quote, title: 'editor.quote', run: () => prefix(() => '> ') },
    { icon: List, title: 'editor.list', run: () => prefix(() => '- ') },
    { icon: ListOrdered, title: 'editor.numbered', run: () => prefix((i) => `${i + 1}. `) },
    { icon: ListChecks, title: 'editor.tasks', run: () => prefix(() => '- [ ] ') },
  ];

  function onkeydown(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) {
      return;
    }
    const tool = tools.find((x) => x.key === e.key.toLowerCase());
    if (tool) {
      e.preventDefault();
      tool.run();
    }
  }
</script>

<div class="editor">
  <div class="toolbar" role="toolbar" aria-label={t('editor.toolbar')}>
    {#each tools as tool (tool.title)}
      {@const Icon = tool.icon}
      <button
        type="button"
        class="tool"
        title={t(tool.title) + (tool.key ? ` (Ctrl+${tool.key.toUpperCase()})` : '')}
        aria-label={t(tool.title)}
        onmousedown={(e) => e.preventDefault()}
        onclick={tool.run}
      >
        <Icon size={14} strokeWidth={1.8} />
      </button>
    {/each}
  </div>
  <textarea class="field" bind:this={area} bind:value {placeholder} {rows} aria-label={label || placeholder} {onkeydown}></textarea>
</div>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--line-control);
    border-radius: 4px;
    background: var(--bg);
    transition: border-color var(--motion-fast);
  }

  .editor:focus-within {
    border-color: var(--muted);
  }

  .toolbar {
    display: flex;
    gap: 2px;
    padding: 3px 4px;
    border-bottom: 1px solid var(--line-row);
  }

  .tool {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 24px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--muted);
    cursor: pointer;
    transition:
      background-color var(--motion-fast),
      color var(--motion-fast);
  }

  .tool:hover {
    background: var(--selected-bg);
    color: var(--text-strong);
  }

  textarea {
    width: 100%;
    padding: 7px 9px;
    border: 0;
    background: none;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    resize: vertical;
    outline: none;
  }
</style>
