/**
 * The unified timeline (§20): everything that happened, in order, grouped by
 * local day. Filters narrow it; a cursor paginates it. Nothing is invented:
 * an entry shows where it happened, a milestone where it was achieved, a task
 * where it completed or falls due.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useChronicle } from '../../state/ChronicleContext';
import { useProjects, useTimeline } from '../../state/hooks';
import type { TimelineEvent, TimelineKind } from '../../data/store';
import { localDateIso } from '../../domain/time';
import { Badge, Button, Segmented, Select } from '../../ui/primitives';
import { Icon, type IconName } from '../../ui/Icon';
import { EmptyState, SkeletonList } from '../../ui/states';
import { DayHeader, MetaLine, RelativeTime } from '../../ui/format';

const KIND_ICON: Record<TimelineKind, IconName> = {
  entry: 'book',
  milestone: 'flag',
  task: 'task',
  project: 'folder'
};

const KIND_LABEL: Record<TimelineKind, string> = {
  entry: 'Journal',
  milestone: 'Milestone',
  task: 'Task',
  project: 'Project'
};

export function TimelinePage() {
  const { timezone } = useChronicle();
  const projects = useProjects({});
  const [kindFilter, setKindFilter] = useState<'all' | TimelineKind>('all');
  const [projectId, setProjectId] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [pages, setPages] = useState<TimelineEvent[][]>([]);

  const filter = useMemo(
    () => ({
      kinds: kindFilter === 'all' ? undefined : ([kindFilter] as TimelineKind[]),
      projectIds: projectId ? [projectId] : undefined,
      limit: 40,
      before: cursor
    }),
    [kindFilter, projectId, cursor]
  );

  const events = useTimeline(filter);

  const visible = useMemo(() => {
    const extra = pages.flat();
    if (!events) return extra.length > 0 ? extra : undefined;
    const seen = new Set(events.map((event) => event.id));
    return [...extra.filter((event) => !seen.has(event.id)), ...events];
  }, [events, pages]);

  const loadMore = () => {
    if (!events || events.length === 0) return;
    setPages((current) => [...current, events]);
    setCursor(events[events.length - 1]?.occurred_at);
  };

  const changeFilter = (next: { kind?: 'all' | TimelineKind; project?: string }) => {
    setPages([]);
    setCursor(undefined);
    if (next.kind !== undefined) setKindFilter(next.kind);
    if (next.project !== undefined) setProjectId(next.project);
  };

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__title">
          <h1>Timeline</h1>
          <span className="text-xs text-faint">Everything recorded, in order.</span>
        </div>
      </header>

      <div className="page__controls">
        <Segmented
          label="Record kind"
          value={kindFilter}
          onChange={(next) => changeFilter({ kind: next })}
          options={[
            { value: 'all', label: 'All' },
            { value: 'entry', label: 'Journal' },
            { value: 'milestone', label: 'Milestones' },
            { value: 'task', label: 'Tasks' },
            { value: 'project', label: 'Projects' }
          ]}
        />
        <div className="field" style={{ flex: '0 1 220px' }}>
          <Select
            label="Project"
            value={projectId}
            onChange={(next) => changeFilter({ project: next })}
            options={[
              { value: '', label: 'All projects' },
              ...(projects ?? []).map((project) => ({ value: project.id, label: project.name }))
            ]}
          />
        </div>
      </div>

      {visible === undefined ? <SkeletonList rows={5} /> : null}

      {visible && visible.length === 0 ? (
        <EmptyState icon="history" title="Nothing here yet">
          Capture something, or clear the filters, and the timeline fills in.
        </EmptyState>
      ) : null}

      {visible && visible.length > 0 && (
        <div className="timeline">
          {visible.map((event, index) => {
            const day = event.date || localDateIso(event.occurred_at, timezone);
            const previous = visible[index - 1];
            const newDay = !previous || (previous.date || localDateIso(previous.occurred_at, timezone)) !== day;
            return (
              <div className="timeline__day" key={event.id}>
                {newDay ? <DayHeader date={day} timezone={timezone} /> : null}
                <Link className="list__item entrycard" to={event.path}>
                  <div className="entrycard__title">
                    <Icon name={KIND_ICON[event.kind]} size={15} className="icon-inline" />
                    <span>{event.title}</span>
                  </div>
                  <MetaLine>
                    <span>{KIND_LABEL[event.kind]}</span>
                    <span>·</span>
                    <RelativeTime at={event.occurred_at} timezone={timezone} />
                    {event.project_name ? (
                      <>
                        <span>·</span>
                        <span>{event.project_name}</span>
                      </>
                    ) : null}
                    {event.edited ? (
                      <>
                        <span>·</span>
                        <span>edited</span>
                      </>
                    ) : null}
                    {event.private ? (
                      <Badge>
                        <Icon name="lock" size={10} /> private
                      </Badge>
                    ) : null}
                    {event.evidence_level && event.evidence_level !== 'concept' ? (
                      <Badge tone="accent">{event.evidence_level}</Badge>
                    ) : null}
                  </MetaLine>
                  {event.subtitle ? <div className="entrycard__preview">{event.subtitle}</div> : null}
                </Link>
              </div>
            );
          })}
        </div>
      )}

      {events && events.length >= 40 ? (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Button variant="quiet" onClick={loadMore}>
            Load earlier
          </Button>
        </div>
      ) : null}
    </div>
  );
}
