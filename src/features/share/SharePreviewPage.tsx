/**
 * Share preview.
 *
 * This screen exists so the user can *see* exactly what a shared post would
 * contain before any sharing exists — and so the app never implies that
 * publishing is available when it is not.
 *
 * What is real:
 *  - selecting individual records,
 *  - the projection itself, which is computed locally,
 *  - the sensitive-content stripping, which happens before anything is shown,
 *  - the list of excluded records and the reason for each.
 *
 * What is deliberately not here: a Publish button. Chronicle has no accounts,
 * no server and no sync in this build, so there is nothing to publish to. The
 * screen says that in plain words instead of offering a control that pretends.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useChronicle } from '../../state/ChronicleContext';
import { useChapters, useCollections, useEntries, usePaths, usePlaces, useTrips } from '../../state/hooks';
import { audienceLabel, buildSharePreview } from '../../domain/share/preview';
import { Icon } from '../../ui/Icon';
import { Badge, Button, Field, Switch, TextInput } from '../../ui/primitives';
import { EmptyState, SkeletonList } from '../../ui/states';

type Selected = { entries: Set<string>; chapters: Set<string>; trips: Set<string>; paths: Set<string>; collections: Set<string> };

const EMPTY: Selected = {
  entries: new Set(),
  chapters: new Set(),
  trips: new Set(),
  paths: new Set(),
  collections: new Set()
};

export function SharePreviewPage() {
  const { timezone } = useChronicle();
  const entries = useEntries({ limit: 200 });
  const chapters = useChapters({});
  const trips = useTrips();
  const paths = usePaths({});
  const collections = useCollections();
  const places = usePlaces();

  const [selected, setSelected] = useState<Selected>(EMPTY);
  const [includePrivate, setIncludePrivate] = useState(false);
  const [filter, setFilter] = useState('');
  const [showText, setShowText] = useState(false);

  const loading = !entries || !chapters || !trips || !paths || !collections || !places;
  const toggle = (group: keyof Selected, id: string): void => {
    setSelected((current) => {
      const next = new Set(current[group]);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...current, [group]: next };
    });
  };

  const preview = useMemo(() => {
    if (loading) return null;
    return buildSharePreview(
      {
        entries: entries ?? [],
        chapters: chapters ?? [],
        paths: paths ?? [],
        places: places ?? [],
        people: [],
        trips: trips ?? [],
        collections: collections ?? [],
        timezone
      },
      {
        entryIds: [...selected.entries],
        chapterIds: [...selected.chapters],
        tripIds: [...selected.trips],
        pathIds: [...selected.paths],
        collectionIds: [...selected.collections],
        includePrivate
      }
    );
  }, [loading, entries, chapters, paths, places, trips, collections, timezone, selected, includePrivate]);

  if (loading || !preview) return <SkeletonList rows={4} />;

  const totalSelected =
    selected.entries.size + selected.chapters.size + selected.trips.size + selected.paths.size + selected.collections.size;

  const filterText = filter.trim().toLowerCase();
  const visibleEntries = (entries ?? [])
    .filter((entry) => !entry.deleted_at)
    .filter((entry) => !filterText || `${entry.title} ${entry.body}`.toLowerCase().includes(filterText))
    .slice(0, 40);

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__title">
          <span className="eyebrow">A preview, not a post</span>
          <h1>Share preview</h1>
          <p className="text-sm text-muted measure">
            Choose the records you would consider sharing and see exactly what would be visible — after sensitive
            details have been removed. Nothing is sent anywhere.
          </p>
        </div>
      </header>

      <p className="note note--warning" role="status">
        <Icon name="shield" size={16} className="note__icon" />
        <span>
          <strong>Sharing is not implemented in this build.</strong> Chronicle has no accounts, no server and no sync.
          This preview is created and read on your device only; there is no Publish button because there is nowhere to
          publish to. Anything you select here stays on this device.
        </span>
      </p>

      <div className="lifemap-screen">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minWidth: 0 }}>
          <section aria-label="Choose experiences">
            <div className="section-head">
              <h2 className="section-head__title">Experiences</h2>
              <span className="text-xs text-faint">{selected.entries.size} selected</span>
            </div>
            <div className="form-stack form-stack--tight">
              <TextInput value={filter} onChange={setFilter} placeholder="Filter your experiences" />
              {(entries ?? []).length === 0 ? (
                <EmptyState icon="book" title="Nothing to preview yet">
                  Record an experience first, then come back to see how a share would read.
                </EmptyState>
              ) : (
                <div className="card list" style={{ maxHeight: 340, overflowY: 'auto' }}>
                  {visibleEntries.map((entry) => (
                    <label key={entry.id} className="list__item" style={{ cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={selected.entries.has(entry.id)}
                        onChange={() => toggle('entries', entry.id)}
                        style={{ marginRight: 'var(--space-3)' }}
                      />
                      <span style={{ minWidth: 0 }}>
                        <span className="text-sm">{entry.title || 'Untitled experience'}</span>
                        <span className="text-xs text-faint">
                          {' '}
                          · {entry.occurred_at.slice(0, 10)}
                          {entry.private ? ' · private' : ''}
                        </span>
                      </span>
                    </label>
                  ))}
                  {visibleEntries.length === 0 ? <p className="list__item text-sm text-muted">No matches.</p> : null}
                </div>
              )}
            </div>
          </section>

          <section aria-label="Choose collections of records">
            <div className="section-head">
              <h2 className="section-head__title">Chapters, trips, paths and collections</h2>
            </div>
            <div className="form-stack form-stack--tight">
              <SelectionGroup
                title="Chapters"
                items={(chapters ?? []).map((chapter) => ({ id: chapter.id, label: chapter.name }))}
                group="chapters"
                selected={selected}
                onToggle={toggle}
              />
              <SelectionGroup
                title="Trips"
                items={(trips ?? []).map((trip) => ({ id: trip.id, label: trip.name, sensitive: Boolean(trip.sensitive_notes) }))}
                group="trips"
                selected={selected}
                onToggle={toggle}
              />
              <SelectionGroup
                title="Paths"
                items={(paths ?? []).map((path) => ({ id: path.id, label: path.title }))}
                group="paths"
                selected={selected}
                onToggle={toggle}
              />
              <SelectionGroup
                title="Collections"
                items={(collections ?? []).map((collection) => ({ id: collection.id, label: collection.name }))}
                group="collections"
                selected={selected}
                onToggle={toggle}
              />
            </div>
          </section>
        </div>

        <aside className="lifemap-screen__aside" aria-label="Preview">
          <div className="panel">
            <div className="panel__header">
              <span className="panel__title">What would be visible</span>
              <Badge tone={totalSelected === 0 ? 'neutral' : 'accent'}>{totalSelected} selected</Badge>
            </div>
            <div className="panel__body">
              <p className="text-xs text-faint">
                Audience: <strong>{audienceLabel(preview.audience)}</strong>
              </p>
              {preview.items.length === 0 ? (
                <p className="text-sm text-muted">
                  Nothing selected yet. Records marked private are excluded unless you deliberately include them below.
                </p>
              ) : (
                <div className="preview">
                  {preview.items.map((item) => (
                    <div className="preview__item" key={`${item.kind}:${item.id}`}>
                      <span className="preview__kind">
                        {item.kind} · {item.visibility}
                      </span>
                      <span className="text-sm">{item.title}</span>
                      {item.body ? <span className="text-xs text-muted">{item.body.slice(0, 160)}</span> : null}
                      <span className="text-xs text-faint">
                        {item.date ?? 'no date'}
                        {item.datePrecision && item.datePrecision !== 'exact' ? ` (${item.datePrecision})` : ''}
                        {item.placeNames.length > 0 ? ` · ${item.placeNames.join(', ')}` : ''}
                      </span>
                      {item.omitted.length > 0 ? (
                        <span className="text-xs" style={{ color: 'var(--color-warning)' }}>
                          Removed: {item.omitted.join(' ')}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}

              <Field label="Private safety">
                <Switch
                  checked={includePrivate}
                  onChange={setIncludePrivate}
                  label="Include records I marked private"
                  description="Off by default. Turning this on lets private records into the preview only — it still publishes nothing."
                />
              </Field>

              {preview.excluded.length > 0 ? (
                <details>
                  <summary className="text-xs text-muted">
                    {preview.excluded.length} record{preview.excluded.length === 1 ? '' : 's'} excluded
                  </summary>
                  <ul className="text-xs text-faint" style={{ marginTop: 'var(--space-2)', paddingLeft: 'var(--space-4)' }}>
                    {preview.excluded.map((item) => (
                      <li key={`${item.kind}:${item.id}`}>{item.reason}</li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {preview.items.length > 0 ? (
                <div className="chip-row">
                  <Button size="sm" variant="quiet" onClick={() => setShowText((value) => !value)}>
                    {showText ? 'Hide text version' : 'Show text version'}
                  </Button>
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => {
                      void navigator.clipboard?.writeText(preview.plainText).catch(() => undefined);
                    }}
                  >
                    Copy text
                  </Button>
                </div>
              ) : null}
              {showText ? <pre className="provenance">{preview.plainText}</pre> : null}
            </div>
          </div>

          <div className="panel">
            <div className="panel__header">
              <span className="panel__title">Not available yet</span>
            </div>
            <div className="panel__body text-sm text-muted">
              <p>
                Publishing, friend circles, comment threads and unshare links all depend on accounts and a server. They
                are planned, not built. See the{' '}
                <Link to="/roadmap">roadmap</Link> for what a real sharing model requires.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SelectionGroup({
  title,
  items,
  group,
  selected,
  onToggle
}: {
  title: string;
  items: { id: string; label: string; sensitive?: boolean }[];
  group: keyof Selected;
  selected: Selected;
  onToggle: (group: keyof Selected, id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <p className="text-xs text-faint">
        {title}: none recorded yet.
      </p>
    );
  }
  return (
    <div>
      <p className="text-xs text-faint" style={{ marginBottom: 4 }}>
        {title}
      </p>
      <div className="chip-row">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="tagchip"
            aria-pressed={selected[group].has(item.id)}
            onClick={() => onToggle(group, item.id)}
          >
            {item.label}
            {item.sensitive ? (
              <span className="text-faint">
                {' '}
                <Icon name="lock" size={10} className="icon-inline" /> sensitive
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
