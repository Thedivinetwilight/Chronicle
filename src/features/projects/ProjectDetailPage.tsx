/**
 * A project's dossier: what it is, where the evidence stands, its milestones,
 * open tasks and journal. Every section is a link into the real records.
 */

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useChronicle } from '../../state/ChronicleContext';
import { useEntries, useMilestones, useProject, useTasks } from '../../state/hooks';
import { Badge, Button, IconButton } from '../../ui/primitives';
import { Icon } from '../../ui/Icon';
import { EmptyState, ErrorState, SkeletonList } from '../../ui/states';
import { MarkdownView } from '../../ui/MarkdownView';
import { MetaLine, RelativeTime } from '../../ui/format';
import { DeleteProjectDialog, ProjectDialog } from './ProjectDialog';
import { EntryDialog } from '../journal/EntryDialog';
import { MilestoneDialog } from '../milestones/MilestoneDialog';
import { formatDateLabel } from '../../domain/time';
import type { JournalEntry } from '../../domain/types';

export function ProjectDetailPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { timezone, store, toast, openCapture } = useChronicle();
  const project = useProject(projectId);
  const entries = useEntries({ projectId: projectId ?? null, limit: 40 });
  const tasks = useTasks({ projectId: projectId ?? null });
  const milestones = useMilestones({ projectId: projectId ?? null });

  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [entryDraft, setEntryDraft] = useState<JournalEntry | 'new' | null>(null);
  const [milestoneDraft, setMilestoneDraft] = useState<'new' | null>(null);

  if (project === undefined) return <SkeletonList rows={4} />;
  if (project === null) return <ErrorState title="Project not found" message="It may have been purged on this device." />;

  const openTasks = (tasks ?? []).filter((task) => task.status !== 'done' && task.status !== 'dropped');

  const completeTask = async (id: string, title: string) => {
    await store.updateTask(id, { status: 'done' });
    toast(`Marked “${title}” done.`, { tone: 'success' });
  };

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__title">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <IconButton name="chevron-left" label="Back to projects" onClick={() => navigate('/projects')} />
            <h1>{project.name}</h1>
          </div>
          <MetaLine>
            <Badge tone="accent">{project.status}</Badge>
            <Badge>{project.stage}</Badge>
            {project.privacy === 'private' ? (
              <Badge>
                <Icon name="lock" size={10} className="icon-inline" /> private
              </Badge>
            ) : null}
            {project.started_on ? <span>started {formatDateLabel(project.started_on)}</span> : null}
            {project.target_date ? <span>· target {formatDateLabel(project.target_date)}</span> : null}
            <span>· updated</span>
            <RelativeTime at={project.updated_at} timezone={timezone} />
          </MetaLine>
        </div>
        <div className="page__actions">
          <IconButton name="edit" label="Edit project" onClick={() => setEditing(true)} />
          <IconButton name="trash" label="Delete project" onClick={() => setDeleting(true)} />
        </div>
      </header>

      {(project.summary || project.objectives) && (
        <section className="card">
          <div className="card__body form-stack form-stack--tight">
            {project.summary ? <p className="text-muted">{project.summary}</p> : null}
            {project.objectives ? <MarkdownView source={project.objectives} /> : null}
            {project.tags.length > 0 && (
              <div className="chip-row">
                {project.tags.map((tag) => (
                  <span key={tag} className="tagchip">
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      <section aria-label="Milestones">
        <div className="section-head">
          <h2 className="section-head__title">Milestones</h2>
          <Button size="sm" variant="quiet" icon="plus" onClick={() => setMilestoneDraft('new')}>
            Add
          </Button>
        </div>
        {(milestones ?? []).length === 0 ? (
          <p className="text-sm text-faint">No milestones yet. They appear when something is actually achieved.</p>
        ) : (
          <div className="card list">
            {(milestones ?? []).map((milestone) => (
              <div className="list__item entrycard" key={milestone.id}>
                <div className="entrycard__title">
                  <Icon name="flag" size={15} className="icon-inline" />
                  <span>{milestone.title}</span>
                  <Badge tone={milestone.status === 'achieved' ? 'success' : 'neutral'}>{milestone.status}</Badge>
                  <Badge tone={milestone.verification === 'verified' ? 'success' : 'warning'}>{milestone.verification}</Badge>
                </div>
                <MetaLine>
                  <span>{formatDateLabel(milestone.date)}</span>
                  {milestone.evidence.length > 0 ? <span>· {milestone.evidence.length} evidence</span> : null}
                </MetaLine>
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-label="Open tasks">
        <div className="section-head">
          <h2 className="section-head__title">Open tasks</h2>
        </div>
        {openTasks.length === 0 ? (
          <p className="text-sm text-faint">Nothing open.</p>
        ) : (
          <div className="card list">
            {openTasks.map((task) => (
              <div className="list__item row-task" key={task.id}>
                <button
                  type="button"
                  className="row-check"
                  aria-label={`Mark “${task.title}” done`}
                  onClick={() => void completeTask(task.id, task.title)}
                >
                  <Icon name="check" size={14} />
                </button>
                <span className="text-sm row-task__title">{task.title}</span>
                {task.due_on ? <Badge>{formatDateLabel(task.due_on)}</Badge> : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-label="Journal">
        <div className="section-head">
          <h2 className="section-head__title">Journal ({(entries ?? []).length})</h2>
          <div className="chip-row">
            <Button size="sm" variant="quiet" icon="plus" onClick={() => openCapture()}>
              Capture
            </Button>
            <Button size="sm" variant="quiet" icon="plus" onClick={() => setEntryDraft('new')}>
              Write
            </Button>
          </div>
        </div>
        {(entries ?? []).length === 0 ? (
          <EmptyState icon="book" title="No entries in this project yet">
            Capture a sentence and Chronicle will file it here.
          </EmptyState>
        ) : (
          <div className="card list">
            {(entries ?? []).map((entry) => (
              <Link className="list__item entrycard" key={entry.id} to={`/journal/${entry.id}`}>
                <div className="entrycard__title">{entry.title || 'Untitled'}</div>
                <div className="entrycard__preview">{entry.summary || entry.body}</div>
                <MetaLine>
                  <Badge>{entry.type}</Badge>
                  <RelativeTime at={entry.occurred_at} timezone={timezone} />
                  {entry.evidence_level !== 'concept' ? <Badge tone="accent">{entry.evidence_level}</Badge> : null}
                </MetaLine>
              </Link>
            ))}
          </div>
        )}
      </section>

      <ProjectDialog open={editing} project={project} onClose={() => setEditing(false)} />
      <DeleteProjectDialog
        project={deleting ? project : null}
        onClose={() => setDeleting(false)}
        onDeleted={() => navigate('/projects')}
      />
      <EntryDialog
        open={entryDraft !== null}
        entry={entryDraft === 'new' ? null : entryDraft}
        defaultProjectId={project.id}
        onClose={() => setEntryDraft(null)}
      />
      <MilestoneDialog open={milestoneDraft !== null} projectId={project.id} onClose={() => setMilestoneDraft(null)} />
    </div>
  );
}
