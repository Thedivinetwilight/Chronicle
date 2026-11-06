/**
 * Paths — plans, hopes and ongoing interests.
 *
 * Wording matters here. A path that was paused or changed is not a failure and
 * is not described as one; Chronicle never moves a path to `completed` on its
 * own, and never infers progress from dates or entry text. The only thing that
 * changes a state is the user choosing it.
 */

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useChronicle } from '../../state/ChronicleContext';
import { usePath, usePathEntries, usePaths } from '../../state/hooks';
import type { Path } from '../../domain/types';
import { formatDateLabel } from '../../domain/time';
import { WhenItHappened } from '../../ui/format';
import { Button, Field, IconButton, TextArea, TextInput } from '../../ui/primitives';
import { Dialog } from '../../ui/Dialog';
import { EmptyState, ErrorState, SkeletonList } from '../../ui/states';
import { Icon } from '../../ui/Icon';
import { Cover } from '../../ui/art/Cover';

const STATE_LABEL: Record<Path['state'], string> = {
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  changed: 'Changed course'
};

/** Neutral, respectful copy for each state. No "unfinished", no "behind". */
const STATE_NOTE: Record<Path['state'], string> = {
  active: 'Something you are still moving with.',
  paused: 'Set aside for now. It can stay that way for as long as it needs to.',
  completed: 'You marked this done yourself.',
  changed: 'The plan moved somewhere else. That is part of the story, not a failure.'
};

const STATES: Path['state'][] = ['active', 'paused', 'completed', 'changed'];

export function PathsPage() {
  const paths = usePaths({});
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (paths === undefined) return <SkeletonList rows={3} />;

  const groups = STATES.map((state) => ({ state, items: (paths ?? []).filter((path) => path.state === state) })).filter(
    (group) => group.items.length > 0
  );

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__title">
          <span className="eyebrow">Directions, not scores</span>
          <h1>Paths</h1>
          <p className="text-sm text-muted measure">
            A direction you want to remember — a plan, a hope, an interest. Link experiences as it develops.
          </p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
          New path
        </Button>
      </header>

      {error ? (
        <p className="note note--danger" role="alert">
          <Icon name="alert" size={16} className="note__icon" /> {error}
        </p>
      ) : null}

      {paths.length === 0 ? (
        <EmptyState
          mark="route"
          compact
          title="No paths yet"
        >
          What you were reaching for, not only what happened.
        </EmptyState>
      ) : (
        groups.map((group) => (
          <section key={group.state} aria-label={`${STATE_LABEL[group.state]} paths`}>
            <div className="section-head">
              <h2 className="section-head__title">
                {STATE_LABEL[group.state]} · {group.items.length}
              </h2>
            </div>
            <div className="covershelf">
              {group.items.map((path) => (
                <Link key={path.id} to={`/paths/${path.id}`} className="covershelf__item rowlink">
                  <span className="coverframe">
                    <Cover kind="path" id={path.id} name={path.title} />
                  </span>
                  <span className="covershelf__name">{path.title}</span>
                  <span className="covershelf__meta">
                    {path.start_date ? `From ${formatDateLabel(path.start_date)}` : 'No start date'}
                    {path.desired_date ? ` · hoped for ${formatDateLabel(path.desired_date)}` : ''}
                  </span>
                  {path.description ? <span className="covershelf__desc">{path.description}</span> : null}
                </Link>
              ))}
            </div>
          </section>
        ))
      )}

      <PathDialog
        open={creating}
        path={null}
        onClose={() => setCreating(false)}
        onSaved={() => setCreating(false)}
        onError={setError}
      />
    </div>
  );
}

export function PathPage() {
  const { pathId } = useParams();
  const { store, toast, timezone } = useChronicle();
  const path = usePath(pathId);
  const entries = usePathEntries(pathId);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (path === undefined) return <SkeletonList rows={3} />;
  if (path === null) return <ErrorState title="Path not found" message="It may have been deleted." />;

  const setState = async (state: Path['state']) => {
    setError(null);
    try {
      await store.updatePath(path.id, { state });
      toast(`Path marked ${STATE_LABEL[state].toLowerCase()}.`, { tone: 'neutral' });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The path could not be updated.');
    }
  };

  const remove = async () => {
    try {
      await store.deletePath(path.id);
      toast('Path deleted. Its experiences were kept.', { tone: 'success' });
      setConfirmDelete(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The path could not be deleted.');
      setConfirmDelete(false);
    }
  };

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__title">
          <span className="eyebrow">
            {STATE_LABEL[path.state]} · {path.start_date ? `from ${formatDateLabel(path.start_date)}` : 'no start date'}
          </span>
          <h1>{path.title}</h1>
          <p className="text-xs text-muted">{STATE_NOTE[path.state]}</p>
        </div>
        <div className="page__actions">
          <IconButton name="edit" label="Edit path" onClick={() => setEditing(true)} />
          <IconButton name="trash" label="Delete path" onClick={() => setConfirmDelete(true)} />
        </div>
      </header>

      {error ? (
        <p className="note note--danger" role="alert">
          <Icon name="alert" size={16} className="note__icon" /> {error}
        </p>
      ) : null}

      {path.description ? (
        <article className="card">
          <div className="card__body text-block">{path.description}</div>
        </article>
      ) : null}

      <section aria-label="How this path is going">
        <div className="section-head">
          <h2 className="section-head__title">Where it stands</h2>
        </div>
        <div className="chip-row" role="group" aria-label="Path state">
          {STATES.map((state) => (
            <button
              key={state}
              type="button"
              className="tagchip"
              aria-pressed={path.state === state}
              onClick={() => void setState(state)}
            >
              {STATE_LABEL[state]}
            </button>
          ))}
        </div>
        {path.state_note ? <p className="text-sm text-muted">{path.state_note}</p> : null}
      </section>

      <section aria-label="Experiences on this path">
        <div className="section-head">
          <h2 className="section-head__title">Linked experiences · {entries?.length ?? 0}</h2>
          <Link to="/journal" className="section-head__link">
            All experiences
          </Link>
        </div>
        {entries && entries.length === 0 ? (
          <EmptyState mark="route" compact title="Nothing linked yet">
            Link an experience from its own page.
          </EmptyState>
        ) : (
          <div className="card list">
            {(entries ?? []).map((entry) => (
              <Link key={entry.id} to={`/journal/${entry.id}`} className="list__item entrycard">
                <span className="entrycard__title">{entry.title || 'Untitled experience'}</span>
                <span className="entrycard__meta">
                  <WhenItHappened at={entry.occurred_at} precision={entry.occurred_precision} timezone={timezone} unknownLabel="Date not recorded" />
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <PathDialog
        open={editing}
        path={path}
        onClose={() => setEditing(false)}
        onSaved={() => setEditing(false)}
        onError={setError}
      />

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this path?"
        footer={
          <>
            <Button variant="quiet" onClick={() => setConfirmDelete(false)}>
              Keep path
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              Delete path
            </Button>
          </>
        }
      >
        <p className="text-sm">
          The path moves to Deleted and can be restored. Its experiences stay exactly as they are — they simply stop
          being linked to it. Nothing you wrote is removed.
        </p>
      </Dialog>
    </div>
  );
}

function PathDialog({
  open,
  path,
  onClose,
  onSaved,
  onError
}: {
  open: boolean;
  path: Path | null;
  onClose: () => void;
  onSaved: (path: Path) => void;
  onError: (message: string | null) => void;
}) {
  const { store } = useChronicle();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [desiredDate, setDesiredDate] = useState('');
  const [state, setState] = useState<Path['state']>('active');
  const [stateNote, setStateNote] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [seededFor, setSeededFor] = useState<string | null>(null);
  const seedKey = open ? (path?.id ?? 'new') : null;
  if (open && seededFor !== seedKey) {
    setSeededFor(seedKey);
    setTitle(path?.title ?? '');
    setDescription(path?.description ?? '');
    setStartDate(path?.start_date ?? '');
    setDesiredDate(path?.desired_date ?? '');
    setState(path?.state ?? 'active');
    setStateNote(path?.state_note ?? '');
    setTags((path?.tags ?? []).join(', '));
    setSaveError(null);
  }

  if (!open) return null;

  const save = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setSaveError(null);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        start_date: startDate || null,
        desired_date: desiredDate || null,
        state,
        state_note: stateNote.trim() || undefined,
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean)
      };
      const saved = path ? await store.updatePath(path.id, payload) : await store.createPath(payload);
      onError(null);
      onSaved(saved);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : 'The path could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={path ? 'Edit path' : 'New path'}
      wide
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} disabled={!title.trim()} onClick={() => void save()}>
            {path ? 'Save path' : 'Create path'}
          </Button>
        </>
      }
    >
      <div className="form-stack">
        {saveError ? (
          <p className="note note--danger" role="alert">
            <Icon name="alert" size={16} className="note__icon" /> {saveError} Nothing was saved — your text is kept.
          </p>
        ) : null}
        <Field label="What is it?" required>
          <TextInput value={title} onChange={setTitle} placeholder="Learn guitar" maxLength={120} />
        </Field>
        <Field label="Description" hint="Optional. Why does it matter to you?">
          <TextArea value={description} onChange={setDescription} rows={3} />
        </Field>
        <div className="grid-fields">
          <Field label="Started" hint="Optional, and never assumed.">
            <TextInput type="date" value={startDate} onChange={setStartDate} />
          </Field>
          <Field label="Hoped for" hint="A date you are aiming at, not a deadline.">
            <TextInput type="date" value={desiredDate} onChange={setDesiredDate} />
          </Field>
        </div>
        <Field label="Where it stands" hint="You can change this at any time. None of these is a failure.">
          <div className="chip-row" role="group" aria-label="Path state">
            {STATES.map((option) => (
              <button
                key={option}
                type="button"
                className="tagchip"
                aria-pressed={state === option}
                onClick={() => setState(option)}
              >
                {STATE_LABEL[option]}
              </button>
            ))}
          </div>
        </Field>
        <Field label="A note about the state" hint="Optional. “Paused while I move cities.”">
          <TextInput value={stateNote} onChange={setStateNote} maxLength={160} />
        </Field>
        <Field label="Tags" hint="Comma separated.">
          <TextInput value={tags} onChange={setTags} />
        </Field>
        <p className="text-xs text-faint">{STATE_NOTE[state]}</p>
      </div>
    </Dialog>
  );
}
