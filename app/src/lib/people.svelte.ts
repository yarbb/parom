// Who wrote a commit: the author and the "Co-Authored-By:" trailers, with
// GitHub avatars where they are known (GitHub's commit list, noreply emails).
import { SvelteMap } from 'svelte/reactivity';
import { api, github } from './github.svelte';

export interface Person {
  name: string;
  email: string;
}

/** Splits "Co-Authored-By: Name <email>" trailers off a commit body. */
export function coAuthors(body: string): { body: string; people: Person[] } {
  const people: Person[] = [];
  const kept: string[] = [];
  for (const line of body.split('\n')) {
    const m = /^\s*co-authored-by:\s*(.+?)\s*<([^>]+)>\s*$/i.exec(line);
    if (m) {
      people.push({ name: m[1], email: m[2] });
    } else {
      kept.push(line);
    }
  }
  return { body: kept.join('\n').trim(), people };
}

/** Avatar of a GitHub noreply address ("12345+login@users.noreply.github.com"). */
export function noreplyAvatar(email: string): string | null {
  const m = /^(?:(\d+)\+)?([^@]+)@users\.noreply\.github\.com$/i.exec(email.trim());
  if (!m) {
    return null;
  }
  return m[1] ? `https://avatars.githubusercontent.com/u/${m[1]}?s=64` : `https://avatars.githubusercontent.com/${m[2]}?s=64`;
}

class Avatars {
  /** Commit sha to its author's avatar, from GitHub's commit list. */
  bySha = new SvelteMap<string, string>();
  /** Email to avatar, learned from those commits. */
  byEmail = new SvelteMap<string, string>();
  #loaded = new Set<string>();

  /** Loads the newest commits of a branch from GitHub once per session. */
  async load(slug: string, branch: string): Promise<void> {
    const key = `${slug}@${branch}`;
    if (!github.user || this.#loaded.has(key)) {
      return;
    }
    this.#loaded.add(key);
    try {
      const commits = await api<{ sha: string; author: { avatar_url: string } | null; commit: { author: { email: string } } }[]>(
        'GET',
        `/repos/${slug}/commits?sha=${encodeURIComponent(branch)}&per_page=100`,
      );
      for (const c of commits) {
        if (c.author?.avatar_url) {
          this.bySha.set(c.sha, c.author.avatar_url);
          this.byEmail.set(c.commit.author.email.toLowerCase(), c.author.avatar_url);
        }
      }
    } catch {
      this.#loaded.delete(key);
    }
  }

  /** Best known avatar for a commit's author or a co-author. */
  of(email: string, sha?: string): string | null {
    return (sha && this.bySha.get(sha)) || this.byEmail.get(email.toLowerCase()) || noreplyAvatar(email);
  }
}

export const avatars = new Avatars();
