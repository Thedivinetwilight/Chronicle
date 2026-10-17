/**
 * Home (§20): today at a glance and the fastest path into capture.
 * Deliberately not a dashboard — no metrics, no charts. Just what happened,
 * what is due, and where to write next.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useChronicle } from '../../state/ChronicleContext';
import { useProjects, useTasks, useTimeline } from '../../state/hooks';
import { addLocalDays, formatDateLabel, localDateIso, todayIso } from '../../domain/time';
import { Badge, Button, TextArea } from '../../ui/primitives';
import { Icon } from '../../ui/Icon';
import { EmptyState, SkeletonList } from '../../ui/states';
import { DayHeader, MetaLine, RelativeTime } from '../../ui/format';
import type { TimelineEvent } from '../../data/store';

const KIND_ICON = {
  entry: 'book',
  milestone: 'flag',
  task: 'task',
  project: 'folder'
} as const;

function EventRow({ event, timezone }: { event: TimelineEvent; timezone: string }) {
  return (
    <Link className="list__item entrycard" to={event.path}>
      <div className="entrycard__title">
        <Icon name={KIND_ICON[event.kind]} size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />
        {event.title}
      </div>
      <MetaLine>
        <RelativeTime at={event.occurred_at} timezone={timezone} />
        {event.project_name ? <span>· {event.project_name}</span> : null}
        {event.edited ? <span>· edited</span> : null}
        {event.private ? (
          <Badge>
            <Icon name="lock" size={10} /> private
          </Badge>
        ) : null}
      </MetaLine>
    </Link>
  );
}

export function HomePage() {
  const { timezone, openCapture, store, toast } = useChronicle();
  const [draft, setDraft] = useState('');
  const today = todayIso(timezone);

  const events = useTimeline({ from: addLocalDays(today, -1), limit: 30 });
  const tasks = useTasks({ statuses: ['todo', 'doing', 'blocked'], dueBefore: addLocalDays(today, 7) });
  const projects = useProjects({ limit: 6, includeArchived: false });

  const completeTask = async (id: string, title: string) => {
    await store.updateTask(id, { status: 'done' });
    toast(`Marked “${title}” done.`, { tone: 'success' });
  };

  const hasAnything = (events?.length ?? 0) > 0 || (projects?.length ?? 0) > 0;

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__title">
          <span className="text-xs text-faint">{formatDateLabel(today)}</span>
          <h1>What happened?</h1>
        </div>
      </header>

      <section className="card" aria-label="Quick capture">
        <div className="card__body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <label className="sr-only" htmlFor="home-capture">
            What happened?
          </label>
          <TextArea
            id="home-capture"
            rows={3}
            value={draft}
            onChange={setDraft}
            placeholder="Write what happened in plain words — Chronicle reads the date, project and follow-ups from the sentence."
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
            <Button
              variant="primary"
              disabled={!draft.trim()}
              onClick={() => {
                openCapture(draft);
                setDraft('');
              }}
            >
              Capture
            </Button>
          </div>
        </div>
      </section>

      {events === undefined || tasks === undefined ? <SkeletonList rows={3} /> : null}

      {tasks && tasks.length > 0 && (
        <section aria-label="Due soon">
          <h2 className="text-sm text-muted" style={{ marginBottom: 'var(--space-2)' }}>
            Due soon
          </h2>
          <div className="card list">
            {tasks.slice(0, 5).map((task) => (
              <div className="list__item" key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <button
                  type="button"
                  className="iconbtn"
                  style={{ width: 28, height: 28 }}
                  aria-label={`Mark “${task.title}” done`}
                  onClick={() => void completeTask(task.id, task.title)}
                >
                  <Icon name="check" size={15} />
                </button>
                <span style={{ flex: 1 }} className="text-sm">
                  {task.title}
                </span>
                {task.due_on ? <Badge tone={task.due_on < today ? 'warning' : 'neutral'}>{formatDateLabel(task.due_on)}</Badge> : null}
              </div>
            ))}
          </div>
        </section>
      )}

      <section aria-label="Recent activity">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-2)' }}>
          <h2 className="text-sm text-muted">Since yesterday</h2>
          <Link to="/timeline" className="text-xs">
            Full timeline
          </Link>
        </div>
        {events && events.length === 0 ? (
          <EmptyState icon="book" title="Nothing recorded yet">
            {hasAnything
              ? 'Your archive has older entries. Capture something today and it will appear here.'
              : 'Chronicle keeps a quiet, local record of your work and life. Start with one sentence about today.'}
            <div style={{ marginTop: 'var(--space-3)' }}>
              <Button variant="primary" icon="plus" onClick={() => openCapture()}>
                Capture your first entry
              </Button>
            </div>
          </EmptyState>
        ) : (
          <div className="card list">
            {events?.slice(0, 8).map((event, index) => {
              const previous = events[index - 1];
              const day = localDateIso(event.occurred_at, timezone);
              const newDay = !previous || localDateIso(previous.occurred_at, timezone) !== day;
              return (
                <div key={event.id}>
                  {newDay ? (
                    <div style={{ padding: 'var(--space-2) var(--space-4) 0' }}>
                      <DayHeader date={day} timezone={timezone} />
                    </div>
                  ) : null}
                  <EventRow event={event} timezone={timezone} />
                </div>
              );
            })}
          </div>
        )}
      </section>

      {projects && projects.length > 0 && (
        <section aria-label="Projects">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-2)' }}>
            <h2 className="text-sm text-muted">Projects</h2>
            <Link to="/projects" className="text-xs">
              All projects
            </Link>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            {projects.map((project) => (
              <Link key={project.id} to={`/projects/${project.id}`} className="tagchip">
                {project.name}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
