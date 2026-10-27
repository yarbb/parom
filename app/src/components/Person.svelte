<script lang="ts">
  import { openGitHub } from '../lib/github.svelte';
  import Avatar from './Avatar.svelte';

  // An avatar and a name; with a GitHub login both open the profile.
  let { name, login = null, src = null, muted = false }: { name: string; login?: string | null; src?: string | null; muted?: boolean } = $props();
</script>

{#if login}
  <button class="person" class:muted title={`@${login}`} onclick={() => openGitHub(`https://github.com/${login}`)}>
    <Avatar {name} {src} size={20} />{name}
  </button>
{:else}
  <span class="person" class:muted><Avatar {name} {src} size={20} />{name}</span>
{/if}

<style>
  .person {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 6px 2px 2px;
    border: 0;
    border-radius: 12px;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 12px;
    transition: background-color var(--motion-fast);
  }

  button.person {
    cursor: pointer;
  }

  button.person:hover {
    background: var(--selected-bg);
    color: var(--text-strong);
  }

  .muted {
    color: var(--muted);
  }
</style>
