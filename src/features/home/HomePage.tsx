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
  // "Recently" excludes what is already shown in the Today block, so the same
  // memory is never presented twice on one screen.
  const recent = live.filter((entry) => !todayEntries.includes(entry)).slice(0, 6);
  const emptyArchive = entries !== undefined && live.length === 0;
  // Recency is the point of this list; a privacy badge on every row is noise.
  const showPrivacy = recent.some((entry) => !entry.private);

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__title page__title--display">
          <span className="eyebrow">{formatDateLabel(today)}</span>
          <h1>{greeting()}</h1>
        </div>
        <span className="badge">
          <Icon name="lock" size={11} className="icon-inline" /> Private to you
        </span>
      </header>

      {/* The one thing this page wants you to do. Everything else is below. */}
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
          placeholder="What happened today?"
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
          <div style={{ marginTop: 'var(--space-3)', display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', justifyContent: 'center' }}>
            <Link to="/chapters" className="btn">
              <Icon name="layers" size={15} /> Create a chapter
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
              Journal <Icon name="chevron-left" size={12} style={{ transform: 'rotate(180deg)' }} />
            </Link>
          </div>
          <div className="card">
            <div className="card__body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {todayEntries.map((entry, index) => (
                <div key={entry.id} style={{ display: 'flex', gap: 'var(--space-3)' }}>
                  {/* A quiet timeline rail: today's notes read as a sequence. */}
                  <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        marginTop: 7,
                        borderRadius: '999px',
                        background: index === 0 ? 'var(--color-accent)' : 'var(--color-border-strong)',
                        flex: 'none'
                      }}
                    />
                    {index < todayEntries.length - 1 ? (
                      <span style={{ width: 1, flex: 1, background: 'var(--color-border)' }} />
                    ) : null}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <Link to={`/journal/${entry.id}`} className="entrycard__title">
                      {entry.title || firstLine(entry.body) || 'Untitled'}
                    </Link>
                    <div className="entrycard__meta">
                      <RelativeTime at={entry.occurred_at} timezone={timezone} />
                      {entry.links?.chapter_ids.length ? ' · in a chapter' : ''}
                    </div>
                  </div>
                </div>
              ))}
              <p className="text-xs text-faint" style={{ paddingTop: 'var(--space-2)', borderTop: '1px solid var(--color-border)' }}>
                Assembled only from what you wrote today. Chronicle has not summarised, interpreted or added anything.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {recent.length > 0 ? (
        <section aria-label="Recent experiences">
          <div className="section-head">
            <h2 className="section-head__title">Recently</h2>
            <Link to="/journal" className="section-head__link">
              All experiences <Icon name="chevron-left" size={12} style={{ transform: 'rotate(180deg)' }} />
            </Link>
          </div>
          <div className="card list">
            {recent.map((entry) => (
              <RecentRow key={entry.id} entry={entry} showPrivacy={showPrivacy} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Secondary material, grouped and visually quieter than the archive. */}
      {(chapters ?? []).length > 0 || (paths ?? []).length > 0 || (trips ?? []).length > 0 ? (
        <div
          style={{
            display: 'grid',
            gap: 'var(--space-4)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 15rem), 1fr))'
          }}
        >
          {(chapters ?? []).length > 0 ? (
            <section aria-label="Your chapters" className="card">
              <div className="card__header">
                <h2 className="section-head__title" style={{ margin: 0 }}>
                  Chapters
                </h2>
                <Link to="/chapters" className="section-head__link">
                  All
                </Link>
              </div>
              <div className="card__body" style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: 'var(--space-2)' }}>
                {(chapters ?? []).slice(0, 4).map((chapter) => (
                  <Link
                    key={chapter.id}
                    to={`/chapters/${chapter.id}`}
                    className="shell__sidebar-item"
                    style={{ minHeight: 36 }}
                  >
                    <span
                      className={`chapter-card__bar accent-${chapter.accent}`}
                      style={{ width: 3, minHeight: 16, height: 16 }}
                      aria-hidden="true"
                    />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {chapter.name}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {(paths ?? []).length > 0 ? (
            <section aria-label="Your paths" className="card">
              <div className="card__header">
                <h2 className="section-head__title" style={{ margin: 0 }}>
                  Paths in motion
                </h2>
                <Link to="/paths" className="section-head__link">
                  All
                </Link>
              </div>
              <div className="card__body" style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: 'var(--space-2)' }}>
                {(paths ?? []).slice(0, 4).map((path) => (
                  <Link key={path.id} to={`/paths/${path.id}`} className="shell__sidebar-item" style={{ minHeight: 36 }}>
                    <Icon name="route" size={14} style={{ color: 'var(--map-ink-path)', flex: 'none' }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {path.title}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {(trips ?? []).length > 0 ? (
            <section aria-label="Recent trips" className="card">
              <div className="card__header">
                <h2 className="section-head__title" style={{ margin: 0 }}>
                  Trips
                </h2>
                <Link to="/trips" className="section-head__link">
                  All
                </Link>
              </div>
              <div className="card__body" style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: 'var(--space-2)' }}>
                {(trips ?? []).slice(0, 4).map((trip) => (
                  <Link key={trip.id} to={`/trips/${trip.id}`} className="shell__sidebar-item" style={{ minHeight: 36 }}>
                    <Icon name="plane" size={14} style={{ color: 'var(--map-ink-trip)', flex: 'none' }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trip.name}</span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {/* The bridge to the signature view. */}
      <Link
        to="/map"
        className="card"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-4)',
          padding: 'var(--space-4)',
          textDecoration: 'none',
          color: 'inherit',
          background: 'var(--color-surface)'
        }}
      >
        <span className="state__halo" aria-hidden="true" style={{ width: 40, height: 40 }}>
          <Icon name="map" size={19} />
        </span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span className="entrycard__title" style={{ display: 'block' }}>
            Open your life map
          </span>
          <span className="text-xs text-muted">
            See how these experiences connect — chapters, places, people and the paths you were following.
          </span>
        </span>
        <Icon name="chevron-left" size={18} style={{ transform: 'rotate(180deg)', color: 'var(--color-text-faint)', flex: 'none' }} />
      </Link>

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

function RecentRow({ entry, showPrivacy }: { entry: JournalEntry; showPrivacy: boolean }) {
  const { timezone } = useChronicle();
  const preview = firstLine(entry.body);
  return (
    <Link to={`/journal/${entry.id}`} className="list__item entrycard">
      <span className="entrycard__title">{entry.title || preview || 'Untitled experience'}</span>
      <span className="entrycard__meta">
        <RelativeTime at={entry.occurred_at} timezone={timezone} />
        {entry.occurred_precision !== 'exact' ? ' · approximate' : ''}
        {entry.private && showPrivacy ? (
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
