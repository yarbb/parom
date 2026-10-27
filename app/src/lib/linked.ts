// Issues a deployed commit refers to with GitHub's closing keywords.

/** Issue numbers a commit message closes ("Fixes #12", "closes #3", ...). */
export function linkedIssues(message: string): number[] {
  const out = new Set<number>();
  for (const m of message.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)\b/gi)) {
    out.add(Number(m[1]));
  }
  return [...out];
}
