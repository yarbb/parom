<script lang="ts" generics="T extends string | number">
  import { tick } from 'svelte';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Check from '@lucide/svelte/icons/check';

  // A drop-down in the app's style instead of the system <select>: arrows,
  // Home/End, Enter / Space, Escape and type-to-find work as usual.
  interface Props {
    value: T;
    options: readonly { value: T; label: string }[];
    disabled?: boolean;
    label?: string;
    onchange?: (value: T) => void;
  }

  let { value = $bindable(), options, disabled = false, label, onchange }: Props = $props();

  let open = $state(false);
  let active = $state(0);
  let button: HTMLButtonElement;
  let list: HTMLDivElement | undefined = $state();
  let pos = $state({ left: 0, top: 0, width: 0, up: false });
  let typed = '';
  let typedAt = 0;

  let current = $derived(options.find((o) => o.value === value));

  async function show() {
    if (disabled || !options.length) {
      return;
    }
    const r = button.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const height = Math.min(260, options.length * 28 + 8);
    pos = { left: r.left, top: r.bottom + 4, width: r.width, up: below < height + 12 && r.top > below };
    if (pos.up) {
      pos.top = r.top - 4 - height;
    }
    active = Math.max(0, options.findIndex((o) => o.value === value));
    open = true;
    await tick();
    list?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  function choose(i: number) {
    const o = options[i];
    open = false;
    button.focus();
    if (o && o.value !== value) {
      value = o.value;
      onchange?.(o.value);
    }
  }

  function move(i: number) {
    active = Math.max(0, Math.min(options.length - 1, i));
    list?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  function onkeydown(e: KeyboardEvent) {
    if (disabled) {
      return;
    }
    const keys: Record<string, () => void> = {
      ArrowDown: () => (open ? move(active + 1) : void show()),
      ArrowUp: () => (open ? move(active - 1) : void show()),
      Home: () => open && move(0),
      End: () => open && move(options.length - 1),
      Enter: () => (open ? choose(active) : void show()),
      ' ': () => (open ? choose(active) : void show()),
      Escape: () => (open = false),
      Tab: () => (open = false),
    };
    const action = keys[e.key];
    if (action) {
      if (e.key !== 'Tab' && (e.key !== 'Escape' || open)) {
        e.preventDefault();
        e.stopPropagation();
      }
      action();
      return;
    }
    // Type the first letters of an option to jump to it.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      typed = now - typedAt > 700 ? e.key.toLowerCase() : typed + e.key.toLowerCase();
      typedAt = now;
      const i = options.findIndex((o) => o.label.toLowerCase().startsWith(typed));
      if (i >= 0) {
        if (open) {
          move(i);
        } else {
          choose(i);
        }
      }
    }
  }

  function onWindowDown(e: MouseEvent) {
    if (open && !list?.contains(e.target as Node) && !button.contains(e.target as Node)) {
      open = false;
    }
  }
</script>

<svelte:window onmousedown={onWindowDown} onresize={() => (open = false)} onblur={() => (open = false)} />

<button
  bind:this={button}
  type="button"
  class="select field"
  class:open
  {disabled}
  aria-haspopup="listbox"
  aria-expanded={open}
  aria-label={label}
  onclick={() => (open ? (open = false) : void show())}
  {onkeydown}
>
  <span class="text">{current?.label ?? ''}</span>
  <span class="chevron" aria-hidden="true"><ChevronDown size={14} strokeWidth={1.8} /></span>
</button>

{#if open}
  <div
    class="options"
    class:up={pos.up}
    role="listbox"
    tabindex="-1"
    bind:this={list}
    style:left="{pos.left}px"
    style:top="{pos.top}px"
    style:min-width="{pos.width}px"
  >
    {#each options as o, i (o.value)}
      <div
        class="option"
        class:active={i === active}
        class:chosen={o.value === value}
        role="option"
        tabindex="-1"
        aria-selected={o.value === value}
        data-index={i}
        onmouseenter={() => (active = i)}
        onmousedown={(e) => e.preventDefault()}
        onclick={() => choose(i)}
        onkeydown={() => {}}
      >
        <span class="mark" aria-hidden="true">{#if o.value === value}<Check size={13} strokeWidth={2} />{/if}</span>
        {o.label}
      </div>
    {/each}
  </div>
{/if}

<style>
  .select {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 140px;
    height: 28px;
    padding: 0 8px 0 10px;
    border: 1px solid var(--line-control);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    transition:
      border-color var(--motion-fast),
      background-color var(--motion-fast);
  }

  .select:hover:not(:disabled),
  .select.open {
    border-color: var(--muted);
  }

  .select:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 1px;
  }

  .select:disabled {
    cursor: default;
    opacity: 0.5;
  }

  .text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chevron {
    display: inline-flex;
    flex: none;
    color: var(--muted);
    transition: transform var(--motion-fast);
  }

  .select.open .chevron {
    transform: rotate(180deg);
  }

  .options {
    position: fixed;
    z-index: 40;
    max-height: 260px;
    overflow: auto;
    padding: 4px;
    border: 1px solid var(--line-control);
    border-radius: 6px;
    background: var(--panel);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
    animation: pop-in var(--motion) ease-out;
    transform-origin: top;
  }

  .options.up {
    transform-origin: bottom;
  }

  .option {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px 0 6px;
    border-radius: 4px;
    font-size: 12px;
    white-space: nowrap;
    cursor: pointer;
  }

  .option.active {
    background: var(--selected-bg);
    color: var(--text-strong);
  }

  .option.chosen .mark {
    color: var(--accent);
  }

  .mark {
    display: inline-flex;
    width: 14px;
    flex: none;
  }
</style>
