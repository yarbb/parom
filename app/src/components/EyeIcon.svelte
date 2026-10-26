<script lang="ts">
  let { closed = false }: { closed?: boolean } = $props();
</script>

<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
  <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
  <circle cx="8" cy="8" r="2" />
  {#if closed}
    <path d="M2.5 13.5l11-11" />
  {/if}
</svg>
