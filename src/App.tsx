/**
 * Routes and the shell. The app is a handful of destinations, each of which
 * works offline against local storage.
 */

import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './features/layout/AppShell';
import { HomePage } from './features/home/HomePage';
import { ProjectsPage } from './features/projects/ProjectsPage';
import { ProjectDetailPage } from './features/projects/ProjectDetailPage';
import { JournalPage } from './features/journal/JournalPage';
import { EntryPage } from './features/journal/EntryPage';
import { TimelinePage } from './features/timeline/TimelinePage';
import { SearchPage } from './features/search/SearchPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { LoadingState } from './ui/states';
import { Button } from './ui/primitives';
import { Icon } from './ui/Icon';
import { useChronicle } from './state/ChronicleContext';

export function App() {
  const { status, storageError, retryStorage, toast } = useChronicle();

  /* Surface a service-worker update once, without stealing focus. */
  useEffect(() => {
    const onUpdate = () => {
      toast('A newer version of Chronicle is ready.', {
        action: {
          label: 'Reload',
          run: () => {
            window.location.reload();
          }
        }
      });
    };
    window.addEventListener('chronicle:sw-update', onUpdate);
    return () => window.removeEventListener('chronicle:sw-update', onUpdate);
  }, [toast]);

  if (status === 'loading') {
    return (
      <div id="boot" role="status">
        <span className="spinner" aria-hidden="true" />
        <span className="text-sm">Opening your archive…</span>
      </div>
    );
  }

  if (status === 'blocked') {
    return (
      <div className="state" role="alert" style={{ minHeight: '100dvh', justifyContent: 'center' }}>
        <Icon name="lock" size={30} className="state__icon" />
        <div className="state__title">Chronicle needs local storage</div>
        <p className="text-sm measure">
          {storageError ?? 'Your browser blocked IndexedDB.'} Nothing you write can be saved until
          storage is available. In private browsing windows, try a normal window; on Android, check
          the site settings for this page.
        </p>
        <Button onClick={retryStorage} icon="undo">
          Try again
        </Button>
      </div>
    );
  }

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
        <Route path="/journal" element={<JournalPage />} />
        <Route path="/journal/:entryId" element={<EntryPage />} />
        <Route path="/timeline" element={<TimelinePage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

export { LoadingState };
