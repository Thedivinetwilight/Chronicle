/**
 * The journal (§20): every entry, newest first, with light filters.
 * Entries are the atomic unit of Chronicle — nothing here aggregates or
 * scores them; the list is a record, not a report.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useChronicle } from '../../state/ChronicleContext';
import { useEntries, useProjects, useTags, ENTRY_TYPE_OPTIONS } from '../../state/hooks';
import type { EntryType } from '../../domain/types';
import { Badge, Button, Select } from '../../ui/primitives';
import { Icon } from '../../ui/Icon';
import { EmptyState, SkeletonList } from '../../ui/states';
import { MetaLine, RelativeTime } from '../../ui/format';
import { EntryDialog } from './EntryDialog';
import type { JournalEntry } from '../../domain/types';

export function JournalPage() {
  const { timezone, openCapture } = useChronicle();
  const projects = useProjects({});
  const tags = useTags();
  const [projectId, setProjectId] = useState('');
  const [type, setType] = useState<EntryType | 'all'>('all');
  const [tag, setTag] = useState('');
  const [editing, setEditing] = useState<JournalEntry | 'new' | null>(null);

  const filter = useMemo(
    () => ({
      projectId: projectId || undefined,
      types: type === 'all' ? undefined : ([type] as EntryType[]),
      tags: tag ? [tag] : undefined,
      limit: 120
    }),
    [projectId, type, tag]
  );

  const entries = useEntries(filter);

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__title">
          <h1>Journal</h1>
          <span className="text-xs text-faint">{entries?.length ?? '…'} entries</span>
        </div>
        <div className="chip-row">
          <Button variant="quiet" icon="plus" onClick={() => openCapture()}>
            Capture
          </Button>
          <Button variant="primary" icon="edit" onClick={() => setEditing('new')}>
            Write
          </Button>
        </div>
      </header>

      <div className="page__controls">
        <div className="field">
          <Select
            label="Project"
            value={projectId}
            onChange={setProjectId}
            options={[{ value: '', label: 'All projects' }, ...(projects ?? []).map((p) => ({ value: p.id, label: p.name }))]}
          />
        </div>
        <div className="field">
          <Select
            label="Type"
            value={type}
            onChange={(next) => setType(next as EntryType | 'all')}
            options={[{ value: 'all', label: 'All types' }, ...ENTRY_TYPE_OPTIONS]}
          />
        </div>
        <div className="field">
          <Select
            label="Tag"
            value={tag}
            onChange={setTag}
            options={[{ value: '', label: 'All tags' }, ...(tags ?? []).map((t) => ({ value: t.tag, label: `#${t.tag}` }))]}
          />
        </div>
      </div>

      {entries === undefined ? <SkeletonList rows={5} /> : null}

      {entries && entries.length === 0 ? (
        <EmptyState icon="book" title="No entries match">
          {projectId || type !== 'all' || tag
            ? 'Try clearing a filter.'
            : 'Your journal starts with one honest sentence about what happened.'}
          <div style={{ marginTop: 'var(--space-3)' }}>
            <Button variant="primary" icon="plus" onClick={() => openCapture()}>
              Capture something
            </Button>
          </div>
        </EmptyState>
      ) : null}

      {entries && entries.length > 0 ? (
      <div className="card list">
        {entries.map((entry) => (
          <Link className="list__item entrycard" key={entry.id} to={`/journal/${entry.id}`}>
            <div className="entrycard__title">
              <span>{entry.title || 'Untitled'}</span>
              {entry.private ? (
                <Badge>
                  <Icon name="lock" size={10} /> private
                </Badge>
              ) : null}
              {entry.pinned ? <Badge tone="accent">pinned</Badge> : null}
            </div>
            <div className="entrycard__preview">{entry.summary || entry.body}</div>
            <MetaLine>
              <Badge>{entry.type}</Badge>
              <RelativeTime at={entry.occurred_at} timezone={timezone} />
              {entry.evidence_level !== 'concept' ? <Badge tone="accent">{entry.evidence_level}</Badge> : null}
              {entry.tags.slice(0, 3).map((t) => (
                <span key={t} className="tagchip">
                  #{t}
                </span>
              ))}
              {entry.source.kind === 'capture' ? <span>· captured</span> : null}
            </MetaLine>
          </Link>
        ))}
      </div>
      ) : null}

      <EntryDialog open={editing !== null} entry={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
    </div>
  );
}
