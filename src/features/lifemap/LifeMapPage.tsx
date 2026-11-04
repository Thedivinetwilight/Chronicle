/**
 * Life Map screen.
 *
 * Two ways to read the same archive:
 *  - the spatial map (signature view), and
 *  - the outline, a complete text list in the same order (the equivalent view
 *    for anyone who finds a map hard to navigate, and the fallback on a very
 *    small or very slow device).
 *
 * Both are built from `useLifeMapSource()` in one read. Only approved
 * relationships are drawn; suggestions are listed underneath for review and
 * never become connections until the user accepts them.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useChronicle } from '../../state/ChronicleContext';
import { useChapterEntries, useLifeMapSource, useMemoryLinks } from '../../state/hooks';
import { buildLifeMap, filterNodes, hitTest, mapLabel, type LifeNode, type LifeNodeKind } from '../../domain/lifeMap/layout';
import { suggestMemoryLinks, type SuggestionInput } from '../../domain/lifeMap/suggestions';
import { Icon } from '../../ui/Icon';
import { Badge, Button, IconButton, Segmented, Select } from '../../ui/primitives';
import { EmptyState, ErrorState, SkeletonList } from '../../ui/states';
import { formatDateLabel, localDateIso } from '../../domain/time';
import { LifeMapCanvas, LIFE_NODE_KIND_LABEL } from './LifeMapCanvas';

type View = 'map' | 'outline';

const KIND_ICON: Record<LifeNodeKind, 'book' | 'map' | 'route' | 'pin' | 'people' | 'plane' | 'layers'> = {
  chapter: 'map',
  experience: 'book',
  path: 'route',
  place: 'pin',
  person: 'people',
  trip: 'plane',
  collection: 'layers'
};

const LEGEND: { kind: LifeNodeKind; label: string }[] = [
  { kind: 'chapter', label: 'Chapter' },
  { kind: 'experience', label: 'Experience' },
  { kind: 'path', label: 'Path' },
  { kind: 'place', label: 'Place' },
  { kind: 'person', label: 'Person' },
  { kind: 'trip', label: 'Trip' },
  { kind: 'collection', label: 'Collection' }
];

export function LifeMapPage() {
  const { store, settings, toast } = useChronicle();
  const source = useLifeMapSource();
  const pendingLinks = useMemoryLinks({ status: 'suggested' });

  const [view, setView] = useState<View>('map');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [chapterFilter, setChapterFilter] = useState<string>('');
  const [kindFilter, setKindFilter] = useState<'all' | LifeNodeKind>('all');
  const [query, setQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [busyLink, setBusyLink] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const reducedMotion = Boolean(settings?.reduce_motion) || prefersReducedMotion();

  const layout = useMemo(() => (source ? buildLifeMap(source) : null), [source]);

  /* The canvas re-lays out the map at its own measured size, so labels stay
     legible on a phone instead of being scaled down with the drawing. */
  const buildAtSize = useCallback(
    (width: number, height: number) => buildLifeMap(source!, { width, height }),
    [source]
  );

  /* The map and the outline share one filtered set, so switching views never
     changes what you are looking at. */
  const visibleNodes = useMemo(() => {
    if (!layout) return [];
    let nodes = layout.nodes;
    if (chapterFilter) {
      nodes = nodes.filter((node) => node.chapterId === chapterFilter || (node.kind === 'chapter' && node.id === chapterFilter));
    }
    if (kindFilter !== 'all') nodes = nodes.filter((node) => node.kind === kindFilter);
    if (query.trim()) nodes = filterNodes(nodes, query);
    return nodes;
  }, [layout, chapterFilter, kindFilter, query]);

  const highlighted = useMemo(() => new Set(visibleNodes.map((node) => node.key)), [visibleNodes]);
  const selected = useMemo(
    () => (layout && selectedKey ? layout.nodes.find((node) => node.key === selectedKey) ?? null : null),
    [layout, selectedKey]
  );

  /* If a selection is filtered away, close the panel rather than showing a
     record the map is no longer displaying. */
  useEffect(() => {
    if (selectedKey && layout && !layout.nodes.some((node) => node.key === selectedKey)) setSelectedKey(null);
  }, [layout, selectedKey]);

  if (source === undefined) {
    return (
      <div className="page">
        <PageHeader />
        <div role="status" aria-live="polite">
          <span className="sr-only">Building your life map…</span>
          <SkeletonList rows={4} />
        </div>
      </div>
    );
  }

  if (!layout) {
    return (
      <div className="page">
        <PageHeader />
        <ErrorState
          title="The map could not be built"
          message="Your records are safe. Reload the page to try again; nothing has been changed."
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }

  const chapterOptions = [
    { value: '', label: 'Every chapter' },
    ...layout.axes
      .filter((axis) => source.chapters.some((chapter) => chapter.id === axis.chapterId))
      .map((axis) => ({ value: axis.chapterId, label: axis.label })),
  ];

  const total = layout.nodes.length;
  const suggested = pendingLinks ?? [];

  const decide = async (id: string, status: 'confirmed' | 'rejected') => {
    setReviewError(null);
    setBusyLink(id);
    try {
      await store.setLinkStatus(id, status);
      toast(status === 'confirmed' ? 'Connection added to your map.' : 'Suggestion dismissed.', {
        tone: status === 'confirmed' ? 'success' : 'neutral'
      });
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : 'That suggestion could not be updated.');
    } finally {
      setBusyLink(null);
    }
  };

  return (
    <div className="page">
      <PageHeader
        action={
          <div className="page__actions">
            <Link to="/journal/new" className="btn btn--primary">
              <Icon name="plus" size={17} />
              Add experience
            </Link>
          </div>
        }
      />

      {total === 0 ? (
        <EmptyState icon="map" title="Your map is waiting for its first memory">
          A life map is built from what you record — an experience, then the chapter it belongs to, a place you went, a
          path you set out on. Nothing is invented to fill it.
          <div style={{ marginTop: 'var(--space-3)', display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <Link to="/journal/new" className="btn btn--primary">
              <Icon name="plus" size={16} /> Add your first experience
            </Link>
            <Link to="/chapters" className="btn">
              <Icon name="map" size={16} /> Start a chapter
            </Link>
          </div>
        </EmptyState>
      ) : (
        <>
          <div className="page__controls">
            <div className="searchfield" style={{ flex: '1 1 220px' }}>
              <Icon name="search" size={16} aria-hidden="true" />
              <label className="sr-only" htmlFor="map-search">
                Find a node on the map
              </label>
              <input
                id="map-search"
                className="input"
                type="search"
                value={query}
                placeholder="Find a chapter, place, person or experience"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div style={{ flex: '0 1 200px' }}>
              <Select
                label="Focus on a chapter"
                value={chapterFilter}
                onChange={setChapterFilter}
                options={chapterOptions}
              />
            </div>
            <div style={{ flex: '0 1 170px' }}>
              <Select
                label="Show only"
                value={kindFilter}
                onChange={(value) => setKindFilter(value as 'all' | LifeNodeKind)}
                options={[{ value: 'all', label: 'Everything' }, ...LEGEND.map((entry) => ({ value: entry.kind, label: entry.label }))]}
              />
            </div>
            <Segmented
              label="Map view"
              value={view}
              onChange={setView}
              options={[
                { value: 'map', label: 'Map' },
                { value: 'outline', label: 'Outline' }
              ]}
            />
          </div>

          <div className="lifemap-screen">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minWidth: 0 }}>
              {view === 'map' ? (
                visibleNodes.length === 0 ? (
                  <EmptyState
                    icon="search"
                    title="Nothing matches these filters"
                    action={<Button onClick={() => { setQuery(''); setKindFilter('all'); setChapterFilter(''); }}>Clear filters</Button>}
                  >
                    Your records are still there — this is only a filter.
                  </EmptyState>
                ) : (
                  <LifeMapCanvas
                    layout={layout}
                    buildAtSize={source ? buildAtSize : undefined}
                    selectedKey={selectedKey}
                    onSelect={(node) => setSelectedKey(node?.key ?? null)}
                    highlighted={highlighted}
                    reducedMotion={reducedMotion}
                  />
                )
              ) : (
                <MapOutline
                  nodes={visibleNodes}
                  edges={layout.edges}
                  selectedKey={selectedKey}
                  onSelect={(node) => setSelectedKey(node.key)}
                />
              )}

              <div className="lifemap-legend" aria-label="Map legend">
                {LEGEND.map((entry) => {
                  const count = layout.nodes.filter((node) => node.kind === entry.kind).length;
                  if (count === 0) return null;
                  return (
                    <span className="lifemap-legend__item" key={entry.kind}>
                      <span
                        className={`lifemap-legend__swatch lifemap-legend__swatch--${entry.kind}`}
                        style={{ color: `var(--map-ink-${entry.kind})`, background: `var(--map-fill-${entry.kind})` }}
                        aria-hidden="true"
                      />
                      {entry.label} · {count}
                    </span>
                  );
                })}
                <span className="lifemap-legend__item">
                  <span
                    className="lifemap-legend__swatch"
                    style={{ borderStyle: 'dashed', borderRadius: 0, borderTopWidth: 2, height: 0, color: 'var(--map-edge-strong)' }}
                    aria-hidden="true"
                  />
                  Dashed line: date not known
                </span>
              </div>

              <p className="text-xs text-faint">
                {layout.counts.experiences} experience{layout.counts.experiences === 1 ? '' : 's'} ·{' '}
                {layout.counts.chapters} chapter{layout.counts.chapters === 1 ? '' : 's'} ·{' '}
                {layout.counts.approvedLinks} approved connection{layout.counts.approvedLinks === 1 ? '' : 's'}
                {layout.counts.suggestedLinks > 0 ? ` · ${layout.counts.suggestedLinks} suggestion${layout.counts.suggestedLinks === 1 ? '' : 's'} awaiting review` : ''}
                . Only your own records are drawn, and this map stays private.
              </p>
            </div>

            <aside className="lifemap-screen__aside" aria-label="Map details">
              {selected ? (
                <NodeDetail node={selected} onClose={() => setSelectedKey(null)} />
              ) : (
                <div className="panel">
                  <div className="panel__header">
                    <span className="panel__title">How to read this map</span>
                  </div>
                  <div className="panel__body text-sm text-muted">
                    <p>
                      Chapters radiate from the centre in date order, and each experience sits along its chapter at the
                      point of its date. Paths run alongside the era they belong to. Places, people, trips and
                      collections appear only where a record exists.
                    </p>
                    <p>
                      Select any node to open the underlying record. The Outline view lists the same map as text.
                    </p>
                  </div>
                </div>
              )}

              <div className="panel">
                <div className="panel__header">
                  <span className="panel__title">
                    Suggested connections
                    {suggested.length > 0 ? <Badge tone="accent"> {suggested.length}</Badge> : null}
                  </span>
                  {suggested.length > 0 ? (
                    <Button size="sm" variant="quiet" onClick={() => setShowSuggestions((value) => !value)}>
                      {showSuggestions ? 'Hide' : 'Review'}
                    </Button>
                  ) : null}
                </div>
                <div className="panel__body">
                  {reviewError ? (
                    <p className="note note--danger" role="alert">
                      <Icon name="alert" size={16} className="note__icon" />
                      {reviewError}
                    </p>
                  ) : null}
                  {suggested.length === 0 ? (
                    <p className="text-xs text-faint">
                      Nothing to review. Chronicle only suggests a connection when two of your own records share a
                      date, a tag or a recorded place — and never adds one without your approval.
                    </p>
                  ) : showSuggestions ? (
                    suggested.map((link) => (
                      <div key={link.id} className="stack-tight" style={{ paddingBottom: 'var(--space-3)', borderBottom: '1px solid var(--color-border)' }}>
                        <span className="text-sm">{link.rationale ?? `${link.from_kind} ${link.role} ${link.to_kind}`}</span>
                        <div className="chip-row">
                          <Button
                            size="sm"
                            variant="primary"
                            busy={busyLink === link.id}
                            onClick={() => void decide(link.id, 'confirmed')}
                          >
                            Add connection
                          </Button>
                          <Button size="sm" variant="quiet" disabled={busyLink === link.id} onClick={() => void decide(link.id, 'rejected')}>
                            Not related
                          </Button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-faint">
                      Suggested links are not drawn on the map. Review them to decide whether they belong in your record.
                    </p>
                  )}
                </div>
              </div>

              <SuggestionHelper
                layoutReady={Boolean(layout)}
                onGenerated={async (count) => {
                  if (count > 0) setShowSuggestions(true);
                  toast(
                    count > 0
                      ? `${count} suggestion${count === 1 ? '' : 's'} saved for review. Nothing was connected.`
                      : 'No new connections stood out in your records.',
                    { tone: 'neutral' }
                  );
                }}
              />
            </aside>
          </div>
        </>
      )}
      <span className="sr-only" aria-live="polite">
        {visibleNodes.length} of {total} nodes shown.
      </span>
    </div>
  );
}

function PageHeader({ action }: { action?: React.ReactNode }) {
  return (
    <header className="page__header">
      <div className="page__title">
        <span className="eyebrow">Your archive, mapped</span>
        <h1>Life map</h1>
        <p className="text-sm text-muted measure">
          A private view of how your chapters, experiences, paths, places and people connect. Nothing here is shared.
        </p>
      </div>
      {action}
    </header>
  );
}

/* ------------------------------------------------------------------ *
 * Detail panel
 * ------------------------------------------------------------------ */

function NodeDetail({ node, onClose }: { node: LifeNode; onClose: () => void }) {
  const navigate = useNavigate();
  const { timezone } = useChronicle();
  const chapterEntries = useChapterEntries(node.kind === 'chapter' ? node.id : undefined);

  const path = recordPath(node);
  return (
    <div className="panel mapdetail" aria-labelledby="mapdetail-title">
      <div className="panel__header">
        <div>
          <div className="mapdetail__kind">
            <Icon name={KIND_ICON[node.kind]} size={13} /> {LIFE_NODE_KIND_LABEL[node.kind]}
            {node.visibility !== 'private' ? <Badge tone="warning">audience: {node.visibility} (not implemented)</Badge> : null}
          </div>
          <div className="mapdetail__title" id="mapdetail-title">
            {node.label}
          </div>
        </div>
        <IconButton name="close" label="Close details" onClick={onClose} size={18} />
      </div>
      <div className="panel__body">
        <p className="mapdetail__description">{node.description}</p>
        <dl className="mapdetail__facts">
          <li>
            <dt>Date</dt>
            <dd>
              {node.date ? formatDateLabel(localDateIso(node.date, timezone)) : 'Not recorded'}
              {node.uncertain ? ' (approximate)' : ''}
            </dd>
          </li>
          <li>
            <dt>Chapter</dt>
            <dd>{node.chapterId ? 'Filed in a chapter' : 'Not in a chapter'}</dd>
          </li>
          <li>
            <dt>Privacy</dt>
            <dd>{node.visibility === 'private' ? 'Private to you' : `${node.visibility} (declared; sharing is not implemented)`}</dd>
          </li>
          {node.kind === 'chapter' && chapterEntries ? (
            <li>
              <dt>Experiences</dt>
              <dd>{chapterEntries.length}</dd>
            </li>
          ) : null}
        </dl>
        <div className="mapdetail__actions">
          {path ? (
            <Button variant="primary" icon="external" onClick={() => navigate(path)}>
              Open {node.kind === 'experience' ? 'experience' : node.kind}
            </Button>
          ) : (
            <p className="text-xs text-faint">
              This record kind does not have its own page yet. It is managed from where it was created.
            </p>
          )}
          {node.kind === 'chapter' ? (
            <Button variant="quiet" onClick={() => navigate('/chapters')}>
              All chapters
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Where a node's underlying record lives, or null when it has no page yet. */
function recordPath(node: LifeNode): string | null {
  if (node.kind === 'experience') return `/journal/${node.id}`;
  if (node.kind === 'chapter') return `/chapters/${node.id}`;
  if (node.kind === 'path') return `/paths/${node.id}`;
  if (node.kind === 'trip') return `/trips/${node.id}`;
  if (node.kind === 'collection') return `/collections/${node.id}`;
  // Places and people share one management screen; neither has a detail page.
  if (node.kind === 'place' || node.kind === 'person') return '/places';
  return null;
}

/* ------------------------------------------------------------------ *
 * Outline view
 * ------------------------------------------------------------------ */

function MapOutline({
  nodes,
  edges,
  selectedKey,
  onSelect
}: {
  nodes: LifeNode[];
  edges: { from: string; to: string; label: string }[];
  selectedKey: string | null;
  onSelect: (node: LifeNode) => void;
}) {
  const { timezone } = useChronicle();
  const order: LifeNodeKind[] = ['chapter', 'path', 'experience', 'trip', 'place', 'person', 'collection'];
  const groups = order
    .map((kind) => ({ kind, items: nodes.filter((node) => node.kind === kind) }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="outline" role="list" aria-label="Map outline">
      {groups.map((group) => (
        <section key={group.kind} aria-label={LIFE_NODE_KIND_LABEL[group.kind]}>
          <div className="outline__group-title">
            <Icon name={KIND_ICON[group.kind]} size={13} /> {LIFE_NODE_KIND_LABEL[group.kind]} · {group.items.length}
          </div>
          <div className="card list">
            {group.items.map((node) => {
              const connections = edges.filter((edge) => edge.from === node.key || edge.to === node.key).length;
              return (
                <button
                  key={node.key}
                  type="button"
                  className="outline__row"
                  aria-current={selectedKey === node.key}
                  onClick={() => onSelect(node)}
                >
                  <span
                    className="outline__dot"
                    aria-hidden="true"
                    style={{ color: `var(--map-ink-${node.kind})`, background: `var(--map-fill-${node.kind})` }}
                  />
                  <span className="outline__text">
                    <span className="outline__label">{mapLabel(node.label, 60)}</span>
                    <span className="outline__meta">
                      {node.date ? formatDateLabel(localDateIso(node.date, timezone)) : 'No date recorded'}
                      {node.uncertain ? ' · approximate' : ''} · {connections} connection{connections === 1 ? '' : 's'}
                      {node.visibility !== 'private' ? ` · audience: ${node.visibility}` : ''}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {nodes.length === 0 ? (
        <EmptyState icon="search" title="Nothing to outline">
          Clear the filters to see the whole map as a list.
        </EmptyState>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Suggestion helper: a deliberate, explicit action
 * ------------------------------------------------------------------ */

function SuggestionHelper({ onGenerated }: { layoutReady: boolean; onGenerated: (count: number) => Promise<void> }) {
  const { store, timezone } = useChronicle();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const source = await store.lifeMapSource();
      const input: SuggestionInput = { ...source, timezone };
      const suggestions = suggestMemoryLinks(input);
      let saved = 0;
      for (const suggestion of suggestions) {
        try {
          // Re-checked by the store, which refuses duplicates: resubmitting is safe.
          await store.createLink({
            from_kind: suggestion.from_kind,
            from_id: suggestion.from_id,
            to_kind: suggestion.to_kind,
            to_id: suggestion.to_id,
            origin: 'suggested',
            role: suggestion.role,
            rationale: suggestion.rationale
          });
          saved += 1;
        } catch {
          /* A pair that now duplicates an existing link is simply skipped. */
        }
      }
      await onGenerated(saved);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Suggestions could not be generated.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel__header">
        <span className="panel__title">Look for connections</span>
      </div>
      <div className="panel__body">
        <p className="text-xs text-faint">
          Scans your own records on this device for shared dates, tags and recorded places. Anything it finds is saved
          as a suggestion for you to accept or dismiss — never as a fact, and never sent anywhere.
        </p>
        {error ? (
          <p className="note note--danger" role="alert">
            <Icon name="alert" size={16} className="note__icon" />
            {error}
          </p>
        ) : null}
        <div>
          <Button size="sm" busy={busy} onClick={() => void generate()}>
            <Icon name="sparkle" size={15} /> Find suggested connections
          </Button>
        </div>
      </div>
    </div>
  );
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* Re-exported for the map's tests and for other screens that link to a node. */
export { hitTest };
