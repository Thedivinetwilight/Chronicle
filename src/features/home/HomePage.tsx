/**
 * Today — the calm landing view.
 *
 * Three jobs, in this order: write something down quickly, see what you
 * recorded recently, and get back into the parts of your archive you were
 * using. No metrics, no streaks, no "you're behind".
 *
 * Capture here is the fast path: type a thought, press Save, the write is
 * awaited before anything says it worked. If the write fails, the text stays
 * exactly where it was and the error says what happened. "Add details" opens the
 * full editor with the same text, for a slower, more organised path.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useChronicle } from '../../state/ChronicleContext';
import { useChapters, useEntries, usePaths, useTrips } from '../../state/hooks';
import { formatDateLabel, localDateIso, todayIso } from '../../domain/time';
import { Badge, Button } from '../../ui/primitives';
import { Icon } from '../../ui/Icon';
import { EmptyState, SkeletonList } from '../../ui/states';
import { RelativeTime } from '../../ui/format';
import { EntryDialog } from '../journal/EntryDialog';
import type { JournalEntry } from '../../domain/types';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Late night';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function HomePage() {
  const { store, timezone, toast } = useChronicle();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  const today = todayIso(timezone);
  const entries = useEntries({ limit: 60 });
  const chapters = useChapters({ statuses: ['open'] });
  const paths = usePaths({ states: ['active'] });
  const trips = useTrips();

  const save = async () => {
    if (busy) return; // repeat taps are ignored, never queued
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      await store.createEntry({
        title: '',
        body: text,
        occurred_precision: 'exact',
        occurred_source: 'user',
        // New experiences are private unless the user says otherwise.
        private: true,
        visibility: 'private'
      });
      setDraft('');
      toast('Saved to your archive.', { tone: 'success' });
    } catch (caught) {
      // Always actionable, never a generic "something went wrong", and the
      // draft is untouched so it can be retried or copied out.
      setError(
        caught instanceof Error
          ? `Your experience was not saved: ${caught.message} Your words are still here — try saving again.`
          : 'Your experience was not saved. Your words are still here — try saving again.'
      );
    } finally {
      setBusy(false);
    }
  };

  const live = (entries ?? []).filter((entry) => !entry.deleted_at);
  const todayEntries = live.filter((entry) => localDateIso(entry.occurred_at, timezone) === today);
  const recent = live.slice(0, 8);
  const emptyArchive = entries !== undefined && live.length === 0;

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__title page__title--display">
          <span className="eyebrow">{formatDateLabel(today)}</span>
          <h1>{greeting()}</h1>
        </div>
        <span className="text-xs text-faint">
          <Icon name="lock" size={12} className="icon-inline" /> Private to you
        </span>
      </header>

      <section className="composer" aria-label="Quick capture">
        <label className="sr-only" htmlFor="home-capture">
          Write something that happened
        </label>
        <textarea
          id="home-capture"
          className="composer__input"
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void save();
          }}
          aria-describedby={error ? 'capture-error' : 'capture-hint'}
          placeholder="What happened? A sentence is enough."
        />
        {error ? (
          <p className="note note--danger" id="capture-error" role="alert">
            <Icon name="alert" size={16} className="note__icon" />
            <span>
              {error}{' '}
              <button type="button" className="section-head__link" onClick={() => setReviewOpen(true)}>
                Keep it and add details
              </button>
            </span>
          </p>
        ) : null}
        <div className="composer__bar">
          <span className="composer__hint" id="capture-hint">
            Saves privately, instantly. Add a date, chapter or path later if you want.
          </span>
          <div className="chip-row">
            <Button
              variant="quiet"
              disabled={!draft.trim() || busy}
              onClick={() => setReviewOpen(true)}
              title="Open the full editor with this text"
            >
              Add details
            </Button>
            <Button
              variant="primary"
              onClick={() => void save()}
              busy={busy}
              disabled={!draft.trim()}
              title="Save (Ctrl or ⌘ + Enter)"
            >
              Save
            </Button>
          </div>
        </div>
      </section>

      {entries === undefined ? <SkeletonList rows={3} /> : null}

      {emptyArchive ? (
        <EmptyState icon="book" title="Your archive is empty — that is a fine place to start">
          Write one thing above: something that happened, something you noticed, something you want to remember. It
          stays on this device unless you export it.
          <div style={{ marginTop: 'var(--space-3)', display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <Link to="/chapters" className="btn">
              <Icon name="map" size={16} /> Create a chapter
            </Link>
            <Link to="/roadmap" className="btn btn--quiet">
              What else is planned
            </Link>
          </div>
        </EmptyState>
      ) : null}

      {todayEntries.length > 0 ? (
        <section aria-label="Today so far">
          <div className="section-head">
            <h2 className="section-head__title">Today, in your words</h2>
            <Link to="/journal" className="section-head__link">
              Journal
            </Link>
          </div>
          <div className="card">
            <div className="card__body form-stack form-stack--tight">
              {todayEntries.map((entry) => (
                <div key={entry.id}>
                  <Link to={`/journal/${entry.id}`} className="entrycard__title">
                    {entry.title || firstLine(entry.body) || 'Untitled'}
                  </Link>
                  <div className="entrycard__meta">
                    <RelativeTime at={entry.occurred_at} timezone={timezone} />
                    {entry.links?.chapter_ids.length ? ' · in a chapter' : ''}
                    {entry.private ? ' · private' : ''}
                  </div>
                </div>
              ))}
              <p className="text-xs text-faint">
                Assembled only from what you wrote today. Chronicle has not summarised, interpreted or added anything.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {live.length > 0 ? (
        <section aria-label="Recent experiences">
          <div className="section-head">
            <h2 className="section-head__title">Recently</h2>
            <Link to="/journal" className="section-head__link">
              All experiences
            </Link>
          </div>
          <div className="card list">
            {recent.map((entry) => (
              <RecentRow key={entry.id} entry={entry} />
            ))}
          </div>
        </section>
      ) : null}

      {(chapters ?? []).length > 0 || (paths ?? []).length > 0 ? (
        <div style={{ display: 'grid', gap: 'var(--space-5)', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {(chapters ?? []).length > 0 ? (
            <section aria-label="Your chapters">
              <div className="section-head">
                <h2 className="section-head__title">Chapters</h2>
                <Link to="/chapters" className="section-head__link">
                  All
                </Link>
              </div>
              <div className="chip-row">
                {(chapters ?? []).slice(0, 6).map((chapter) => (
                  <Link key={chapter.id} to={`/chapters/${chapter.id}`} className="tagchip">
                    {chapter.name}
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
          {(paths ?? []).length > 0 ? (
            <section aria-label="Your paths">
              <div className="section-head">
                <h2 className="section-head__title">Paths in motion</h2>
                <Link to="/paths" className="section-head__link">
                  All
                </Link>
              </div>
              <div className="chip-row">
                {(paths ?? []).slice(0, 6).map((path) => (
                  <Link key={path.id} to={`/paths/${path.id}`} className="tagchip">
                    {path.title}
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {(trips ?? []).length > 0 ? (
        <section aria-label="Recent trips">
          <div className="section-head">
            <h2 className="section-head__title">Trips</h2>
            <Link to="/trips" className="section-head__link">
              All
            </Link>
          </div>
          <div className="chip-row">
            {(trips ?? []).slice(0, 6).map((trip) => (
              <Link key={trip.id} to={`/trips/${trip.id}`} className="tagchip">
                <Icon name="plane" size={12} className="icon-inline" /> {trip.name}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <div className="note">
        <Icon name="compass" size={16} className="note__icon" />
        <span>
          <Link to="/map">Open your life map</Link> to see how these experiences connect — chapters, places, people and
          the paths you were following.
        </span>
      </div>

      <EntryDialog
        open={reviewOpen}
        entry={null}
        /* "Add details" carries the draft into the full editor so that a slower,
           more organised path never costs the user what they already typed. */
        initialBody={draft}
        onClose={() => setReviewOpen(false)}
        onSaved={() => {
          setDraft('');
          setError(null);
        }}
      />
    </div>
  );
}

function RecentRow({ entry }: { entry: JournalEntry }) {
  const { timezone } = useChronicle();
  return (
    <Link to={`/journal/${entry.id}`} className="list__item entrycard">
      <span className="entrycard__title">{entry.title || firstLine(entry.body) || 'Untitled experience'}</span>
      <span className="entrycard__meta">
        <RelativeTime at={entry.occurred_at} timezone={timezone} />
        {entry.occurred_precision !== 'exact' ? ' · approximate' : ''}
        {entry.private ? (
          <Badge>
            <Icon name="lock" size={10} className="icon-inline" /> private
          </Badge>
        ) : null}
      </span>
    </Link>
  );
}

function firstLine(body: string): string {
  return (
    body
      .split('\n')
      .find((line) => line.trim().length > 0)
      ?.replace(/[#>*_`-]/g, '')
      .trim()
      .slice(0, 80) ?? ''
  );
}
