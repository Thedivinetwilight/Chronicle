/**
 * UI smoke tests (§20, §28): the shell renders, capture saves a real record
 * through the whole pipeline, and the saved record shows up in the journal and
 * in search. These run in jsdom against fake-indexeddb, so they exercise the
 * same store the browser uses.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';
import { ChronicleProvider } from './state/ChronicleContext';
import { DATABASE_NAME, getDatabase, setDatabase } from './data/db';
import Dexie from 'dexie';

function renderAt(path: string) {
  return render(
    <ChronicleProvider>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </ChronicleProvider>
  );
}

/**
 * Each test gets a pristine database: fake-indexeddb persists per name inside
 * a worker, so without this a capture from one test would leak into the next.
 */
beforeEach(async () => {
  setDatabase(null);
  await Dexie.delete(DATABASE_NAME).catch(() => undefined);
});

afterEach(async () => {
  cleanup();
  const db = getDatabase();
  try {
    db.close();
  } catch {
    /* already closed */
  }
  setDatabase(null);
  await Dexie.delete(DATABASE_NAME).catch(() => undefined);
});

describe('shell', () => {
  it('boots to an honest empty home', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'What happened?' })).toBeTruthy();
    expect(await screen.findByText(/Capture your first entry/i)).toBeTruthy();
    // The five destinations are reachable from the tab bar.
    for (const label of ['Home', 'Projects', 'Journal', 'Timeline', 'Search']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('shows the storage-blocked state instead of pretending to work', async () => {
    const original = globalThis.indexedDB;
    // @ts-expect-error simulating a browser without storage
    delete globalThis.indexedDB;
    setDatabase(null);
    renderAt('/');
    expect(await screen.findByText(/Chronicle needs local storage/i)).toBeTruthy();
    globalThis.indexedDB = original;
  });
});

describe('capture flow', () => {
  it('saves a plain sentence and reports it honestly', async () => {
    renderAt('/');
    await screen.findByRole('heading', { name: 'What happened?' });

    fireEvent.click(screen.getByLabelText('Capture something that happened'));
    const composer = await screen.findByLabelText('Your message');
    fireEvent.change(composer, {
      target: { value: 'Replaced the fan controller and logged the readings.' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    // Quick mode commits directly: the sheet confirms what was written.
    expect(await screen.findByRole('heading', { name: 'Saved' })).toBeTruthy();
    expect(screen.getByText(/Journal entry saved/)).toBeTruthy();
  });

  it('keeps the text when the writer is unavailable', async () => {
    renderAt('/');
    await screen.findByRole('heading', { name: 'What happened?' });
    fireEvent.click(screen.getByLabelText('Capture something that happened'));
    const composer = await screen.findByLabelText('Your message');
    fireEvent.change(composer, { target: { value: 'Something happened.' } });

    // Close storage behind the dialog's back, then try to save.
    getDatabase().close();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(screen.getByText(/Your text is still here/i)).toBeTruthy();
    });
    expect((composer as HTMLTextAreaElement).value).toBe('Something happened.');
  });
});

describe('journal and search', () => {
  it('lists a stored entry and finds it in search', async () => {
    // Seed through the store directly, then look at it through the UI.
    const { DexieChronicleStore } = await import('./data/dexieStore');
    const seeder = new DexieChronicleStore();
    expect(await seeder.init()).toBe(true);
    await seeder.createEntry({
      title: 'Retrieval ranking investigation',
      body: 'Ranking fails for ambiguous references.',
      tags: ['retrieval']
    });

    renderAt('/journal');
    expect(await screen.findByText('Retrieval ranking investigation')).toBeTruthy();

    cleanup();
    renderAt('/search');
    const box = await screen.findByPlaceholderText(/Search titles/);
    fireEvent.change(box, { target: { value: 'retrieval' } });
    // Search results mark the matched terms, so the title is split across
    // <mark>/<span> nodes — match on the link's accessible name instead.
    // Matched terms are wrapped in <mark>, so assert on the result link itself.
    await waitFor(() => {
      const links = [...document.querySelectorAll('main a[href^="/journal/"]')];
      expect(links.length).toBeGreaterThan(0);
    });
    expect(document.querySelector('main')?.textContent).toContain('Retrieval ranking investigation');
  });

  it('shows an empty journal state with a way out', async () => {
    renderAt('/journal');
    expect(await screen.findByText(/Your journal starts with one honest sentence/i)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Capture something/i }).length).toBeGreaterThan(0);
  });
});
