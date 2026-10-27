import { describe, expect, it } from 'vitest';
import { linkedIssues } from './linked';

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
