<script lang="ts">
  // A calm placeholder for lists with nothing to show: an icon, one line of
  // title, a sentence on what to do, and optionally buttons for it.
  import type { Component, Snippet } from 'svelte';

  interface Props {
    icon: Component<{ size?: number; strokeWidth?: number }>;
    title: string;
    text?: string;
    actions?: Snippet;
  }

  let { icon: Icon, title, text, actions }: Props = $props();
</script>

<div class="empty-state">
  <span class="icon" aria-hidden="true"><Icon size={26} strokeWidth={1.3} /></span>
  <div class="title">{title}</div>
  {#if text}<p class="text">{text}</p>{/if}
  {#if actions}<div class="actions">{@render actions()}</div>{/if}
</div>

<style>
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    max-width: 320px;
    margin: 0 auto;
    padding: 28px 16px;
    text-align: center;
    animation: fade-in var(--motion) ease-out;
  }

  .icon {
    display: inline-flex;
    margin-bottom: 4px;
    color: var(--muted);
    opacity: 0.8;
  }

  .title {
    color: var(--text-strong);
    font-size: 13px;
    font-weight: 600;
  }

  .text {
    margin: 0;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.5;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    margin-top: 8px;
  }
</style>
