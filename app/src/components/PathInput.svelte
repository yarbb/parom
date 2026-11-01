<script lang="ts">
  import Folder from '@lucide/svelte/icons/folder';

  // A path field that suggests folders while you type, like Explorer's
  // address bar: the rest of the first match shows in grey after the text
  // and the matches drop down below. Tab (or → at the end) takes the
  // suggestion, ↑ / ↓ pick another, Enter opens the folder, Esc closes the list.
  interface Props {
    value: string;
    label: string;
    disabled?: boolean;
    /** Folder names inside `dir` (which ends with a separator); null when unknown. */
    folders: (dir: string) => Promise<string[] | null>;
    /** Separators this side understands; the first one ends a taken suggestion when the text has none. */
    separators: string;
    caseSensitive: boolean;
    /** Milliseconds of quiet typing before asking for a folder's contents. */
    delay?: number;
    onSubmit: (path: string) => void;
  }

  let { value = $bindable(''), label, disabled = false, folders, separators, caseSensitive, delay = 150, onSubmit }: Props = $props();

  let names = $state<string[]>([]);
  let loadedDir = $state<string | null>(null);
  let open = $state(false);
  let focused = $state(false);
  let index = $state(-1);
  let overflow = $state(false);
  let input = $state<HTMLInputElement>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let request = 0;

  /** The text up to its last separator (the folder to look in) and the part being typed. */
  const split = $derived.by(() => {
    let cut = -1;
    for (const sep of separators) {
      cut = Math.max(cut, value.lastIndexOf(sep));
    }
    return { dir: value.slice(0, cut + 1), part: value.slice(cut + 1), ok: cut >= 0 };
  });
  const starts = (name: string, part: string) => (caseSensitive ? name.startsWith(part) : name.toLowerCase().startsWith(part.toLowerCase()));
  const matches = $derived(
    split.ok && loadedDir === split.dir ? names.filter((n) => starts(n, split.part) && n !== split.part).slice(0, 8) : [],
  );
  const pick = $derived(matches.length ? matches[Math.max(0, index)] : null);
  /** The grey rest of the suggestion after the typed text. */
  const rest = $derived(focused && open && pick && !overflow ? pick.slice(split.part.length) : '');

  function schedule() {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => void load(), delay);
  }

  async function load() {
    const dir = split.dir;
    if (!split.ok || dir === loadedDir) {
      return;
    }
    const n = ++request;
    const found = await folders(dir).catch(() => null);
    if (n === request) {
      names = (found ?? []).sort((a, b) => a.localeCompare(b));
      loadedDir = dir;
    }
  }

  function measure() {
    overflow = !!input && input.scrollWidth > input.clientWidth;
  }

  function onInput() {
    open = true;
    index = -1;
    measure();
    schedule();
  }

  /** Takes a suggestion and goes one level in, ready for the next one. */
  function accept(name: string) {
    const sep = [...separators].find((s) => split.dir.endsWith(s)) ?? separators[0];
    value = `${split.dir}${name}${sep}`;
    index = -1;
    open = true;
    queueMicrotask(() => {
      input?.setSelectionRange(value.length, value.length);
      measure();
    });
    schedule();
  }

  function onkeydown(e: KeyboardEvent) {
    const atEnd = input?.selectionStart === value.length && input?.selectionEnd === value.length;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && matches.length) {
      open = true;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      index = (index + step + matches.length) % matches.length;
    } else if ((e.key === 'Tab' && !e.shiftKey && open && pick) || (e.key === 'ArrowRight' && atEnd && rest)) {
      accept(pick!);
    } else if (e.key === 'Enter' && open && index >= 0 && pick) {
      accept(pick);
    } else if (e.key === 'Escape' && open && matches.length) {
      open = false;
      e.stopPropagation();
    } else {
      return;
    }
    e.preventDefault();
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    open = false;
    if (value.trim()) {
      onSubmit(value.trim());
    }
  }
</script>

<form class="pathbar" onsubmit={submit}>
  <div class="path-input">
    <input
      bind:this={input}
      class="field mono"
      aria-label={label}
      aria-autocomplete="both"
      aria-expanded={open && matches.length > 0}
      autocomplete="off"
      spellcheck="false"
      {disabled}
      bind:value
      oninput={onInput}
      {onkeydown}
      onfocus={() => ((focused = true), schedule())}
      onblur={() => ((focused = false), (open = false))}
    />
    {#if rest}
      <div class="ghost mono" aria-hidden="true"><span class="typed">{value}</span>{rest}</div>
    {/if}
    {#if focused && open && matches.length}
      <div class="drop menu-unroll" role="listbox" aria-label={label}>
        {#each matches as m, i (m)}
          <button
            type="button"
            role="option"
            aria-selected={i === index}
            class:on={i === Math.max(0, index)}
            tabindex="-1"
            onmousedown={(e) => e.preventDefault()}
            onclick={() => accept(m)}
          >
            <Folder size={13} strokeWidth={1.6} /><span class="mono">{m}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</form>

<style>
  .path-input {
    position: relative;
  }

  .ghost {
    position: absolute;
    inset: 0;
    padding: 0 10px;
    overflow: hidden;
    color: var(--muted);
    font-size: 12px;
    line-height: 28px;
    white-space: pre;
    pointer-events: none;
  }

  .ghost .typed {
    color: transparent;
  }

  .drop {
    position: absolute;
    top: 32px;
    left: 0;
    z-index: 30;
    min-width: 240px;
    max-width: 100%;
    padding: 4px;
    border: 1px solid var(--line-control);
    border-radius: 6px;
    background: var(--panel);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.3);
  }

  .drop button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 26px;
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

  .drop button :global(svg) {
    flex: none;
    color: var(--muted);
  }

  .drop button span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .drop button.on,
  .drop button:hover {
    background: var(--selected-bg);
    color: var(--text-strong);
  }
</style>
