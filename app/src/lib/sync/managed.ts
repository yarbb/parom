// Which repository files sync may touch, from `.parom-ignore` in the repo
// (gitignore syntax). Plain lines list managed paths (none: everything is
// managed); lines starting with "!" are protected: never uploaded or
// overwritten, e.g. "!data/**" for files the game server writes itself.

export interface Rules {
  include: RegExp[];
  protect: RegExp[];
  /** Top-level folders or files chosen for the site (Site Manager); empty: no limit. */
  within?: string[];
}

export type FileClass = 'managed' | 'protected' | 'unmanaged';

/** Repository plumbing that has no business on a server. */
const alwaysSkipped = ['.git/', '.github/', '.gitignore', '.gitattributes', '.gitmodules', '.parom-ignore', '.totzilla-ignore'];

/** The rules file in the repository root, and its name before the app was renamed. */
export const ignoreName = '.parom-ignore';
export const legacyIgnoreName = '.totzilla-ignore';

/** gitignore-style pattern to a regular expression over "/"-separated relative paths. */
export function globToRegExp(pattern: string): RegExp {
  let p = pattern.trim();
  const anchored = p.startsWith('/');
  p = p.replace(/^\/+/, '').replace(/\/+$/, '');
  // A pattern without a slash matches at any depth (like gitignore).
  const anywhere = !anchored && !p.includes('/');
  let body = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      if (p[i + 2] === '/') {
        body += '(?:.*/)?';
        i += 2;
      } else {
        body += '.*';
        i += 1;
      }
    } else if (c === '*') {
      body += '[^/]*';
    } else if (c === '?') {
      body += '[^/]';
    } else {
      body += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  // Matching a folder also covers everything inside it.
  return new RegExp(`^${anywhere ? '(?:.*/)?' : ''}${body}(?:/.*)?$`);
}

export function parseRules(text: string): Rules {
  const rules: Rules = { include: [], protect: [] };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    if (line.startsWith('!')) {
      const p = line.slice(1).trim();
      if (p) {
        rules.protect.push(globToRegExp(p));
      }
    } else {
      rules.include.push(globToRegExp(line));
    }
  }
  return rules;
}

export function classify(path: string, rules: Rules): FileClass {
  if (alwaysSkipped.some((s) => (s.endsWith('/') ? path.startsWith(s) : path === s || path.endsWith(`/${s}`)))) {
    return 'unmanaged';
  }
  if (rules.within?.length && !rules.within.some((w) => path === w || path.startsWith(`${w}/`))) {
    return 'unmanaged';
  }
  if (rules.protect.some((r) => r.test(path))) {
    return 'protected';
  }
  if (rules.include.length === 0 || rules.include.some((r) => r.test(path))) {
    return 'managed';
  }
  return 'unmanaged';
}
