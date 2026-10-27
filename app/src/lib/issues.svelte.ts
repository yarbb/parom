// Issues and pull requests of the current repository (GitHub REST).
import { api } from './github.svelte';

export type Kind = 'issues' | 'pulls';

export interface Label {
  name: string;
  color: string;
}

export interface Item {
  number: number;
  title: string;
  state: 'open' | 'closed';
  body: string | null;
  /** Markdown rendered by GitHub (requested with `html`). */
  body_html?: string | null;
  user: { login: string } | null;
  labels: Label[];
  assignees: { login: string }[];
  comments: number;
  created_at: string;
  updated_at: string;
  html_url: string;
  /** Set on issues that are pull requests (the issues list returns both). */
  pull_request?: unknown;
  /** Pull requests only. */
  merged_at?: string | null;
  draft?: boolean;
  head?: { label: string; ref: string; sha: string };
  base?: { ref: string };
}

export interface PullDetail extends Item {
  merged: boolean;
  mergeable: boolean | null;
  mergeable_state: string;
  additions: number;
  deletions: number;
  changed_files: number;
  commits: number;
}

export interface Comment {
  id: number;
  user: { login: string } | null;
  body: string;
  body_html?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface CheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
}

const repoPath = (slug: string) => `/repos/${slug}`;

// Session caches: lists and opened issues show at once when revisited, and
// unchanged entries keep their rendered HTML (with GitHub's signed image
// links), so images are not downloaded again. Text only: a few KB each.
export const listCache = new Map<string, Item[]>();
export const detailCache = new Map<string, { comments: Comment[]; pull: PullDetail | null; checks: CheckRun[] | null }>();

/** Fresh entries, but the cached object wherever nothing changed on GitHub. */
export function keepUnchanged<T extends { updated_at?: string }>(fresh: T[], old: T[] | undefined, id: (x: T) => number): T[] {
  if (!old) {
    return fresh;
  }
  const byId = new Map(old.map((x) => [id(x), x]));
  return fresh.map((f) => {
    const o = byId.get(id(f));
    return o && o.updated_at && o.updated_at === f.updated_at ? o : f;
  });
}

export async function listItems(slug: string, kind: Kind, state: 'open' | 'closed'): Promise<Item[]> {
  const items = await api<Item[]>('GET', `${repoPath(slug)}/${kind}?state=${state}&per_page=100&sort=updated&direction=desc`, undefined, true);
  return kind === 'issues' ? items.filter((i) => !i.pull_request) : items;
}

export const getPull = (slug: string, n: number) => api<PullDetail>('GET', `${repoPath(slug)}/pulls/${n}`, undefined, true);

export const listComments = (slug: string, n: number) => api<Comment[]>('GET', `${repoPath(slug)}/issues/${n}/comments?per_page=100`, undefined, true);

export const addComment = (slug: string, n: number, body: string) =>
  api<Comment>('POST', `${repoPath(slug)}/issues/${n}/comments`, { body }, true);

export const listLabels = (slug: string) => api<Label[]>('GET', `${repoPath(slug)}/labels?per_page=100`);

export const createIssue = (slug: string, issue: { title: string; body: string; labels: string[] }) =>
  api<Item>('POST', `${repoPath(slug)}/issues`, issue, true);

/** GitHub-rendered HTML for a Markdown text (issue links resolved in `slug`). */
export const renderMarkdown = (slug: string, text: string) =>
  api<string>('POST', '/markdown', { text, mode: 'gfm', context: slug });

export const setState = (slug: string, kind: Kind, n: number, state: 'open' | 'closed') =>
  api<Item>('PATCH', `${repoPath(slug)}/${kind}/${n}`, { state });

export const mergePull = (slug: string, n: number) =>
  api<{ merged: boolean; message: string }>('PUT', `${repoPath(slug)}/pulls/${n}/merge`, { merge_method: 'merge' });

/** Check runs of a commit; null when the token may not read them. */
export async function checkRuns(slug: string, sha: string): Promise<CheckRun[] | null> {
  try {
    const res = await api<{ check_runs: CheckRun[] }>('GET', `${repoPath(slug)}/commits/${sha}/check-runs?per_page=50`);
    return res.check_runs;
  } catch {
    return null;
  }
}

/** Number of open (or closed / merged) issues or pull requests, via search. */
export async function countItems(slug: string, kind: Kind, state: 'open' | 'closed'): Promise<number> {
  const type = kind === 'issues' ? 'issue' : 'pr';
  const q = encodeURIComponent(`repo:${slug} type:${type} state:${state}`);
  const res = await api<{ total_count: number }>('GET', `/search/issues?q=${q}&per_page=1`);
  return res.total_count;
}

class Counts {
  issues = $state<number | null>(null);
  pulls = $state<number | null>(null);
  #slug = '';

  async load(slug: string | null): Promise<void> {
    this.#slug = slug ?? '';
    if (!slug) {
      this.issues = this.pulls = null;
      return;
    }
    const [issues, pulls] = await Promise.all([
      countItems(slug, 'issues', 'open').catch(() => null),
      countItems(slug, 'pulls', 'open').catch(() => null),
    ]);
    if (slug === this.#slug) {
      this.issues = issues;
      this.pulls = pulls;
    }
  }
}

export const counts = new Counts();
