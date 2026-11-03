// Release notes (docs/releases/X.Y.Z.md, carried by the update feed) to HTML
// for the update window. Only what the notes use: paragraphs, "- " lists,
// **bold**, *italics*, `code`, [links](https://...) and backslash escapes.
// The text is escaped first, and the result still goes through the app's
// allowlist (Markdown.svelte), since the feed comes from the network.

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(text: string): string {
  // Escaped characters and code spans are set aside so the rules below leave them alone.
  const kept: string[] = [];
  const keep = (html: string) => `\u0000${kept.push(html) - 1}\u0000`;
  let s = text.replace(/\\([\\`*_[\]()#+\-.!])/g, (_, c: string) => keep(escapeHtml(c)));
  s = s.replace(/`([^`]+)`/g, (_, code: string) => keep(`<code>${escapeHtml(code)}</code>`));
  s = escapeHtml(s);
  s = s.replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, (_, label: string, url: string) => `<a href="${url}">${label}</a>`);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, n: string) => kept[Number(n)]);
}

export function notesToHtml(md: string): string {
  const out: string[] = [];
  let para: string[] = [];
  let list: string[] | null = null;
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${para.map(inline).join('<br>')}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      out.push(`<ul>${list.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`);
      list = null;
    }
  };
  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const item = /^\s*[-*]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (item) {
      flushPara();
      (list ??= []).push(item[1]);
    } else if (list && /^\s+\S/.test(raw)) {
      // A continuation line of the last item.
      list[list.length - 1] += ` ${line.trim()}`;
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return out.join('');
}
