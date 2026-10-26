<script lang="ts">
  import {
    clickSelection,
    formatFullTime,
    formatSize,
    formatTime,
    sortRows,
    visibleRange,
    type FileRow,
    type Sort,
    type SortKey,
  } from '../lib/files';
  import { t } from '../lib/i18n';
  import { prefs } from '../lib/prefs.svelte';

  interface Props {
    rows: FileRow[];
    /** Shows a ".." row that calls onUp. */
    canGoUp: boolean;
    onUp: () => void;
    onOpenDir: (row: FileRow) => void;
    /** Enter or double-click on files (e.g. transfer them). */
    onActivate: (rows: FileRow[]) => void;
    selected?: FileRow[];
    loading?: boolean;
    error?: string;
    emptyText?: string;
    label: string;
    /** Right click: the rows it applies to (empty for the blank area). */
    onContextMenu?: (e: MouseEvent, rows: FileRow[]) => void;
    /** F2, Delete and F5 on the selection. */
    onCommand?: (command: 'rename' | 'delete' | 'refresh', rows: FileRow[]) => void;
  }

  let {
    rows,
    canGoUp,
    onUp,
    onOpenDir,
    onActivate,
    selected = $bindable([]),
    loading = false,
    error = '',
    emptyText = '',
    label,
    onContextMenu,
    onCommand,
  }: Props = $props();

  // Only the rows in view are in the DOM, so 100k entries stay cheap.
  let rowHeight = $derived(prefs.value.density === 'compact' ? 24 : 30);
  let decimal = $derived(prefs.value.sizeUnits === 'decimal');
  let iso = $derived(prefs.value.dateFormat === 'iso');

  let sort = $state<Sort>({ key: 'name', desc: false });
  let shown = $derived(prefs.value.showHidden ? rows : rows.filter((r) => !r.name.startsWith('.')));
  let sorted = $derived(
    sortRows(shown, sort, { foldersFirst: prefs.value.foldersFirst, caseSensitive: prefs.value.caseSensitive }),
  );
  let offset = $derived(canGoUp ? 1 : 0);
  let count = $derived(sorted.length + offset);

  let viewport: HTMLDivElement;
  let scrollTop = $state(0);
  let height = $state(0);
  let range = $derived(visibleRange(scrollTop, height, rowHeight, count));
  let indices = $derived(Array.from({ length: range.end - range.start }, (_, k) => range.start + k));

  let selection = $state(new Set<number>());
  let anchor: number | null = null;
  let focusIndex = $state(-1);

  // A new listing or sort order invalidates indexes.
  $effect(() => {
    void sorted;
    selection = new Set();
    anchor = null;
    focusIndex = -1;
    if (viewport) {
      viewport.scrollTop = 0;
      scrollTop = 0;
    }
  });

  $effect(() => {
    selected = [...selection].filter((i) => i >= offset && i < count).map((i) => sorted[i - offset]);
  });

  const rowAt = (i: number): FileRow | null => (i < offset ? null : sorted[i - offset]);

  function setSort(key: SortKey) {
    sort = sort.key === key ? { key, desc: !sort.desc } : { key, desc: false };
  }

  function open(i: number) {
    const row = rowAt(i);
    if (!row) {
      onUp();
    } else if (row.dir) {
      onOpenDir(row);
    } else if (prefs.value.doubleClick === 'transfer') {
      onActivate([row]);
    }
  }

  function reveal(i: number) {
    const top = i * rowHeight;
    if (top < viewport.scrollTop) {
      viewport.scrollTop = top;
    } else if (top + rowHeight > viewport.scrollTop + height) {
      viewport.scrollTop = top + rowHeight - height;
    }
  }

  function click(e: MouseEvent, i: number) {
    selection = clickSelection(selection, anchor, i, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
    if (!e.shiftKey) {
      anchor = i;
    }
    focusIndex = i;
    viewport.focus();
  }

  const rowsOf = (set: Set<number>) => [...set].filter((i) => i >= offset && i < count).map((i) => sorted[i - offset]);

  function contextMenu(e: MouseEvent, i: number | null) {
    if (!onContextMenu) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (i === null) {
      selection = new Set();
      onContextMenu(e, []);
      return;
    }
    if (!selection.has(i)) {
      selection = new Set([i]);
      anchor = i;
    }
    focusIndex = i;
    viewport.focus();
    onContextMenu(e, rowsOf(selection));
  }

  function move(to: number, extend: boolean) {
    if (count === 0) {
      return;
    }
    const i = Math.max(0, Math.min(count - 1, to));
    selection = extend && anchor !== null ? clickSelection(selection, anchor, i, { ctrl: false, shift: true }) : new Set([i]);
    if (!extend) {
      anchor = i;
    }
    focusIndex = i;
    reveal(i);
  }

  function onkeydown(e: KeyboardEvent) {
    const page = Math.max(1, Math.floor(height / rowHeight) - 1);
    switch (e.key) {
      case 'ArrowDown':
        move(focusIndex + 1, e.shiftKey);
        break;
      case 'ArrowUp':
        move(focusIndex < 0 ? 0 : focusIndex - 1, e.shiftKey);
        break;
      case 'PageDown':
        move(focusIndex + page, e.shiftKey);
        break;
      case 'PageUp':
        move(focusIndex - page, e.shiftKey);
        break;
      case 'Home':
        move(0, e.shiftKey);
        break;
      case 'End':
        move(count - 1, e.shiftKey);
        break;
      case 'Backspace':
        if (canGoUp) {
          onUp();
        }
        break;
      case 'F2':
        if (selected.length === 1) {
          onCommand?.('rename', selected);
        }
        break;
      case 'Delete':
        if (selected.length) {
          onCommand?.('delete', selected);
        }
        break;
      case 'F5':
        onCommand?.('refresh', selected);
        break;
      case 'Enter': {
        const files = selected.filter((r) => !r.dir);
        if (selected.length === 1 && selected[0].dir) {
          onOpenDir(selected[0]);
        } else if (files.length) {
          onActivate(files);
        } else if (focusIndex === 0 && canGoUp) {
          onUp();
        }
        break;
      }
      case 'a':
        if (e.ctrlKey || e.metaKey) {
          selection = new Set(Array.from({ length: sorted.length }, (_, k) => k + offset));
          break;
        }
        return;
      default:
        return;
    }
    e.preventDefault();
  }

  const arrow = (key: SortKey) => (sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : '');
</script>

<div class="list">
  <div class="header muted">
    <button class="col name" onclick={() => setSort('name')}>{t('files.name')}{arrow('name')}</button>
    <button class="col size" onclick={() => setSort('size')}>{t('files.size')}{arrow('size')}</button>
    <button class="col time" onclick={() => setSort('time')}>{t('files.modified')}{arrow('time')}</button>
  </div>
  <div
    class="viewport"
    role="listbox"
    aria-label={label}
    aria-multiselectable="true"
    tabindex="0"
    bind:this={viewport}
    bind:clientHeight={height}
    onscroll={() => (scrollTop = viewport.scrollTop)}
    oncontextmenu={(e) => contextMenu(e, null)}
    {onkeydown}
  >
    <div class="spacer" style:height="{count * rowHeight}px">
      {#each indices as i (i)}
        {@const row = rowAt(i)}
        <div
          class="row"
          class:selected={selection.has(i)}
          class:focused={focusIndex === i}
          role="option"
          tabindex="-1"
          aria-selected={selection.has(i)}
          style:transform="translateY({i * rowHeight}px)"
          style:height="{rowHeight}px"
          onclick={(e) => click(e, i)}
          ondblclick={() => open(i)}
          oncontextmenu={(e) => (i < offset ? e.preventDefault() : contextMenu(e, i))}
          onkeydown={() => {}}
        >
          {#if row}
            <span class="col name mono" title={row.name}>{row.dir ? `▸ ${row.name}/` : row.name}</span>
            <span class="col size mono muted">{row.dir ? '' : formatSize(row.size, decimal)}</span>
            <span class="col time mono muted" title={formatFullTime(row.time)}>{formatTime(row.time, Date.now(), iso)}</span>
          {:else}
            <span class="col name mono">..</span>
          {/if}
        </div>
      {/each}
    </div>
    {#if loading || error || (count === 0 && emptyText)}
      <div class="overlay" class:status-removed={!!error}>
        {loading ? t('files.loading') : error || emptyText}
      </div>
    {/if}
  </div>
</div>

<style>
  .list {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .header {
    display: flex;
    gap: 10px;
    height: 26px;
    padding: 0 14px;
    border-bottom: 1px solid var(--line-row);
    flex: none;
  }

  .header button {
    border: 0;
    padding: 0;
    background: none;
    color: inherit;
    font: inherit;
    font-size: 11px;
    text-align: left;
    cursor: pointer;
  }

  .viewport {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    position: relative;
    outline: none;
  }

  .spacer {
    position: relative;
  }

  .row {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 30px;
    padding: 0 14px;
    border-bottom: 1px solid var(--line-row);
    font-size: 12px;
    cursor: default;
    user-select: none;
  }

  .row.selected {
    background: var(--selected-bg);
    box-shadow: inset 2px 0 0 var(--selected-mark);
    color: var(--text-strong);
  }

  .viewport:focus-visible .row.focused {
    outline: 1px dotted var(--muted);
    outline-offset: -1px;
  }

  .col {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .name {
    flex: 1;
    min-width: 0;
  }

  .size {
    width: 70px;
    text-align: right;
    flex: none;
  }

  .header .size {
    text-align: right;
  }

  .time {
    width: 110px;
    flex: none;
  }

  .overlay {
    position: absolute;
    top: 40px;
    left: 0;
    right: 0;
    text-align: center;
    color: var(--muted);
    pointer-events: none;
  }
</style>
