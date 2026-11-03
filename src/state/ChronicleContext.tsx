/**
 * Application state: the storage connection, settings, theme, toasts and the
 * capture session.
 *
 * There is exactly one store instance and one source of truth per concern.
 * Everything below the UI talks to `ChronicleStore`; nothing here talks to
 * Dexie directly (§11).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { DexieChronicleStore } from '../data/dexieStore';
import { resolveTimeZone } from '../domain/time';
import type { AppSettings } from '../domain/types';
import type { LastCommit } from '../domain/capture/types';

export type StorageStatus = 'loading' | 'ready' | 'blocked';

export interface ToastMessage {
  id: number;
  text: string;
  tone: 'neutral' | 'success' | 'danger';
  action?: { label: string; run: () => void };
}

interface ChronicleContextValue {
  store: DexieChronicleStore;
  status: StorageStatus;
  storageError: string | null;
  retryStorage: () => void;

  settings: AppSettings | null;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  /** The timezone all presentation uses: the preference, resolved. */
  timezone: string;

  toasts: ToastMessage[];
  toast: (text: string, options?: { tone?: ToastMessage['tone']; action?: ToastMessage['action'] }) => void;
  dismissToast: (id: number) => void;

  lastCommit: LastCommit | null;
  setLastCommit: (commit: LastCommit | null) => Promise<void>;

  captureOpen: boolean;
  captureSeed: string;
  openCapture: (seed?: string) => void;
  closeCapture: () => void;
}

const ChronicleContext = createContext<ChronicleContextValue | null>(null);

const THEME_STORAGE_KEY = 'chronicle:theme';

/** Mirrors the pre-paint script in index.html so both read the same shape. */
function persistThemePreference(theme: AppSettings['theme']): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ value: theme }));
  } catch {
    /* private mode: the theme still applies for this session */
  }
}

function applyTheme(theme: AppSettings['theme'], reduceMotion: boolean): void {
  const prefersDark =
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = theme === 'dark' || (theme === 'system' && prefersDark);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.reduceMotion = reduceMotion ? 'true' : 'false';
  persistThemePreference(theme);
}

export function ChronicleProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<DexieChronicleStore | null>(null);
  if (!storeRef.current) storeRef.current = new DexieChronicleStore();
  const store = storeRef.current;

  const [status, setStatus] = useState<StorageStatus>('loading');
  const [storageError, setStorageError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [lastCommit, setLastCommitState] = useState<LastCommit | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureSeed, setCaptureSeed] = useState('');
  const toastId = useRef(0);

  const boot = useCallback(async () => {
    setStatus('loading');
    const opened = await store.init();
    if (!opened) {
      setStorageError(store.storageError ?? 'Local storage could not be opened.');
      setStatus('blocked');
      return;
    }
    const loaded = await store.getSettings();
    setSettings(loaded);
    const storedCommit = await store.getLastCommit();
    setLastCommitState(storedCommit);
    setStatus('ready');
  }, [store]);

  useEffect(() => {
    void boot();
  }, [boot]);

  /* -- theme ------------------------------------------------------------- */
  useEffect(() => {
    if (!settings) return;
    applyTheme(settings.theme, settings.reduce_motion);
    if (settings.theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => applyTheme('system', settings.reduce_motion);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [settings]);

  /* -- toasts ------------------------------------------------------------ */
  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback<ChronicleContextValue['toast']>(
    (text, options) => {
      toastId.current += 1;
      const id = toastId.current;
      setToasts((current) => [
        ...current.slice(-2),
        { id, text, tone: options?.tone ?? 'neutral', action: options?.action }
      ]);
      window.setTimeout(() => dismissToast(id), options?.action ? 8000 : 4200);
    },
    [dismissToast]
  );

  /* -- settings ---------------------------------------------------------- */
  const updateSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      const next = await store.updateSettings(patch);
      setSettings(next);
    },
    [store]
  );

  /* -- capture session ---------------------------------------------------- */
  const setLastCommit = useCallback(
    async (commit: LastCommit | null) => {
      setLastCommitState(commit);
      await store.setLastCommit(commit);
    },
    [store]
  );

  const openCapture = useCallback((seed = '') => {
    setCaptureSeed(seed);
    setCaptureOpen(true);
  }, []);

  const closeCapture = useCallback(() => setCaptureOpen(false), []);

  const value = useMemo<ChronicleContextValue>(
    () => ({
      store,
      status,
      storageError,
      retryStorage: () => void boot(),
      settings,
      updateSettings,
      timezone: resolveTimeZone(settings?.timezone ?? 'device'),
      toasts,
      toast,
      dismissToast,
      lastCommit,
      setLastCommit,
      captureOpen,
      captureSeed,
      openCapture,
      closeCapture
    }),
    [
      store,
      status,
      storageError,
      boot,
      settings,
      updateSettings,
      toasts,
      toast,
      dismissToast,
      lastCommit,
      setLastCommit,
      captureOpen,
      captureSeed,
      openCapture,
      closeCapture
    ]
  );

  return <ChronicleContext.Provider value={value}>{children}</ChronicleContext.Provider>;
}

export function useChronicle(): ChronicleContextValue {
  const context = useContext(ChronicleContext);
  if (!context) throw new Error('useChronicle must be used inside <ChronicleProvider>');
  return context;
}
