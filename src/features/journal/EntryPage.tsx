/**
 * A single entry, with its full provenance: what was written, what Chronicle
 * suggested, what changed since, and the ability to go back (§16).
 */

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useChronicle } from '../../state/ChronicleContext';
import { useEntry, useProject, useRevisions, useTasks } from '../../state/hooks';
import { Badge, Button, Details, IconButton } from '../../ui/primitives';
import { Icon } from '../../ui/Icon';
import { ErrorState, SkeletonList } from '../../ui/states';
import { MarkdownView } from '../../ui/MarkdownView';
import { MetaLine, RelativeTime } from '../../ui/format';
import { EntryDialog } from './EntryDialog';
import { formatDateLabel, formatDateTime } from '../../domain/time';

export function EntryPage() {
  const { entryId } = useParams();
  const navigate = useNavigate();
  const { store, toast, timezone } = useChronicle();
  const entry = useEntry(entryId);
  const revisions = useRevisions(entryId);
  const project = useProject(entry?.project_id ?? undefined);
  const allTasks = useTasks({});
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (entry === undefined) return <SkeletonList rows={3} />;
  if (entry === null) return <ErrorState title="Entry not found" message="It may have been deleted or purged on this device." />;

  const tasks = (allTasks ?? []).filter((task) => task.source_entry_id === entry.id && !task.deleted_at);

  const restore = async (revisionId: string) => {
    await store.restoreRevision(revisionId);
    toast('Earlier version restored. The newer text is kept as a revision.', { tone: 'success' });
  };

  const remove = async () => {
    await store.deleteEntry(entry.id);
    toast('Entry moved to Deleted. You can restore it from Settings.', { tone: 'success' });
    navigate('/journal');
  };

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__title">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <IconButton name="chevron-left" label="Back to journal" onClick={() => navigate('/journal')} />
            <h1>{entry.title || 'Untitled'}</h1>
          </div>
          <MetaLine>
            <Badge>{entry.type}</Badge>
            <span>{formatDateTime(entry.occurred_at, timezone)}</span>
            {entry.occurred_precision !== 'exact' ? <Badge>≈ {entry.occurred_precision}</Badge> : null}
            {entry.occurred_source !== 'user' ? <span>· date from {entry.occurred_source}</span> : null}
            {entry.private ? (
              <Badge>
                <Icon name="lock" size={10} /> private
              </Badge>
            ) : null}
          </MetaLine>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
          <IconButton name="edit" label="Edit entry" onClick={() => setEditing(true)} />
          <IconButton name="trash" label="Delete entry" onClick={() => setConfirmDelete(true)} />
        </div>
      </header>

      {project && (
        <Link to={`/projects/${project.id}`} className="tagchip" style={{ alignSelf: 'flex-start' }}>
          <Icon name="folder" size={13} /> {project.name}
        </Link>
      )}

      <article className="card">
        <div className="card__body">
          <MarkdownView source={entry.body} />
          {entry.tags.length > 0 && (
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-4)' }}>
              {entry.tags.map((tag) => (
                <Link key={tag} to={`/search?q=${encodeURIComponent(tag)}`} className="tagchip">
                  #{tag}
                </Link>
              ))}
            </div>
          )}
        </div>
      </article>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <span className="text-xs text-faint">Evidence level</span>
        <Badge tone={entry.evidence_level === 'concept' ? 'neutral' : 'accent'}>{entry.evidence_level}</Badge>
        <span className="text-xs text-faint">
          {entry.evidence.length > 0 ? `${entry.evidence.length} reference${entry.evidence.length === 1 ? '' : 's'} attached` : 'no evidence attached yet'}
        </span>
      </div>

      {tasks.length > 0 && (
        <section aria-label="Tasks from this entry">
          <h2 className="text-sm text-muted" style={{ marginBottom: 'var(--space-2)' }}>
            Tasks from this entry
          </h2>
          <div className="card list">
            {tasks.map((task) => (
              <div className="list__item" key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <button
                  type="button"
                  className="iconbtn"
                  style={{ width: 28, height: 28 }}
                  aria-label={`Mark “${task.title}” done`}
                  onClick={async () => {
                    await store.updateTask(task.id, { status: task.status === 'done' ? 'todo' : 'done' });
                  }}
                >
                  <Icon name={task.status === 'done' ? 'check' : 'task'} size={15} />
                </button>
                <span className="text-sm" style={{ flex: 1, textDecoration: task.status === 'done' ? 'line-through' : undefined }}>
                  {task.title}
                </span>
                {task.due_on ? <Badge>{formatDateLabel(task.due_on)}</Badge> : null}
              </div>
            ))}
          </div>
        </section>
      )}

      {entry.source.original_input && entry.source.original_input !== entry.body && (
        <Details summary="Original capture (verbatim)">
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', color: 'var(--color-text-muted)' }}>
            {entry.source.original_input}
          </pre>
          <p className="text-xs text-faint" style={{ marginTop: 'var(--space-3)' }}>
            Suggested by {entry.source.analyzer ?? 'Chronicle'} · capture {entry.source.capture_id?.slice(0, 8) ?? '—'}. The
            entry body above is yours; this block is what you first wrote.
          </p>
        </Details>
      )}

      {(revisions ?? []).length > 0 && (
        <Details summary={`History (${revisions?.length ?? 0} earlier version${(revisions?.length ?? 0) === 1 ? '' : 's'})`}>
          <div className="list">
            {(revisions ?? []).map((revision) => (
              <div className="list__item" key={revision.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <div style={{ flex: 1 }}>
                  <div className="text-sm">{revision.title || 'Untitled'}</div>
                  <div className="text-xs text-faint">
                    {formatDateTime(revision.created_at, timezone)} · saved by {revision.saved_by}
                    {revision.reason ? ` · ${revision.reason}` : ''}
                  </div>
                </div>
                <Button size="sm" variant="quiet" onClick={() => void restore(revision.id)}>
                  Restore
                </Button>
              </div>
            ))}
          </div>
        </Details>
      )}

      <p className="text-xs text-faint">
        Created <RelativeTime at={entry.created_at} timezone={timezone} /> · revision {entry.rev}
      </p>

      <EntryDialog open={editing} entry={entry} onClose={() => setEditing(false)} />

      {confirmDelete && (
        <div className="dialog" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setConfirmDelete(false)}>
          <div className="dialog__panel" role="dialog" aria-modal="true" aria-label="Delete entry">
            <div className="dialog__header">
              <h2 style={{ fontSize: 'var(--font-size-lg)' }}>Delete this entry?</h2>
              <IconButton name="close" label="Cancel" onClick={() => setConfirmDelete(false)} />
            </div>
            <div className="dialog__body">
              <p className="text-sm">
                The entry moves to Deleted and can be restored later. Tasks created from it keep their
                text but lose the link.
              </p>
            </div>
            <div className="dialog__footer">
              <Button variant="quiet" onClick={() => setConfirmDelete(false)}>
                Keep
              </Button>
              <Button variant="danger" onClick={() => void remove()}>
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
