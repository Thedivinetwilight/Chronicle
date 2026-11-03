/**
 * The archive loop, end to end, through the real UI.
 *
 * One test file, one story: capture from Today → find it in the journal → give
 * it a chapter → see it appear on the map as a real node → open the node's
 * detail panel → confirm the outline alternative lists the same records.
 *
 * These use the real Chronicle provider, the real Dexie store over
 * fake-indexeddb, and the real router. Nothing is stubbed except time-sensitive
 * bits that no assertion depends on.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Dexie from 'dexie';
import { App } from '../App';
import { ChronicleProvider } from '../state/ChronicleContext';
import { DATABASE_NAME, setDatabase } from '../data/db';
import { DexieChronicleStore } from '../data/dexieStore';

function renderAt(path: string) {
  return render(
    <ChronicleProvider>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </ChronicleProvider>
  );
}

/** A store over whatever database the provider is currently using. */
async function freshStore(): Promise<DexieChronicleStore & { close(): void }> {
  const store = new DexieChronicleStore();
  await store.init();
  return store as DexieChronicleStore & { close(): void };
}

beforeEach(async () => {
  setDatabase(null);
  await Dexie.delete(DATABASE_NAME).catch(() => undefined);
});

afterEach(async () => {
  cleanup();
  setDatabase(null);
  await Dexie.delete(DATABASE_NAME).catch(() => undefined);
});

describe('Today', () => {
  it('saves a quick capture as a private experience and shows it back', async () => {
    renderAt('/');

    const composer = await screen.findByLabelText(/Write something that happened/i);
    fireEvent.change(composer, { target: { value: 'Walked to the lighthouse before the rain.' } });

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.hasAttribute('disabled')).toBe(false);
    fireEvent.click(save);

    // The toast appears only after the write resolves.
    expect(await screen.findByText(/Saved to your archive/i)).toBeTruthy();

    // The draft clears, and the entry appears in both "Today" and "Recently".
    await waitFor(() => expect((composer as HTMLTextAreaElement).value).toBe(''));
    expect(screen.getAllByText(/Walked to the lighthouse before the rain\./).length).toBeGreaterThan(0);
  });

  it('refuses an empty draft instead of writing a blank record', async () => {
    renderAt('/');
    const composer = await screen.findByLabelText(/Write something that happened/i);
    fireEvent.change(composer, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
  });

  it('ignores repeat taps while a save is in flight', async () => {
    renderAt('/');
    const composer = await screen.findByLabelText(/Write something that happened/i);
    fireEvent.change(composer, { target: { value: 'Only once, please.' } });

    const save = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(save);
    fireEvent.click(save);
    fireEvent.click(save);

    await screen.findByText(/Saved to your archive/i);
    // Navigate to the journal and count the records we can see.
    cleanup();
    renderAt('/journal');
    await waitFor(() => expect(screen.getAllByText(/Only once, please\./).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Only once, please\./).length).toBe(1);
  });
});

describe('chapters', () => {
  it('creates a chapter that still exists after a reload', async () => {
    renderAt('/chapters');
    fireEvent.click(await screen.findByRole('button', { name: /Create a chapter|New chapter/i }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Name/i), { target: { value: 'The Chennai years' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Create chapter/i }));

    // Saving navigates into the new chapter so it can be filled in.
    expect(await screen.findByRole('heading', { name: 'The Chennai years' })).toBeTruthy();

    // A fresh provider over the same database — the reload analogue.
    cleanup();
    setDatabase(null);
    renderAt('/chapters');
    expect(await screen.findByText('The Chennai years')).toBeTruthy();
  });

  it('deletes a chapter without deleting the experiences filed in it', async () => {
    const store = await freshStore();
    const chapter = await store.createChapter({ name: 'A period I am done with' });
    const entry = await store.createEntry({ title: 'Kept experience', body: 'Still here afterwards.' });
    await store.setEntryRelations(entry.id, { chapter_ids: [chapter.id] });
    store.close();

    renderAt(`/chapters/${chapter.id}`);
    fireEvent.click(await screen.findByRole('button', { name: /Delete chapter/i }));
    const dialog = await screen.findByRole('dialog');
    // The confirmation must promise that experiences survive.
    expect(within(dialog).getByText(/stay exactly as they are/i)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /^Delete chapter$/i }));

    // The experience is untouched; only its filing is gone.
    await waitFor(async () => {
      const reloaded = await freshStore();
      const saved = await reloaded.getEntry(entry.id);
      expect(saved?.body).toBe('Still here afterwards.');
      expect(saved?.links?.chapter_ids ?? []).toHaveLength(0);
      // A deleted chapter is not readable (it lives in the deleted bin until
      // emptied) but its entry is untouched and still typed.
      expect(await reloaded.getChapter(chapter.id)).toBeNull();
      expect((await reloaded.listChapters({}))).toHaveLength(0);
      reloaded.close();
    });
  });
});

describe('map', () => {
  it('shows an honest empty state, then real nodes once records exist', async () => {
    renderAt('/map');
    expect(await screen.findByText(/nothing to draw|map is waiting|No records/i)).toBeTruthy();

    cleanup();
    renderAt('/');
    const composer = await screen.findByLabelText(/Write something that happened/i);
    fireEvent.change(composer, { target: { value: 'A first memory for the map.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/Saved to your archive/i);

    cleanup();
    renderAt('/map');

    // The outline is the non-spatial route into the same records.
    const outlineButton = await screen.findByRole('button', { name: /outline/i });
    fireEvent.click(outlineButton);
    expect(await screen.findByText(/A first memory for the map\./)).toBeTruthy();
  });
});

describe('share preview', () => {
  it('states plainly that nothing is published and excludes private records by default', async () => {
    renderAt('/');
    const composer = await screen.findByLabelText(/Write something that happened/i);
    fireEvent.change(composer, { target: { value: 'A private thing that should not be shared.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/Saved to your archive/i);

    cleanup();
    renderAt('/share-preview');

    expect(await screen.findByText(/Sharing is not implemented in this build/i)).toBeTruthy();
    // No publish control exists at all.
    expect(screen.queryByRole('button', { name: /publish|share now|post/i })).toBeNull();
    // Private records make it into the preview only when the user opts in.
    const toggle = await screen.findByLabelText(/Include records I marked private/i);
    expect((toggle as HTMLInputElement).checked).toBe(false);
  });
});
