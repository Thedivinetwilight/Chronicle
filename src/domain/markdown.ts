/**
 * A deliberately tiny, safe Markdown renderer.
 *
 * Why hand-rolled (see docs/DECISIONS/0011-markdown-renderer.md):
 * - Chronicle renders *personal* text. The safest possible renderer is one
 *   that escapes every character first and then applies a closed whitelist of
 *   constructs. Raw HTML in a document is never passed through.
 * - A general Markdown engine plus a sanitiser costs ~40 KB gzipped and still
 *   needs configuration to be safe. This module costs ~2 KB and supports the
 *   subset a journal actually uses.
 *
 * Supported: paragraphs (single newline = line break), `#`–`######` headings,
 * `-`/`*`/`+` and `1.` lists with nesting, `- [ ]` task items, `>` quotes,
 * fenced code blocks, `inline code`, **bold**, *italic*, ~~strike~~,
 * [links](https://…) with an http/https/mailto allow-list, bare URL autolinks
 * and `---` rules.
 */

const CODE_PLACEHOLDER = '\u0000CODE';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSafeUrl(raw: string): boolean {
  const url = raw.trim();
  if (/^(https?:|mailto:)/i.test(url)) return true;
  // Relative fragment/anchor links are harmless and useful in long documents.
  if (url.startsWith('#') || url.startsWith('/')) return true;
  return false;
}

interface ExtractedCode {
  html: string;
}

function extractCodeSpans(escaped: string, store: ExtractedCode[]): string {
  return escaped.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    store.push({ html: `<code class="md-code">${code}</code>` });
    return `${CODE_PLACEHOLDER}${store.length - 1}\u0000`;
  });
}

function restoreCodeSpans(html: string, store: ExtractedCode[]): string {
  return html.replace(/\u0000CODE(\d+)\u0000/g, (_m, index: string) => store[Number(index)]?.html ?? '');
}

/** Inline formatting. Input is already HTML-escaped. */
export function renderInline(source: string): string {
  const store: ExtractedCode[] = [];
  let text = extractCodeSpans(escapeHtml(source), store);

  // Explicit links: [label](url "optional title")
  text = text.replace(/\[([^\]\n]+)\]\(\s*([^\s)]+)(?:\s+&quot;([^&]*)&quot;)?\s*\)/g, (_m, label: string, url: string, title?: string) => {
    if (!isSafeUrl(url)) return label;
    const titleAttr = title ? ` title="${title}"` : '';
    const external = /^https?:/i.test(url) ? ' target="_blank" rel="noopener noreferrer nofollow"' : '';
    return `<a href="${url}"${titleAttr}${external}>${label}</a>`;
  });

  // Bare URLs (not already inside an href).
  text = text.replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+[^\s<).,;:!?])/g, (_m, prefix: string, url: string) => {
    if (prefix.includes('href=')) return `${prefix}${url}`;
    return `${prefix}<a href="${url}" target="_blank" rel="noopener noreferrer nofollow">${url}</a>`;
  });

  text = text
    .replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
    .replace(/==([^=\n]+)==/g, '<mark>$1</mark>');

  return restoreCodeSpans(text, store);
}

interface BlockOptions {
  /** Wrap output in a section element with a class (used by the reader view). */
  rootClass?: string;
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const HR_RE = /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE_RE = /^\s{0,3}>\s?(.*)$/;
const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+-]*)\s*$/;
const TASK_RE = /^\[([ xX])\]\s+(.*)$/;

function renderList(lines: string[], start: number): { html: string; next: number } {
  const first = LIST_RE.exec(lines[start] as string);
  if (!first) return { html: '', next: start };
  const baseIndent = (first[1] ?? '').length;
  const ordered = /\d/.test(first[2] ?? '');
  const tag = ordered ? 'ol' : 'ul';
  const items: string[] = [];
  let index = start;

  while (index < lines.length) {
    const line = lines[index] as string;
    if (!line.trim()) {
      // A blank line only ends the list if the next line is not a list item.
      const lookahead = lines[index + 1] ?? '';
      if (!LIST_RE.test(lookahead)) break;
      index += 1;
      continue;
    }
    const match = LIST_RE.exec(line);
    if (!match) break;
    const indent = (match[1] ?? '').length;
    if (indent < baseIndent) break;
    if (indent > baseIndent) {
      // Nested list: it belongs *inside* the previous <li>, not beside it.
      const nested = renderList(lines, index);
      if (items.length > 0) {
        const lastIndex = items.length - 1;
        const current = items[lastIndex] ?? '';
        items[lastIndex] = current.endsWith('</li>')
          ? `${current.slice(0, -'</li>'.length)}${nested.html}</li>`
          : current + nested.html;
      }
      index = nested.next;
      continue;
    }
    const itemOrdered = /\d/.test(match[2] ?? '');
    if (itemOrdered !== ordered) break;
    let content = match[3] ?? '';
    let taskClass = '';
    const task = TASK_RE.exec(content);
    if (task) {
      const done = task[1]?.toLowerCase() === 'x';
      content = task[2] ?? '';
      taskClass = ' class="md-task"';
      items.push(
        `<li${taskClass}><span class="md-task-mark" data-checked="${done ? 'true' : 'false'}" role="img" aria-label="${
          done ? 'Completed' : 'Not completed'
        }"></span>${renderInline(content)}</li>`
      );
    } else {
      items.push(`<li>${renderInline(content)}</li>`);
    }
    index += 1;
  }

  return { html: `<${tag}>${items.join('')}</${tag}>`, next: index };
}

function renderBlocks(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let paragraph: string[] = [];
  let index = 0;

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    const body = paragraph.join('\n');
    const heading = HEADING_RE.exec(body);
    if (paragraph.length === 1 && heading) {
      const level = (heading[1] ?? '#').length;
      out.push(`<h${level} class="md-h${level}">${renderInline(heading[2] ?? '')}</h${level}>`);
    } else {
      const html = paragraph.map((line) => renderInline(line)).join('<br>');
      out.push(`<p>${html}</p>`);
    }
    paragraph = [];
  };

  while (index < lines.length) {
    const line = lines[index] as string;

    if (!line.trim()) {
      flushParagraph();
      index += 1;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      flushParagraph();
      const marker = (fence[1] ?? '```').charAt(0);
      const language = fence[2] ?? '';
      const buffer: string[] = [];
      index += 1;
      while (index < lines.length) {
        const current = lines[index] as string;
        if (current.trimStart().startsWith(marker.repeat(3))) {
          index += 1;
          break;
        }
        buffer.push(current);
        index += 1;
      }
      const langAttr = language ? ` data-language="${escapeHtml(language)}"` : '';
      const langClass = language ? ` class="language-${escapeHtml(language)}"` : '';
      out.push(
        `<pre${langAttr}><code${langClass}>${escapeHtml(buffer.join('\n'))}</code></pre>`
      );
      continue;
    }

    if (HR_RE.test(line)) {
      flushParagraph();
      out.push('<hr class="md-rule">');
      index += 1;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushParagraph();
      const level = (heading[1] ?? '#').length;
      out.push(`<h${level} class="md-h${level}">${renderInline(heading[2] ?? '')}</h${level}>`);
      index += 1;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      flushParagraph();
      const buffer: string[] = [];
      while (index < lines.length && QUOTE_RE.test(lines[index] as string)) {
        buffer.push((QUOTE_RE.exec(lines[index] as string)?.[1] ?? '').trimEnd());
        index += 1;
      }
      out.push(`<blockquote class="md-quote">${renderBlocks(buffer.join('\n'))}</blockquote>`);
      continue;
    }

    if (LIST_RE.test(line)) {
      flushParagraph();
      const list = renderList(lines, index);
      if (list.html) out.push(list.html);
      index = list.next;
      continue;
    }

    paragraph.push(line);
    index += 1;
  }

  flushParagraph();
  return out.join('\n');
}

/**
 * Render a Markdown subset to trusted HTML. The output contains no
 * user-controlled raw HTML and no `javascript:` URLs.
 */
export function renderMarkdown(source: string, options: BlockOptions = {}): string {
  const html = renderBlocks(source ?? '');
  if (!html) return '';
  if (!options.rootClass) return html;
  return `<div class="${options.rootClass}">${html}</div>`;
}

/** Very small word counter used by the entry metadata line. */
export function countWords(source: string): number {
  const plain = source.trim();
  if (!plain) return 0;
  return plain.split(/\s+/).length;
}

/** Rough reading time in minutes (200 wpm), minimum 0. */
export function readingMinutes(source: string): number {
  return Math.max(0, Math.round(countWords(source) / 200));
}
