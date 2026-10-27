// After a sync: issues the deployed commits fix get a comment and are closed.
import { invoke } from '@tauri-apps/api/core';
import { api, github } from './github.svelte';
import type { Item } from './issues.svelte';
import { linkedIssues } from './linked';
import type { BranchInfo, LogEntry } from './repo.svelte';

/**
 * Closes the open issues that commits after `from` up to `to` fix. Returns
 * the closed numbers, or null when there is no GitHub account or the
 * repository is not on github.com.
 */
export async function closeDeployedIssues(dir: string, from: string, to: string, server: string): Promise<number[] | null> {
  if (!github.user) {
    return null;
  }
  const info = await invoke<BranchInfo>('repo_info', { dir });
  if (!info.github) {
    return null;
  }
  const log = await invoke<LogEntry[]>('repo_log', { dir, limit: 1000 });
  const start = log.findIndex((c) => c.sha === to);
  const end = log.findIndex((c) => c.sha === from);
  if (start < 0 || end < start) {
    return [];
  }
  const numbers = [...new Set(log.slice(start, end).flatMap((c) => linkedIssues(`${c.summary}\n${c.body}`)))];
  const closed: number[] = [];
  for (const n of numbers) {
    const issue = await api<Item>('GET', `/repos/${info.github}/issues/${n}`);
    if (issue.state !== 'open' || issue.pull_request) {
      continue;
    }
    await api('POST', `/repos/${info.github}/issues/${n}/comments`, {
      body: `Deployed to ${server} in ${to.slice(0, 7)}.`,
    });
    await api('PATCH', `/repos/${info.github}/issues/${n}`, { state: 'closed', state_reason: 'completed' });
    closed.push(n);
  }
  return closed;
}
