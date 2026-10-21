/** Markdown renderer tests, with an emphasis on safety. */

import { describe, expect, it } from 'vitest';
import { countWords, readingMinutes, renderInline, renderMarkdown } from './markdown';

describe('block rendering', () => {
  it('renders paragraphs and treats a single newline as a line break', () => {
    const html = renderMarkdown('First line\nsecond line\n\nNew paragraph');
    expect(html).toContain('<p>First line<br>second line</p>');
    expect(html).toContain('<p>New paragraph</p>');
  });

  it('renders headings at six levels', () => {
    expect(renderMarkdown('### Deep thought')).toBe('<h3 class="md-h3">Deep thought</h3>');
    expect(renderMarkdown('# Title')).toContain('<h1');
    expect(renderMarkdown('###### Small')).toContain('<h6');
  });

  it('renders unordered, ordered, nested and task lists', () => {
    expect(renderMarkdown('- one\n- two')).toBe('<ul><li>one</li><li>two</li></ul>');
    expect(renderMarkdown('1. one\n2. two')).toBe('<ol><li>one</li><li>two</li></ol>');
    expect(renderMarkdown('- outer\n  - inner')).toContain('<ul><li>outer<ul><li>inner</li></ul></li></ul>');
    const tasks = renderMarkdown('- [x] done\n- [ ] todo');
    expect(tasks).toContain('data-checked="true"');
    expect(tasks).toContain('data-checked="false"');
    expect(tasks).toContain('aria-label="Completed"');
  });

  it('renders quotes, rules and fenced code without formatting inside', () => {
    expect(renderMarkdown('> quoted **text**')).toContain('<blockquote class="md-quote">');
    expect(renderMarkdown('---')).toBe('<hr class="md-rule">');
    const code = renderMarkdown('```ts\nconst a = **not bold**;\n```');
    expect(code).toContain('<pre data-language="ts"><code class="language-ts">');
    expect(code).toContain('const a = **not bold**;');
    expect(code).not.toContain('<strong>');
  });
});

describe('inline rendering', () => {
  it('renders emphasis, code, marks and strikethrough', () => {
    expect(renderInline('**bold** and *italic* and `code` and ~~gone~~ and ==mark==')).toBe(
      '<strong>bold</strong> and <em>italic</em> and <code class="md-code">code</code> and <del>gone</del> and <mark>mark</mark>'
    );
  });

  it('links only allowlisted protocols and marks external links', () => {
    const html = renderInline('[docs](https://example.test/guide)');
    expect(html).toContain('href="https://example.test/guide"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(renderInline('[mail](mailto:me@example.test)')).toContain('href="mailto:me@example.test"');
  });

  it('autolinks bare URLs', () => {
    expect(renderInline('see https://example.test/notes for details')).toContain('<a href="https://example.test/notes"');
  });
});

describe('safety', () => {
  it('escapes raw HTML instead of passing it through', () => {
    const html = renderMarkdown('<script>alert("xss")</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('rejects javascript: URLs in links', () => {
    const html = renderInline('[click](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('click');
  });

  it('does not autolink javascript: or data: URLs', () => {
    const html = renderMarkdown('javascript:alert(1) data:text/html,<script>alert(1)</script>');
    expect(html).not.toContain('<a href="javascript:');
    expect(html).not.toContain('<a href="data:');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes attribute-breaking characters', () => {
    expect(renderInline('a "quote" & <angle>')).toContain('&quot;');
    expect(renderInline('a "quote" & <angle>')).toContain('&amp;');
  });

  it('cannot break out of a code fence', () => {
    const html = renderMarkdown('```\n</code><script>alert(1)</script>\n```');
    expect(html).not.toContain('<script>');
  });
});

describe('document metrics', () => {
  it('counts words and reading time', () => {
    expect(countWords('one two three')).toBe(3);
    expect(countWords('')).toBe(0);
    expect(readingMinutes(new Array(401).join('word '))).toBe(2);
  });
});
