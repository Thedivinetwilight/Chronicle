/**
 * Chapters — the eras of a life, named by the user.
 *
 * A chapter organises memories; it never owns them. Deleting a chapter removes
 * the filing of its experiences, and says so before it happens.
 */

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useChronicle } from '../../state/ChronicleContext';
import { useChapter, useChapterEntries, useChapters } from '../../state/hooks';
import type { Chapter } from '../../domain/types';
import { formatDateLabel } from '../../domain/time';
import { WhenItHappened, precisionNote } from '../../ui/format';
import { Badge, Button, Field, IconButton, TextArea, TextInput } from '../../ui/primitives';
import { Dialog } from '../../ui/Dialog';
import { EmptyState, ErrorState, SkeletonList } from '../../ui/states';
import { Icon } from '../../ui/Icon';
import { Cover } from '../../ui/art/Cover';

const ACCENTS: { value: Chapter['accent']; label: string }[] = [
  { value: 'ink', label: 'Ink' },
  { value: 'moss', label: 'Moss' },
  { value: 'clay', label: 'Clay' },
  { value: 'plum', label: 'Plum' },
  { value: 'sand', label: 'Sand' }
];

function dateRange(chapter: Chapter): string {
  if (chapter.start_date && chapter.end_date) return `${formatDateLabel(chapter.start_date)} – ${formatDateLabel(chapter.end_date)}`;
  if (chapter.start_date) return `From ${formatDateLabel(chapter.start_date)}`;
  if (chapter.end_date) return `Until ${formatDateLabel(chapter.end_date)}`;
  return chapter.date_hint ?? 'No dates given';
}

export function ChaptersPage() {
  const navigate = useNavigate();
  const chapters = useChapters({ statuses: ['open'] });
  const archived = useChapters({ statuses: ['archived'] });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (chapters === undefined) return <SkeletonList rows={3} />;

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__title">
          <span className="eyebrow">Eras you name</span>
          <h1>Chapters</h1>
          <p className="text-sm text-muted measure">
            A chapter names a stretch of time. Experiences can belong to one, or to none.
          </p>
        </div>
        {/* One create action per page, in the header, on an empty page and a full
            one alike. The empty state used to repeat it, which put two buttons
            with the same purpose on screen — and made them indistinguishable to
            a screen reader. The header owns the action; the empty state says
            what the section is for. */}
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
          New chapter
        </Button>
      </header>

      {error ? (
        <p className="note note--danger" role="alert">
          <Icon name="alert" size={16} className="note__icon" /> {error}
        </p>
      ) : null}

      {chapters.length === 0 ? (
        <EmptyState
          mark="sprig"
          compact
          title="No chapters yet"
        >
          A chapter names a stretch of time.
        </EmptyState>
      ) : (
        /* A shelf, not a table. Each chapter gets a plate derived from its own
           name and id, so the index looks like a set of bound volumes and stays
           stable between visits. */
        <div className="covershelf">
          {chapters.map((chapter) => (
            <Link key={chapter.id} to={`/chapters/${chapter.id}`} className="covershelf__item rowlink">
              <span className="coverframe">
                <Cover kind="chapter" id={chapter.id} name={chapter.name} />
              </span>
              <span className="covershelf__name">{chapter.name}</span>
              <span className="covershelf__meta">{dateRange(chapter)}</span>
            </Link>
          ))}
        </div>
      )}

      {archived && archived.length > 0 ? (
        <section aria-label="Archived chapters">
          <div className="section-head">
            <h2 className="section-head__title">Archived</h2>
          </div>
          <div className="card list">
            {archived.map((chapter) => (
              <Link key={chapter.id} to={`/chapters/${chapter.id}`} className="list__item row-between">
                <span className="text-sm">{chapter.name}</span>
                <Badge>archived</Badge>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <ChapterDialog
        open={creating}
        chapter={null}
        onClose={() => setCreating(false)}
        onSaved={(chapter) => {
          setCreating(false);
          navigate(`/chapters/${chapter.id}`);
        }}
        onError={setError}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Detail
 * ------------------------------------------------------------------ */

export function ChapterPage() {
  const { chapterId } = useParams();
  const { store, toast, timezone } = useChronicle();
  const chapter = useChapter(chapterId);
  const entries = useChapterEntries(chapterId);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (chapter === undefined) return <SkeletonList rows={3} />;
  if (chapter === null) {
    return <ErrorState title="Chapter not found" message="It may have been deleted." />;
  }

  const remove = async () => {
    try {
      await store.deleteChapter(chapter.id);
      toast('Chapter deleted. Its experiences were kept.', { tone: 'success' });
      setConfirmDelete(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The chapter could not be deleted.');
      setConfirmDelete(false);
    }
  };

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__title">
          <span className={`eyebrow accent-${chapter.accent}`}>{dateRange(chapter)}</span>
          <h1>{chapter.name}</h1>
          <p className="text-sm text-muted">
            <Badge>{chapter.status}</Badge> <Badge>private</Badge>{' '}
            {chapter.date_precision === 'unknown' ? <Badge>dates not exact</Badge> : null}
          </p>
        </div>
        <div className="page__actions">
          <IconButton name="edit" label="Edit chapter" onClick={() => setEditing(true)} />
          <IconButton name="trash" label="Delete chapter" onClick={() => setConfirmDelete(true)} />
        </div>
      </header>

      {error ? (
        <p className="note note--danger" role="alert">
          <Icon name="alert" size={16} className="note__icon" /> {error}
        </p>
      ) : null}

      {chapter.description ? (
        <article className="card">
          <div className="card__body text-block">{chapter.description}</div>
        </article>
      ) : null}

      <section aria-label="Experiences in this chapter">
        <div className="section-head">
          <h2 className="section-head__title">
            Experiences · {entries?.length ?? 0}
          </h2>
          <Link to="/journal" className="section-head__link">
            All experiences
          </Link>
        </div>
        {entries && entries.length === 0 ? (
          <EmptyState mark="sprig" compact title="Nothing filed here yet">
            Open an experience and add it to this chapter.
          </EmptyState>
        ) : (
          <div className="card list">
            {(entries ?? []).map((entry) => (
              <Link key={entry.id} to={`/journal/${entry.id}`} className="list__item entrycard">
                <span className="entrycard__title">{entry.title || 'Untitled experience'}</span>
                <span className="entrycard__meta">
                  {/* Same rule as everywhere else: an unknown date prints as a
                      phrase, never next to a timestamp it contradicts. */}
                  <WhenItHappened
                    at={entry.occurred_at}
                    precision={entry.occurred_precision}
                    timezone={timezone}
                    unknownLabel="Date not recorded"
                  />
                  {precisionNote(entry.occurred_precision) ? ` · ${precisionNote(entry.occurred_precision)}` : ''}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <p className="text-xs text-faint">
        Times are shown in {timezone}. This chapter is private and is never published by this build.
      </p>

      <ChapterDialog
        open={editing}
        chapter={chapter}
        onClose={() => setEditing(false)}
        onSaved={() => setEditing(false)}
        onError={setError}
      />

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this chapter?"
        footer={
          <>
            <Button variant="quiet" onClick={() => setConfirmDelete(false)}>
              Keep chapter
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              Delete chapter
            </Button>
          </>
        }
      >
        <p className="text-sm">
          The chapter is moved to Deleted and can be restored. Its {entries?.length ?? 0} experience
          {(entries?.length ?? 0) === 1 ? '' : 's'} stay exactly as they are — they simply stop being filed here.
        </p>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Create / edit
 * ------------------------------------------------------------------ */

function ChapterDialog({
  open,
  chapter,
  onClose,
  onSaved,
  onError
}: {
  open: boolean;
  chapter: Chapter | null;
  onClose: () => void;
  onSaved: (chapter: Chapter) => void;
  onError: (message: string | null) => void;
}) {
  const { store } = useChronicle();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [hint, setHint] = useState('');
  const [accent, setAccent] = useState<Chapter['accent']>('ink');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Re-seed the form when it opens for a different record.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const key = open ? (chapter?.id ?? 'new') : null;
  if (open && seededFor !== key) {
    setSeededFor(key);
    setName(chapter?.name ?? '');
    setDescription(chapter?.description ?? '');
    setStartDate(chapter?.start_date ?? '');
    setEndDate(chapter?.end_date ?? '');
    setHint(chapter?.date_hint ?? '');
    setAccent(chapter?.accent ?? 'ink');
    setSaveError(null);
  }

  if (!open) return null;

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setSaveError(null);
    try {
      const precision = startDate || endDate ? (startDate && endDate ? 'week' : 'month') : hint ? 'year' : 'unknown';
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        start_date: startDate || null,
        end_date: endDate || null,
        date_precision: precision as Chapter['date_precision'],
        date_hint: hint.trim() || undefined,
        accent
      };
      const saved = chapter ? await store.updateChapter(chapter.id, payload) : await store.createChapter(payload);
      onError(null);
      onSaved(saved);
    } catch (caught) {
      // The form keeps every value on failure; nothing is cleared.
      setSaveError(caught instanceof Error ? caught.message : 'The chapter could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={chapter ? 'Edit chapter' : 'New chapter'}
      wide
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} disabled={!name.trim()} onClick={() => void save()}>
            {chapter ? 'Save chapter' : 'Create chapter'}
          </Button>
        </>
      }
    >
      <div className="form-stack">
        {saveError ? (
          <p className="note note--danger" role="alert">
            <Icon name="alert" size={16} className="note__icon" /> {saveError} Your text has been kept — try again.
          </p>
        ) : null}
        <Field label="Name" required hint="What would you call this period?">
          <TextInput value={name} onChange={setName} placeholder="First year of college" maxLength={120} />
        </Field>
        <Field label="Description" hint="Optional. What defined this time?">
          <TextArea value={description} onChange={setDescription} rows={3} />
        </Field>
        <div className="grid-fields">
          <Field label="Started" hint="Leave empty if you are not sure.">
            <TextInput type="date" value={startDate} onChange={setStartDate} />
          </Field>
          <Field label="Ended">
            <TextInput type="date" value={endDate} onChange={setEndDate} />
          </Field>
        </div>
        <Field label="Instead of dates" hint="A phrase is fine: “summer 2019”, “the years in Chennai”.">
          <TextInput value={hint} onChange={setHint} maxLength={80} />
        </Field>
        <Field label="Colour" hint="A visual cue on the map. Every colour is also labelled, so it is never the only signal.">
          <div className="chip-row" role="group" aria-label="Chapter colour">
            {ACCENTS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="tagchip"
                aria-pressed={accent === option.value}
                onClick={() => setAccent(option.value)}
              >
                <span
                  aria-hidden="true"
                  style={{
                    display: 'inline-block',
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    marginRight: 6,
                    background: `var(--map-fill-${option.value === 'ink' ? 'chapter' : option.value === 'moss' ? 'path' : option.value === 'clay' ? 'place' : option.value === 'plum' ? 'person' : 'collection'})`,
                    border: `1.5px solid var(--map-ink-${option.value === 'ink' ? 'chapter' : option.value === 'moss' ? 'path' : option.value === 'clay' ? 'place' : option.value === 'plum' ? 'person' : 'collection'})`
                  }}
                />
                {option.label}
              </button>
            ))}
          </div>
        </Field>
      </div>
    </Dialog>
  );
}
