/**
 * A single entry, with its full provenance: what was written, what Chronicle
 * suggested, what changed since, and the ability to go back (§16).
 */

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useChronicle } from '../../state/ChronicleContext';
import {
  useChapters,
  useEntry,
  useMemoryLinks,
  usePaths,
  useProject,
  useRevisions,
  useTasks
} from '../../state/hooks';
import { Badge, Button, Details, IconButton } from '../../ui/primitives';
import { Icon } from '../../ui/Icon';
import { ErrorState, SkeletonList } from '../../ui/states';
import { MarkdownView } from '../../ui/MarkdownView';
import { MetaLine, RelativeTime, WhenExactly, precisionNote } from '../../ui/format';
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
  /* A memory's place in the archive is half of what it means. These read the
     published connections the user made (chapter, path, links), so the page can
     offer a way back to the places this experience belongs to. */
  const links = useMemoryLinks({ recordId: entryId, status: 'confirmed' });
  const note = entry ? precisionNote(entry.occurred_precision) : null;
  /* One read each, then look up by id — a hook cannot be called inside a map. */
  const allChapters = useChapters();
  const allPaths = usePaths();
  const chapterNames = (entry?.links?.chapter_ids ?? [])
    .map((id) => allChapters?.find((chapter) => chapter.id === id))
    .filter((chapter): chapter is NonNullable<typeof chapter> => Boolean(chapter));
  const pathNames = (entry?.links?.path_ids ?? [])
    .map((id) => allPaths?.find((path) => path.id === id))
    .filter((path): path is NonNullable<typeof path> => Boolean(path));

  if (entry === undefined) return <SkeletonList rows={3} />;
  if (entry === null) return <ErrorState title="Entry not found" message="It may have been deleted or purged." />;

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
      <header className="page__header entry__header">
        <div className="page__title">
          <div className="page__actions" style={{ gap: 'var(--space-2)' }}>
            <IconButton name="chevron-left" label="Back to journal" onClick={() => navigate('/journal')} />
            <h1>{entry.title || 'Untitled'}</h1>
          </div>
          {/* One quiet line. The type, the exact date and the revision number are
              all in the margin below or in History; a reader wants to know when
              this happened, and whether the date is a guess. */}
          <MetaLine>
            <WhenExactly at={entry.occurred_at} precision={entry.occurred_precision} timezone={timezone} />
            {note ? <span>· {note}</span> : null}
            {entry.pinned ? <span>· pinned</span> : null}
            {entry.private ? (
              <span>
                · <Icon name="lock" size={10} className="icon-inline" /> private
              </span>
            ) : null}
          </MetaLine>
        </div>
        <div className="page__actions">
          <IconButton name="edit" label="Edit entry" onClick={() => setEditing(true)} />
          <IconButton name="trash" label="Delete entry" onClick={() => setConfirmDelete(true)} />
        </div>
      </header>

      {/* The writing, not a box around the writing. A card frame here made a
          page of prose look like a form field, and the frame set the line length
          to the width of the page — 121 characters at 1440px. `.entry__prose`
          holds the reading measure. */}
      <article className="entry__prose">
        <MarkdownView source={entry.body} />

        {(chapterNames.length > 0 || pathNames.length > 0 || project || entry.tags.length > 0) && (
          <div className="entry__where">
            {chapterNames.length > 0 || pathNames.length > 0 ? (
              <p className="entry__where-line">
                <span className="entry__where-label">Filed in</span>{' '}
                {chapterNames.map((chapter, index) => (
                  <span key={chapter.id}>
                    {index > 0 ? ', ' : ''}
                    <Link to={`/chapters/${chapter.id}`}>{chapter.name}</Link>
                  </span>
                ))}
                {chapterNames.length > 0 && pathNames.length > 0 ? ', ' : ''}
                {pathNames.map((path, index) => (
                  <span key={path.id}>
                    {index > 0 ? ', ' : ''}
                    <Link to={`/paths/${path.id}`}>{path.title}</Link>
                  </span>
                ))}
              </p>
            ) : null}
            {project ? (
              <p className="entry__where-line">
                <span className="entry__where-label">Project</span>{' '}
                <Link to={`/projects/${project.id}`}>{project.name}</Link>
              </p>
            ) : null}
            {entry.tags.length > 0 ? (
              <div className="chip-row" style={{ marginTop: 'var(--space-1)' }}>
                {entry.tags.map((tag) => (
                  <Link key={tag} to={`/search?q=${encodeURIComponent(tag)}`} className="tagchip">
                    #{tag}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </article>

      {/* The map is the other half of a memory: where it sits among everything
          else. Offering it once, at the end of the writing, is enough. */}
      <p className="entry__map-link">
        <Link to={`/map?focus=${entry.id}`}>
          <Icon name="compass" size={13} className="icon-inline" /> Show on the Life map
        </Link>
        {(links ?? []).length > 0 ? (
          <span className="text-faint">
            {' '}
            · {links?.length} connection{links?.length === 1 ? '' : 's'} there
          </span>
        ) : null}
      </p>

      {tasks.length > 0 && (
        <section aria-label="Tasks from this entry">
          <div className="section-head">
            <h2 className="section-head__title">Tasks from this entry</h2>
          </div>
          <div className="card list">
            {tasks.map((task) => (
              <div className="list__item row-task" key={task.id}>
                <button
                  type="button"
                  className="row-check"
                  aria-pressed={task.status === 'done'}
                  aria-label={`Mark “${task.title}” done`}
                  onClick={async () => {
                    await store.updateTask(task.id, { status: task.status === 'done' ? 'todo' : 'done' });
                  }}
                >
                  <Icon name={task.status === 'done' ? 'check' : 'task'} size={15} />
                </button>
                <span className="text-sm" style={{ textDecoration: task.status === 'done' ? 'line-through' : undefined }}>
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
          <pre className="provenance">{entry.source.original_input}</pre>
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
        {/* Provenance for the curious, kept to one line: when it was written, and
            how much it has changed. The verbatim capture and the revision list
            are below, folded. */}
        Written <RelativeTime at={entry.created_at} timezone={timezone} />
        {entry.evidence.length > 0 ? ` · ${entry.evidence.length} reference${entry.evidence.length === 1 ? '' : 's'}` : ''}
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
