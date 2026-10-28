<script lang="ts">
  // An issue or pull request label in its GitHub colour. The text mixes the
  // label colour with the theme's strongest text, so it stays readable on
  // dark and light backgrounds whatever colour the label has.
  let { name, color, title }: { name: string; color?: string; title?: string } = $props();
  const valid = $derived(/^[0-9a-f]{6}$/i.test(color ?? '') ? `#${color}` : null);
</script>

<span class="gh-label" class:plain={!valid} style:--lc={valid} {title}>{name}</span>

<style>
  .gh-label {
    flex: none;
    display: inline-block;
    padding: 1px 7px;
    border: 1px solid color-mix(in srgb, var(--lc) 55%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--lc) 18%, transparent);
    color: color-mix(in srgb, var(--lc) 65%, var(--text-strong));
    font-size: 10.5px;
    line-height: 1.5;
    white-space: nowrap;
  }

  .gh-label.plain {
    border-color: var(--line-control);
    background: none;
    color: var(--muted);
  }
</style>
