<script lang="ts" module>
  export interface MenuItem {
    label: string;
    action?: () => void;
    disabled?: boolean;
    /** Shortcut shown on the right, e.g. "F2". */
    hint?: string;
    separator?: boolean;
    /** Shown in a soft red: signs out, deletes, reports. */
    danger?: boolean;
  }
</script>

<script lang="ts">
  interface Props {
    x: number;
    y: number;
    items: MenuItem[];
    onClose: () => void;
  }

  let { x, y, items, onClose }: Props = $props();
  let menu: HTMLDivElement;
  let left = $state(0);
  let top = $state(0);

  // Keep the menu inside the window.
  $effect(() => {
    const r = menu.getBoundingClientRect();
    left = Math.min(x, window.innerWidth - r.width - 4);
    top = Math.min(y, window.innerHeight - r.height - 4);
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  });

  function run(item: MenuItem) {
    onClose();
    item.action?.();
  }

  function onkeydown(e: KeyboardEvent) {
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      buttons[(i + 1) % buttons.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      buttons[(i - 1 + buttons.length) % buttons.length]?.focus();
    } else {
      return;
    }
    e.preventDefault();
  }
</script>

<svelte:window onmousedown={(e) => !menu.contains(e.target as Node) && onClose()} onblur={onClose} />

<div class="menu menu-unroll" role="menu" tabindex="-1" bind:this={menu} style:left="{left}px" style:top="{top}px" {onkeydown}>
  {#each items as item, i (i)}
    {#if item.separator}
      <div class="separator" role="separator"></div>
    {:else}
      <button role="menuitem" class:danger={item.danger} disabled={item.disabled} onclick={() => run(item)}>
        <span>{item.label}</span>
        {#if item.hint}<span class="hint mono">{item.hint}</span>{/if}
      </button>
    {/if}
  {/each}
</div>

<style>
  .menu {
    position: fixed;
    min-width: 200px;
    padding: 4px 0;
    border: 1px solid var(--line-control);
    border-radius: 4px;
    background: var(--panel);
    z-index: 20;
    outline: none;
  }

  button {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    width: 100%;
    padding: 6px 12px;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }

  button:hover:not(:disabled),
  button:focus-visible {
    background: var(--selected-bg);
    color: var(--text-strong);
    outline: none;
  }

  button.danger {
    color: color-mix(in srgb, var(--removed) 80%, var(--text));
  }

  button.danger:hover:not(:disabled),
  button.danger:focus-visible {
    background: color-mix(in srgb, var(--removed) 12%, transparent);
    color: var(--removed);
  }

  button:disabled {
    color: var(--muted);
    cursor: default;
  }

  .hint {
    color: var(--muted);
    font-size: 11px;
  }

  .separator {
    height: 1px;
    margin: 4px 0;
    background: var(--line-row);
  }
</style>
