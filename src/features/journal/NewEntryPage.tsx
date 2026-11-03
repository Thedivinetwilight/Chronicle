/**
 * `/journal/new` — the full composer, reachable by URL.
 *
 * It is a route rather than a modal state so that "Add experience" links work
 * from anywhere (the map, an empty state, a future share of a link) and so the
 * browser's back button does the obvious thing. On close or save we navigate to
 * somewhere real instead of leaving a blank page behind.
 */

import { useNavigate } from 'react-router-dom';
import { EntryDialog } from './EntryDialog';

export function NewEntryPage() {
  const navigate = useNavigate();

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__title">
          <span className="eyebrow">The slow path</span>
          <h1>New experience</h1>
          <p className="text-sm text-muted measure">
            Everything here is optional except the words. Leave the date unknown if you are not sure — Chronicle
            records uncertainty rather than guessing.
          </p>
        </div>
      </header>

      <EntryDialog
        open
        entry={null}
        onClose={() => navigate('/journal')}
        onSaved={(entry) => navigate(`/journal/${entry.id}`, { replace: true })}
      />

      <div className="note">
        <span className="note__icon">
          <span aria-hidden="true">·</span>
        </span>
        <span className="text-sm text-muted">
          In a hurry? Close this and use the capture button — it saves a single thought in one step, and you can add
          the details here later.
        </span>
      </div>
    </div>
  );
}
