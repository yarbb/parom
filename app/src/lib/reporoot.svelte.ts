// Where a site's local folder sits in its repository: the folder may be the
// repository itself or a folder inside it (the server's files moved into
// "serverFiles/"). The GitHub tab shows the repository; sync and synchronized
// browsing use the folder (src-tauri/src/git.rs scopes git to it).
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Site } from './sites.svelte';

export interface RepoLocation {
  /** The repository's folder. */
  root: string;
  /** The site's folder inside it, "/" separated; "" for the root. */
  sub: string;
}

class RepoRoots {
  /** By folder (lower case); null when it is not in a repository. */
  #known = $state<Record<string, RepoLocation | null>>({});
  #asked = new Set<string>();

  /** The location once known (undefined while it is being looked up). */
  location(dir: string): RepoLocation | null | undefined {
    const key = dir.trim().toLowerCase();
    if (!key) {
      return null;
    }
    const known = this.#known[key];
    if (known === undefined && !this.#asked.has(key)) {
      this.#asked.add(key);
      // Async on purpose: this is read inside derived values.
      void (isTauri() ? invoke<RepoLocation>('git_locate', { dir: dir.trim() }) : Promise.reject(new Error('no repository')))
        .then((loc) => (this.#known[key] = loc))
        .catch(() => (this.#known[key] = null));
    }
    return known;
  }

  /** The repository holding `dir` (dir itself until that is known). */
  root(dir: string): string {
    return this.location(dir)?.root ?? dir.trim();
  }

  /** Looks folders up again (sites changed, a folder moved). */
  forget(): void {
    this.#asked.clear();
    this.#known = {};
  }
}

export const repoRoots = new RepoRoots();

/** Whether the site deploys from the repository in `repoDir`. */
export const siteUsesRepo = (site: Site | null | undefined, repoDir: string) =>
  !!site?.localDir.trim() && !!repoDir && repoRoots.root(site.localDir).toLowerCase() === repoDir.toLowerCase();
