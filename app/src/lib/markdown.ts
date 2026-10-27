// GitHub renders issue and comment Markdown (body_html) and sanitizes it.
// The app runs it through its own allowlist as well before showing it: the
// page can call the backend, so no script, handler or odd URL may get in.

const allowed: Record<string, string[]> = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  input: ['type', 'checked', 'disabled'],
  ol: ['start'],
  td: ['align'],
  th: ['align'],
  code: [],
  pre: [],
  p: [],
  br: [],
  hr: [],
  h1: [],
  h2: [],
  h3: [],
  h4: [],
  h5: [],
  h6: [],
  strong: [],
  b: [],
  em: [],
  i: [],
  del: [],
  s: [],
  blockquote: [],
  ul: [],
  li: [],
  table: [],
  thead: [],
  tbody: [],
  tr: [],
  span: [],
  div: [],
  details: [],
  summary: [],
  sup: [],
  sub: [],
  kbd: [],
};

/** Removed with everything inside them. */
const dropped = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'button', 'textarea', 'select', 'svg', 'math', 'template']);

function safeUrl(value: string, images: boolean): boolean {
  try {
    const url = new URL(value, 'https://github.com/');
    return url.protocol === 'https:' || (!images && (url.protocol === 'http:' || url.protocol === 'mailto:'));
  } catch {
    return false;
  }
}

function clean(node: Element): void {
  for (const child of [...node.children]) {
    const tag = child.tagName.toLowerCase();
    if (dropped.has(tag)) {
      child.remove();
      continue;
    }
    clean(child);
    const attrs = allowed[tag];
    if (!attrs) {
      // Unknown element: keep its content, drop the element.
      child.replaceWith(...child.childNodes);
      continue;
    }
    for (const attr of [...child.attributes]) {
      const name = attr.name.toLowerCase();
      const keep =
        attrs.includes(name) &&
        (name !== 'href' || safeUrl(attr.value, false)) &&
        (name !== 'src' || safeUrl(attr.value, true)) &&
        (tag !== 'input' || name !== 'type' || attr.value === 'checkbox');
      if (!keep) {
        child.removeAttribute(attr.name);
      }
    }
    if (tag === 'input') {
      child.setAttribute('disabled', '');
    }
  }
}

/** Allowlisted copy of GitHub-rendered HTML. */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) {
    return '';
  }
  clean(root);
  return root.innerHTML;
}
