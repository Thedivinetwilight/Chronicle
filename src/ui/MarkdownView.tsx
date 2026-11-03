/**
 * Renders stored Markdown through the domain renderer — the only Markdown
 * renderer in the app, escape-first with an allowlisted URL scheme.
 */

import { useMemo } from 'react';
import { renderMarkdown } from '../domain/markdown';

export function MarkdownView({ source, className }: { source: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(source, { rootClass: 'markdown' }), [source]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
