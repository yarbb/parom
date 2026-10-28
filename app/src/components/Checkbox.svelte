<script lang="ts">
  import type { Snippet } from 'svelte';
  // 18px checkbox from docs/design (.cb): a native input for keyboard and
  // screen readers, drawn as a box with a check mark.
  interface Props {
    checked: boolean;
    label: string;
    disabled?: boolean;
    title?: string;
    /** Shown instead of `label` (still part of the clickable label). */
    children?: Snippet;
  }

  let { checked = $bindable(), label, disabled = false, title, children }: Props = $props();
</script>

<label class="checkbox" class:disabled {title}>
  <input type="checkbox" bind:checked {disabled} />
  <span class="box" aria-hidden="true">
    {#if checked}
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M2.5 6.2l2.3 2.3 4.7-4.9" />
      </svg>
    {/if}
  </span>
  {#if children}{@render children()}{:else}<span>{label}</span>{/if}
</label>

<style>
  .checkbox {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    cursor: pointer;
    user-select: none;
  }

  .disabled {
    cursor: default;
    opacity: 0.5;
  }

  input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
  }

  .box {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    flex: none;
    border: 1px solid var(--line-control);
    border-radius: 4px;
    color: var(--primary-fg);
  }

  input:checked + .box {
    background: var(--primary-bg);
    border-color: var(--primary-bg);
  }

  input:focus-visible + .box {
    outline: 1px solid var(--selected-mark);
    outline-offset: 1px;
  }
</style>
