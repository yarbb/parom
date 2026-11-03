import { describe, expect, it } from 'vitest';
import { notesToHtml } from './notes';

describe('notesToHtml', () => {
  it('renders the parts release notes use', () => {
    const md = '**New**\n- **Preview**: click a folder\n- Add *\\*.ext* to `.gitignore`\n\nSee [the page](https://example.com/x).';
    expect(notesToHtml(md)).toBe(
      '<p><strong>New</strong></p>' +
        '<ul><li><strong>Preview</strong>: click a folder</li><li>Add <em>*.ext</em> to <code>.gitignore</code></li></ul>' +
        '<p>See <a href="https://example.com/x">the page</a>.</p>',
    );
  });

  it('escapes HTML and keeps only https links', () => {
    expect(notesToHtml('<img src=x onerror=alert(1)> [a](javascript:alert(1))')).toBe(
      '<p>&lt;img src=x onerror=alert(1)&gt; [a](javascript:alert(1))</p>',
    );
  });

  it('leaves lone stars and stars inside words alone', () => {
    expect(notesToHtml('a * b and file_name*x')).toBe('<p>a * b and file_name*x</p>');
  });
});
