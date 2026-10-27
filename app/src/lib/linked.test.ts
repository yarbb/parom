import { describe, expect, it } from 'vitest';
import { linkedIssues } from './linked';
import { coAuthors, noreplyAvatar } from './people.svelte';

describe('linkedIssues', () => {
  it('finds closing keywords', () => {
    expect(linkedIssues('Fix crash\n\nFixes #12, closes #3 and resolved #7')).toEqual([12, 3, 7]);
    expect(linkedIssues('fix: #5')).toEqual([5]);
    expect(linkedIssues('Close #4. Close #4 again')).toEqual([4]);
  });

  it('ignores plain mentions', () => {
    expect(linkedIssues('See #9, related to #10')).toEqual([]);
    expect(linkedIssues('prefix#3 fixes#4')).toEqual([]);
  });
});

describe('coAuthors', () => {
  it('splits co-author trailers off the body', () => {
    const r = coAuthors('Fix the thing\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nco-authored-by: Ann <1+ann@users.noreply.github.com>');
    expect(r.body).toBe('Fix the thing');
    expect(r.people.map((p) => p.name)).toEqual(['Claude Opus 5.5', 'Ann']);
  });

  it('finds avatars of GitHub noreply addresses', () => {
    expect(noreplyAvatar('42+ann@users.noreply.github.com')).toBe('https://avatars.githubusercontent.com/u/42?s=64');
    expect(noreplyAvatar('ann@users.noreply.github.com')).toBe('https://avatars.githubusercontent.com/ann?s=64');
    expect(noreplyAvatar('noreply@anthropic.com')).toBeNull();
  });
});
