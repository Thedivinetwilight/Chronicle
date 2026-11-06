/**
 * Capture-save regression suite (Android Chrome hang, fixed in this branch).
 *
 * These tests exercise the real pipeline the product uses — UI → analyzer →
 * provider selection → Dexie transaction → IndexedDB — against
 * fake-indexeddb, and assert the invariants from the bug report:
 *
 *  - a simple entry saves reliably and the spinner always stops;
 *  - failures are visible and actionable, and never leave the dialog
 *    permanently busy;
 *  - the user's text survives a failed save;
 *  - nothing is reported as saved before IndexedDB confirms the write;
 *  - the default local-only path performs zero network I/O, and an
 *    unreachable AI provider cannot break basic capture;
 *  - repeat taps never duplicate a capture;
 *  - the entry is still there after reopening the Journal and after a
 *    simulated page reload (fresh store instance over the same database).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../../App';
import { ChronicleProvider } from '../../state/ChronicleContext';
import { DATABASE_NAME, getDatabase, setDatabase } from '../../data/db';
import { DexieChronicleStore } from '../../data/dexieStore';
import { setAiSessionKey } from '../../state/aiSession';
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

/** A fresh store over the same database — the closest jsdom analogue of a page reload. */
async function reloadedStore(): Promise<DexieChronicleStore> {
  const store = new DexieChronicleStore();
  expect(await store.init()).toBe(true);
  return store;
}

async function openCaptureAndType(text: string): Promise<HTMLTextAreaElement> {
  fireEvent.click(screen.getByLabelText('Capture something that happened'));
  const composer = (await screen.findByLabelText('Your message')) as HTMLTextAreaElement;
  fireEvent.change(composer, { target: { value: text } });
  return composer;
}

beforeEach(async () => {
  setDatabase(null);
  await Dexie.delete(DATABASE_NAME).catch(() => undefined);
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  setAiSessionKey(null);
  const db = getDatabase();
  try {
    db.close();
  } catch {
    /* already closed */
  }
  setDatabase(null);
  await Dexie.delete(DATABASE_NAME).catch(() => undefined);
});

describe('capture save pipeline', () => {
  it('saves "Testing Chronicle" in quick mode, stops the spinner, and survives a reload', async () => {
    renderAt('/');
    await screen.findByLabelText(/Write something that happened/i);
    await openCaptureAndType('Testing Chronicle');

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));

    // The saved panel only appears after IndexedDB confirms the write.
    expect(await screen.findByRole('heading', { name: 'Saved' })).toBeTruthy();
    // The spinner is gone and the dialog offers a way out, not a wait.
    const done = screen.getByRole('button', { name: 'Done' });
    expect(done.hasAttribute('disabled')).toBe(false);

    // Persistence check through a brand-new store instance (simulated reload).
    const store = await reloadedStore();
    const entries = await store.listEntries();
    expect(entries.map((entry) => entry.title)).toContain('Testing Chronicle');

    // And through the UI: reopening the Journal lists the entry (title and
    // preview both carry the text, so match on "at least one").
    cleanup();
    renderAt('/journal');
    expect((await screen.findAllByText('Testing Chronicle')).length).toBeGreaterThan(0);
  });

  it('review mode writes nothing until the user confirms', async () => {
    renderAt('/');
    await screen.findByLabelText(/Write something that happened/i);
    await openCaptureAndType('Reviewed the antenna pattern and logged two anomalies.');

    // Switch to Review mode (the segmented control is the only "Review"
    // button while the footer still reads "Save") …
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    // … after which the footer primary also reads "Review"; click the footer
    // one (it comes last in the dialog DOM).
    const reviewButtons = screen.getAllByRole('button', { name: 'Review' });
    fireEvent.click(reviewButtons[reviewButtons.length - 1]!);

    expect(await screen.findByRole('heading', { name: 'Review before saving' })).toBeTruthy();

    // Nothing may be persisted yet.
    const before = await reloadedStore();
    expect(await before.listEntries()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Save to archive' }));
    expect(await screen.findByRole('heading', { name: 'Saved' })).toBeTruthy();

    const after = await reloadedStore();
    const entries = await after.listEntries();
    expect(entries.length).toBe(1);
  });

  it('surfaces a storage failure as a visible error, keeps the text, and clears the busy state', async () => {
    renderAt('/');
    await screen.findByLabelText(/Write something that happened/i);
    const composer = await openCaptureAndType('Something happened that must not be lost.');

    // Close storage behind the dialog's back so the next save attempt fails.
    getDatabase().close();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));

    // The failure reaches the visible error handler …
    await waitFor(() => {
      expect(screen.getByText(/Your text is still here/i)).toBeTruthy();
    });
    // … the user's text is preserved verbatim …
    expect(composer.value).toBe('Something happened that must not be lost.');
    // … and the dialog is not left permanently busy: Save is clickable again.
    const save = within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    expect(save.querySelector('.spinner')).toBeNull();
  });

  it('performs no network I/O with AI disabled (the default)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderAt('/');
    await screen.findByLabelText(/Write something that happened/i);
    await openCaptureAndType('Testing Chronicle');

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { name: 'Saved' })).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();

    const store = await reloadedStore();
    expect((await store.listEntries()).map((entry) => entry.title)).toContain('Testing Chronicle');
  });

  it('never calls the network during capture, even when a remote provider is configured', async () => {
    /* V0.3 runs the on-device analyzer only. This test used to assert that a
       failed remote call was disclosed and fell back to local capture; the
       remote path is now unreachable from the app, and the Settings interface
       for it is gone. The contract that matters — capture is local, offline and
       silent on the network — is asserted directly, with a provider still
       configured in storage so a regression that re-enables it would fail here. */
    const seeder = new DexieChronicleStore();
    expect(await seeder.init()).toBe(true);
    await seeder.updateSettings({
      ai: {
        enabled: true,
        provider: 'http',
        endpoint: 'https://ai.invalid/v1/chat/completions',
        model: 'test-model',
        allow_private: true,
        disclosure_acknowledged_at: '2026-01-01T00:00:00.000Z'
      }
    });
    setAiSessionKey('test-session-key');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    renderAt('/');
    await screen.findByLabelText(/Write something that happened/i);
    await openCaptureAndType('Testing Chronicle');

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    const reviewButtons = screen.getAllByRole('button', { name: 'Review' });
    fireEvent.click(reviewButtons[reviewButtons.length - 1]!);

    expect(await screen.findByRole('heading', { name: 'Review before saving' })).toBeTruthy();
    // Nothing left the device, and no failure was invented to explain it.
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save to archive' }));
    expect(await screen.findByRole('heading', { name: 'Saved' })).toBeTruthy();

    const store = await reloadedStore();
    expect((await store.listEntries()).map((entry) => entry.title)).toContain('Testing Chronicle');
    fetchSpy.mockRestore();
  });

  it('saves exactly one record when Save is tapped twice in quick succession', async () => {
    renderAt('/');
    await screen.findByLabelText(/Write something that happened/i);
    await openCaptureAndType('Testing Chronicle');

    const save = within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' });
    fireEvent.click(save);
    fireEvent.click(save); // second tap lands while the first save is in flight

    expect(await screen.findByRole('heading', { name: 'Saved' })).toBeTruthy();

    const store = await reloadedStore();
    const entries = await store.listEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.title).toBe('Testing Chronicle');
  });
});
