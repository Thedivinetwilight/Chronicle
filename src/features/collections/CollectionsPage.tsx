/**
 * Collections — albums of experiences the user chose to gather.
 *
 * A collection is a curated list, not a filter: nothing is added unless the
 * user adds it. Its visibility is stored, but this build cannot share, and the
 * screen says so rather than implying otherwise.
 */

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useChronicle } from '../../state/ChronicleContext';
import { useCollection, useCollections, useEntries } from '../../state/hooks';
import type { Collection } from '../../domain/types';
import { WhenItHappened } from '../../ui/format';
import { Badge, Button, Field, IconButton, TextArea, TextInput } from '../../ui/primitives';
import { Dialog } from '../../ui/Dialog';
import { EmptyState, ErrorState, SkeletonList } from '../../ui/states';
import { Icon } from '../../ui/Icon';
import { Cover } from '../../ui/art/Cover';

export function CollectionsPage() {
  const collections = useCollections();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (collections === undefined) return <SkeletonList rows={3} />;

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__title">
          <span className="eyebrow">Gathered by hand</span>
          <h1>Collections</h1>
          <p className="text-sm text-muted measure">
            Albums of your own choosing — “Japan trip”, “Best days of 2026”. Nothing is added automatically.
          </p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
          New collection
        </Button>
      </header>

      {error ? (
        <p className="note note--danger" role="alert">
          <Icon name="alert" size={16} className="note__icon" /> {error}
        </p>
      ) : null}

      {collections.length === 0 ? (
        <EmptyState
          mark="leaf-cluster"
          compact
          title="No collections yet"
        >
          A small album you curate by hand.
        </EmptyState>
      ) : (
        /* A collection is a small exhibition, so it gets a plate and a count
           rather than a row with a generic layers icon. */
        <div className="covershelf">
          {collections.map((collection) => (
            <Link key={collection.id} to={`/collections/${collection.id}`} className="covershelf__item rowlink">
              <span className="coverframe">
                <Cover kind="collection" id={collection.id} name={collection.name} />
              </span>
              <span className="covershelf__name">{collection.name}</span>
              <span className="covershelf__meta">
                {collection.entry_ids.length} experience{collection.entry_ids.length === 1 ? '' : 's'}
              </span>
              {collection.description ? <span className="covershelf__desc">{collection.description}</span> : null}
            </Link>
          ))}
        </div>
      )}

      <CollectionDialog open={creating} collection={null} onClose={() => setCreating(false)} onSaved={() => setCreating(false)} onError={setError} />
    </div>
  );
}

export function CollectionPage() {
  const { collectionId } = useParams();
  const { store, toast, timezone } = useChronicle();
  const collection = useCollection(collectionId);
  const entries = useEntries({});
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (collection === undefined) return <SkeletonList rows={3} />;
  if (collection === null) return <ErrorState title="Collection not found" message="It may have been deleted." />;

  const members = (entries ?? []).filter((entry) => collection.entry_ids.includes(entry.id) && !entry.deleted_at);
  const missing = collection.entry_ids.length - members.length;

  const remove = async () => {
    try {
      await store.deleteCollection(collection.id);
      toast('Collection deleted. Its experiences were kept.', { tone: 'success' });
      setConfirmDelete(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The collection could not be deleted.');
      setConfirmDelete(false);
    }
  };

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__title">
          <span className="eyebrow">{members.length} experience{members.length === 1 ? '' : 's'}</span>
          <h1>{collection.name}</h1>
          <p className="text-sm text-muted">
            <Badge>
              <Icon name="lock" size={10} className="icon-inline" /> private by default
            </Badge>
          </p>
        </div>
        <div className="page__actions">
          <IconButton name="edit" label="Edit collection" onClick={() => setEditing(true)} />
          <IconButton name="trash" label="Delete collection" onClick={() => setConfirmDelete(true)} />
        </div>
      </header>

      {error ? (
        <p className="note note--danger" role="alert">
          <Icon name="alert" size={16} className="note__icon" /> {error}
        </p>
      ) : null}

      {collection.description ? (
        <article className="card">
          <div className="card__body text-block">{collection.description}</div>
        </article>
      ) : null}

      <section aria-label="Experiences in this collection">
        {members.length === 0 ? (
          <EmptyState mark="leaf-cluster" compact title="Nothing gathered yet">
            Edit this collection to choose experiences.
          </EmptyState>
        ) : (
          <div className="card list">
            {members.map((entry) => (
              <Link key={entry.id} to={`/journal/${entry.id}`} className="list__item entrycard">
                <span className="entrycard__title">{entry.title || 'Untitled experience'}</span>
                <span className="entrycard__meta">
                  <WhenItHappened at={entry.occurred_at} precision={entry.occurred_precision} timezone={timezone} unknownLabel="Date not recorded" />
                  {entry.private ? ' · private' : ''}
                </span>
              </Link>
            ))}
          </div>
        )}
        {missing > 0 ? (
          <p className="text-xs text-faint">
            {missing} record{missing === 1 ? '' : 's'} in this collection {missing === 1 ? 'is' : 'are'} deleted. Restore
            {missing === 1 ? ' it' : ' them'} from Settings → Deleted and the collection will show {missing === 1 ? 'it' : 'them'} again.
          </p>
        ) : null}
      </section>

      <div className="note">
        <Icon name="info" size={16} className="note__icon" />
        <span>
          Sharing a collection is a planned feature. This build stores no accounts and runs no server, so a collection
          cannot be published. <Link to="/share-preview">Preview what would be visible</Link>.
        </span>
      </div>

      <CollectionDialog open={editing} collection={collection} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} onError={setError} />

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this collection?"
        footer={
          <>
            <Button variant="quiet" onClick={() => setConfirmDelete(false)}>
              Keep collection
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              Delete collection
            </Button>
          </>
        }
      >
        <p className="text-sm">
          Only the album is deleted. Its experiences stay in your journal, exactly as they were.
        </p>
      </Dialog>
    </div>
  );
}

function CollectionDialog({
  open,
  collection,
  onClose,
  onSaved,
  onError
}: {
  open: boolean;
  collection: Collection | null;
  onClose: () => void;
  onSaved: (collection: Collection) => void;
  onError: (message: string | null) => void;
}) {
  const { store, timezone } = useChronicle();
  const entries = useEntries({ limit: 200 });
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [entryIds, setEntryIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const [seededFor, setSeededFor] = useState<string | null>(null);
  const seedKey = open ? (collection?.id ?? 'new') : null;
  if (open && seededFor !== seedKey) {
    setSeededFor(seedKey);
    setName(collection?.name ?? '');
    setDescription(collection?.description ?? '');
    setEntryIds(collection?.entry_ids ?? []);
    setSaveError(null);
    setFilter('');
  }

  if (!open) return null;

  const toggle = (id: string) => {
    setEntryIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  };

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setSaveError(null);
    try {
      const payload = { name: name.trim(), description: description.trim() || undefined, entry_ids: entryIds };
      const saved = collection ? await store.updateCollection(collection.id, payload) : await store.createCollection(payload);
      onError(null);
      onSaved(saved);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : 'The collection could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const options = (entries ?? []).filter((entry) => {
    if (!filter.trim()) return true;
    const needle = filter.toLowerCase();
    return `${entry.title} ${entry.body}`.toLowerCase().includes(needle);
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={collection ? 'Edit collection' : 'New collection'}
      wide
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} disabled={!name.trim()} onClick={() => void save()}>
            {collection ? 'Save collection' : 'Create collection'}
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
        <Field label="Name" required>
          <TextInput value={name} onChange={setName} placeholder="Best days of 2026" maxLength={120} />
        </Field>
        <Field label="Description" hint="Optional.">
          <TextArea value={description} onChange={setDescription} rows={2} />
        </Field>
        <Field label="Experiences" hint={`${entryIds.length} selected. Only what you choose is included.`}>
          <div className="form-stack form-stack--tight">
            <input
              className="input"
              type="search"
              value={filter}
              placeholder="Filter your experiences"
              aria-label="Filter experiences to add"
              onChange={(event) => setFilter(event.target.value)}
            />
            <div className="card list" style={{ maxHeight: 260, overflowY: 'auto' }}>
              {options.length === 0 ? (
                <p className="list__item text-sm text-muted">No experiences match.</p>
              ) : (
                options.map((entry) => (
                  <label key={entry.id} className="list__item" style={{ cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={entryIds.includes(entry.id)}
                      onChange={() => toggle(entry.id)}
                      style={{ marginRight: 'var(--space-3)' }}
                    />
                    <span className="text-sm">{entry.title || 'Untitled experience'}</span>
                    <span className="text-xs text-faint">
                      {' · '}
                      <WhenItHappened at={entry.occurred_at} precision={entry.occurred_precision} timezone={timezone} unknownLabel="no date" />
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
        </Field>
      </div>
    </Dialog>
  );
}
