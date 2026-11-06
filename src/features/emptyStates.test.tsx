/**
 * Empty states: one action per page, and one line per empty section.
 *
 * Two rules were learned the hard way in this stage and are cheap to hold:
 *
 *  1. A page must not offer the same create action twice. Chapters used to hide
 *     its header button when the list was empty *because* the empty state
 *     carried a copy — so two buttons with the same purpose appeared together,
 *     and `findByRole('button', {name: /New chapter/})` was ambiguous. Fixing it
 *     by removing the empty-state copy then left a page with no action at all,
 *     which is what this file now prevents.
 *  2. A section's first-use state is a row, not a 560px panel: on a new archive
 *     every section is empty, so the user meets that state six times.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { EmptyState } from '../ui/states';
import { MARK_NAMES, SECTION_MARKS } from '../ui/art/Mark';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

describe('empty state', () => {
  it('offers no action of its own — the page header owns it', () => {
    render(
      <MemoryRouter>
        <EmptyState mark="sprig" compact title="No chapters yet">
          A chapter names a stretch of time.
        </EmptyState>
      </MemoryRouter>
    );
    // The title and the note are both readable text, and the note is not glued
    // to the title without a separator.
    expect(screen.getByText('No chapters yet')).toBeTruthy();
    const note = screen.getByText(/A chapter names a stretch of time/);
    expect(note.textContent).toBe(' A chapter names a stretch of time.');
    // Exactly one button role would be a duplicate action; there are none.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps the full panel available for nested empty states', () => {
    render(<EmptyState title="Nothing filed here yet">Open an experience and add it.</EmptyState>);
    const state = document.querySelector('.state');
    expect(state?.className).toBe('state');
    expect(document.querySelector('.state--compact')).toBeNull();
  });
});

describe('empty-state marks', () => {
  /**
   * An empty state borrows a drawn mark so a section still looks like itself
   * when it is empty. That only holds if the mark still *means* the section:
   * putting the Life map's compass on Search is the same defect as two
   * destinations sharing one nav glyph (§6.3). Nothing at runtime enforces it,
   * so it is checked against the source and against the real mark set.
   */
  const walk = (dir: string): string[] => {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  };

  const borrowedMarks = (): { file: string; mark: string }[] => {
    return walk('src/features')
      .filter((file) => file.endsWith('.tsx') && !file.includes('.test.'))
      .flatMap((file) =>
        [...readFileSync(file, 'utf8').matchAll(/<EmptyState[^>]*?\bmark="([a-z-]+)"/gs)].map((m) => ({
          file,
          mark: m[1]!
        }))
      );
  };

  it('only uses marks that the set can actually draw', () => {
    const known = new Set<string>(MARK_NAMES);
    const unknown = borrowedMarks().filter((b) => !known.has(b.mark));
    expect(unknown).toEqual([]);
  });

  it('gives Search a mark no section owns', () => {
    const owned = new Set<string>(Object.values(SECTION_MARKS));
    const search = borrowedMarks().filter((b) => b.file.includes('/search/'));
    expect(search.length).toBeGreaterThan(0);
    expect(search.filter((b) => owned.has(b.mark))).toEqual([]);
  });
});
