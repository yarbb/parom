<script lang="ts">
  // A person's avatar, or their initial on a colour picked from the name.
  let { name, src = null, size = 18 }: { name: string; src?: string | null; size?: number } = $props();

  let failed = $state(false);
  const hue = $derived([...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7));
</script>

{#if src && !failed}
  <img class="avatar" {src} alt={name} title={name} width={size} height={size} style:--size="{size}px" onerror={() => (failed = true)} />
{:else}
  <span class="avatar initial" title={name} style:--size="{size}px" style:--hue={hue}>{name.trim().charAt(0).toUpperCase() || '?'}</span>
{/if}

<style>
  .avatar {
    display: inline-flex;
    flex: none;
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    object-fit: cover;
    box-shadow: 0 0 0 1.5px var(--bg);
  }

  .initial {
    align-items: center;
    justify-content: center;
    background: hsl(var(--hue) 45% 38%);
    color: #fff;
    font-size: calc(var(--size) * 0.55);
    font-weight: 600;
    line-height: 1;
  }
</style>
