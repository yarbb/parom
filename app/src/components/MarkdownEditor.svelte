<script lang="ts">
  import Avatar from './Avatar.svelte';
  import type { Mention } from '../lib/issues.svelte';
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
    /** People for @-mentions (asked for the first time "@" is typed). */
    people?: () => Promise<Mention[]>;
  }

  let { value = $bindable(), placeholder = '', rows = 4, label = '', people }: Props = $props();

  // @-mentions: "@" and a few letters show matching people; ↑ / ↓ pick,
  // Enter or Tab puts "@login " in, Esc closes the list.
  let mention = $state<{ start: number; query: string } | null>(null);
  let known = $state<Mention[] | null>(null);
  let mentionIndex = $state(0);
  let mentionUp = $state(false);
  const mentionMatches = $derived.by(() => {
    if (!mention || !known) {
      return [];
    }
    const q = mention.query.toLowerCase();
    const starts = known.filter((p) => p.login.toLowerCase().startsWith(q));
    const contains = known.filter((p) => !p.login.toLowerCase().startsWith(q) && p.login.toLowerCase().includes(q));
    return [...starts, ...contains].slice(0, 6);
  });

  function findMention() {
    if (!people || !area) {
      mention = null;
      return;
    }
    const caret = area.selectionStart;
    if (caret !== area.selectionEnd) {
      mention = null;
      return;
    }
    const m = /(^|[\s(])@([A-Za-z0-9-]{0,39})$/.exec(value.slice(0, caret));
    if (!m) {
      mention = null;
      return;
    }
    if (!mention) {
      mentionIndex = 0;
      const box = area.getBoundingClientRect();
      mentionUp = window.innerHeight - box.bottom < 220;
    }
    mention = { start: caret - m[2].length - 1, query: m[2] };
    if (known === null) {
      known = [];
      void people().then((list) => (known = list));
    }
  }

  async function takeMention(login: string) {
    if (!mention) {
      return;
    }
    const caret = area.selectionStart;
    const start = mention.start;
    mention = null;
    value = `${value.slice(0, start)}@${login} ${value.slice(caret)}`;
    await tick();
    area.focus();
    const at = start + login.length + 2;
    area.setSelectionRange(at, at);
  }
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
    if (mention && mentionMatches.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        mentionIndex = (mentionIndex + step + mentionMatches.length) % mentionMatches.length;
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        void takeMention(mentionMatches[mentionIndex].login);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        mention = null;
        return;
      }
    }
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
  <textarea
    class="field"
    bind:this={area}
    bind:value
    {placeholder}
    {rows}
    aria-label={label || placeholder}
    {onkeydown}
    oninput={findMention}
    onclick={findMention}
    onkeyup={(e) => (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') && findMention()}
    onblur={() => (mention = null)}
  ></textarea>
  {#if mention && mentionMatches.length}
    <div class="mentions menu-unroll" class:up={mentionUp} role="listbox" aria-label="@">
      {#each mentionMatches as p, i (p.login)}
        <button
          type="button"
          role="option"
          aria-selected={i === mentionIndex}
          class:on={i === mentionIndex}
          tabindex="-1"
          onmousedown={(e) => e.preventDefault()}
          onclick={() => void takeMention(p.login)}
        >
          <Avatar name={p.login} src={p.avatar_url ?? null} size={18} /><span class="mono">@{p.login}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .editor {
    position: relative;
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

  .mentions {
    position: absolute;
    top: calc(100% + 4px);
    left: 8px;
    z-index: 30;
    min-width: 220px;
    padding: 4px;
    border: 1px solid var(--line-control);
    border-radius: 6px;
    background: var(--panel);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.3);
  }

  .mentions.up {
    top: auto;
    bottom: calc(100% + 4px);
  }

  .mentions button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 28px;
    padding: 0 8px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }

  .mentions button.on,
  .mentions button:hover {
    background: var(--selected-bg);
    color: var(--text-strong);
  }
</style>
