<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    onCancel: () => void;
    children: Snippet;
    actions: Snippet;
  }

  let { title, onCancel, children, actions }: Props = $props();
  let dialog: HTMLDivElement;

  $effect(() => {
    // Focus the first control so Enter/Escape work immediately.
    const first = dialog.querySelector<HTMLElement>('input, button.primary, button');
    first?.focus();
  });

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }
</script>

<div class="backdrop">
  <div class="dialog" role="dialog" aria-modal="true" aria-label={title} tabindex="-1" bind:this={dialog} {onkeydown}>
    <h2>{title}</h2>
    <div class="body">{@render children()}</div>
    <div class="actions">{@render actions()}</div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgb(0 0 0 / 0.55);
    z-index: 10;
  }

  .dialog {
    width: 480px;
    max-width: calc(100vw - 32px);
    padding: 18px 20px;
    border: 1px solid var(--line-control);
    border-radius: 6px;
    background: var(--panel);
    outline: none;
  }

  h2 {
    margin: 0 0 12px;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-strong);
  }

  .body {
    line-height: 1.5;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 18px;
  }
</style>
