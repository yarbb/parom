// Right-click items of the file panes that add rows to the repository's
// .gitignore or .parom-ignore (lib/ignorefiles.ts).
import type { MenuItem } from '../components/ContextMenu.svelte';
import { connection } from './connection.svelte';
import { t } from './i18n';
import { addIgnoreLines, extensionPattern, ignoreLine, type IgnoreKind, type IgnoreTarget } from './ignorefiles';
import { repo } from './repo.svelte';

function done(kind: IgnoreKind, repoDir: string, added: boolean, error?: unknown) {
  const file = kind === 'git' ? '.gitignore' : '.parom-ignore';
  if (error !== undefined) {
    connection.message = { level: 'error', text: String(error) };
    return;
  }
  connection.message = {
    level: 'status',
    text: added ? t(kind === 'git' ? 'ignore.added_git' : 'ignore.added_protect', { file }) : t('ignore.already', { file }),
  };
  if (added && repo.dir && repo.dir.toLowerCase() === repoDir.toLowerCase()) {
    void repo.refreshChanges();
  }
}

/** Items for rows of one folder inside the repository `repoDir`; none outside one. */
export function ignoreItems(repoDir: string | null, targets: (IgnoreTarget & { name: string })[]): MenuItem[] {
  if (!repoDir || !targets.length) {
    return [];
  }
  const run = (kind: IgnoreKind, lines: string[]) =>
    void addIgnoreLines(repoDir, kind, lines).then(
      (added) => done(kind, repoDir, added),
      (e) => done(kind, repoDir, false, e ?? 'error'),
    );
  const ext = targets.length === 1 && !targets[0].dir ? extensionPattern(targets[0].name) : null;
  return [
    { separator: true, label: '' },
    { label: t('ignore.git'), action: () => run('git', targets.map((x) => ignoreLine('git', x))) },
    ...(ext ? [{ label: t('ignore.git_ext', { pattern: ext }), action: () => run('git', [ext]) }] : []),
    { label: t('ignore.protect'), action: () => run('protect', targets.map((x) => ignoreLine('protect', x))) },
  ];
}
