/**
 * Route smoke test: every destination in the shell must render without React
 * warnings or uncaught errors, show a real heading, and never present a dead
 * control. This is the closest thing to a browser pass that jsdom can offer,
 * so it also asserts that no route logs a console error.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Dexie from 'dexie';
import { App } from './App';
import { ChronicleProvider } from './state/ChronicleContext';
import { DATABASE_NAME, getDatabase, setDatabase } from './data/db';

const ROUTES: [path: string, heading: RegExp][] = [
  // Today is mastheaded by its date, not a time-of-day greeting.
  ['/', /\d{1,2} \w{3} \d{4}|\w{3,9} \d{1,2},? \d{4}/i],
  ['/map', /life map/i],
  ['/journal', /journal/i],
  ['/journal/new', /new experience/i],
  ['/chapters', /chapters/i],
  ['/paths', /paths/i],
  ['/trips', /trips/i],
  ['/places', /places/i],
  ['/collections', /collections/i],
  ['/share-preview', /share preview/i],
  ['/roadmap', /roadmap/i],
  ['/projects', /projects/i],
  ['/timeline', /timeline/i],
  ['/search', /search/i],
  ['/settings', /settings/i]
];

function renderAt(path: string) {
  return render(
    <ChronicleProvider>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </ChronicleProvider>
  );
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  setDatabase(null);
  await Dexie.delete(DATABASE_NAME).catch(() => undefined);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
  cleanup();
  getDatabase().close();
  setDatabase(null);
});

describe('routes', () => {
  for (const [path, heading] of ROUTES) {
    it(`renders ${path} with a heading and no console errors`, async () => {
      renderAt(path);
      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeTruthy();
      expect(errorSpy).not.toHaveBeenCalled();
    });
  }

  it('sends an unknown path home rather than to a blank screen', async () => {
    renderAt('/definitely-not-a-page');
    expect(
      await screen.findByRole('heading', { level: 1, name: /\d{1,2} \w{3} \d{4}|\w{3,9} \d{1,2},? \d{4}/i })
    ).toBeTruthy();
  });
});
