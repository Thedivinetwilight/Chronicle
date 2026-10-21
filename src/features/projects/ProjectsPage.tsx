/**
 * Projects (§20): the places work happens. A project is a container, not a
 * dashboard: name, status, a line of intent, and the records inside it.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useChronicle } from '../../state/ChronicleContext';
import { useProjects } from '../../state/hooks';
import type { Project } from '../../domain/types';
import { Badge, Button, Segmented } from '../../ui/primitives';
import { Icon } from '../../ui/Icon';
import { EmptyState, SkeletonList } from '../../ui/states';
import { RelativeTime } from '../../ui/format';
import { ProjectDialog } from './ProjectDialog';

const STATUS_TONE: Record<Project['status'], 'neutral' | 'accent' | 'success' | 'warning' | 'danger'> = {
  idea: 'neutral',
  research: 'neutral',
  planning: 'neutral',
  prototyping: 'accent',
  development: 'accent',
  testing: 'warning',
  operational: 'success',
  paused: 'warning',
  archived: 'neutral'
};

export function ProjectsPage() {
  const { timezone } = useChronicle();
  const [scope, setScope] = useState<'active' | 'archived' | 'all'>('active');
  const [editing, setEditing] = useState<Project | 'new' | null>(null);

  const projects = useProjects({
    includeArchived: scope !== 'active',
    statuses: scope === 'active' ? undefined : undefined
  });

  const visible = (projects ?? []).filter((project) => {
    const archived = project.status === 'archived' || Boolean(project.deleted_at);
    if (scope === 'archived') return archived;
    if (scope === 'active') return !archived;
    return true;
  });

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__title">
          <h1>Projects</h1>
          <span className="text-xs text-faint">{visible.length} shown</span>
        </div>
        <div className="page__actions">
          <Segmented
            label="Scope"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'archived', label: 'Archived' },
              { value: 'all', label: 'All' }
            ]}
          />
          <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
            New
          </Button>
        </div>
      </header>

      {projects === undefined ? <SkeletonList rows={4} /> : null}

      {projects && visible.length === 0 ? (
        <EmptyState icon="folder" title={scope === 'archived' ? 'Nothing archived' : 'No projects yet'}>
          Projects group journal entries, tasks and milestones. Create one for anything you keep
          coming back to.
          <div style={{ marginTop: 'var(--space-3)' }}>
            <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
              Create a project
            </Button>
          </div>
        </EmptyState>
      ) : null}

      {visible.length > 0 ? (
      <div className="card list">
        {visible.map((project) => (
          <Link key={project.id} className="list__item entrycard" to={`/projects/${project.id}`}>
            <div className="entrycard__title">
              <span>{project.name}</span>
              <Badge tone={STATUS_TONE[project.status]}>{project.status}</Badge>
              {project.privacy === 'private' ? (
                <Badge>
                  <Icon name="lock" size={10} className="icon-inline" /> private
                </Badge>
              ) : null}
            </div>
            {project.summary ? <div className="entrycard__preview">{project.summary}</div> : null}
            <div className="entrycard__meta">
              <span>{project.stage}</span>
              <span>·</span>
              <RelativeTime at={project.updated_at} timezone={timezone} />
              {project.tags.slice(0, 4).map((tag) => (
                <span key={tag} className="tagchip">
                  #{tag}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>
      ) : null}

      <ProjectDialog
        open={editing !== null}
        project={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
