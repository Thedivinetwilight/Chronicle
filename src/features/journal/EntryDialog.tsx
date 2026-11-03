/**
 * Write or edit an experience by hand.
 *
 * The body is never touched by Chronicle: what you type is what is stored.
 * Derived fields (title, summary, tags) are only suggested by capture, never
 * overwritten here.
 *
 * Reliability rules this form follows (milestone acceptance criteria):
 * - A failed save keeps every value in the form and shows what went wrong. The
 *   dialog only closes after the write has actually resolved.
 * - Repeat taps are ignored while a save is in flight (`busy` is checked before
 *   the state updates, and the button is disabled), so a slow write can never
 *   produce two records.
 * - Organisation is optional: an experience can be saved with no chapter, no
 *   path and no date.
 */

import { useEffect, useState } from 'react';
import { Dialog } from '../../ui/Dialog';
import { Button, Field, Select, Switch, TextArea, TextInput } from '../../ui/primitives';
import { Icon } from '../../ui/Icon';
import { useChronicle } from '../../state/ChronicleContext';
import { useChapters, usePaths, useProjects, ENTRY_TYPE_OPTIONS } from '../../state/hooks';
import type { EntryType, IsoDate, JournalEntry } from '../../domain/types';
import { localDateIso, zonedTimeToUtc } from '../../domain/time';
import { normalizeTags } from '../../domain/text';

export function EntryDialog({
  open,
  entry,
  defaultProjectId,
  initialBody,
  onClose,
  onSaved
}: {
  open: boolean;
  entry: JournalEntry | null;
  defaultProjectId?: string | null;
  /** Text to start a new experience from (e.g. a draft from Today). */
  initialBody?: string;
  onClose: () => void;
  onSaved?: (entry: JournalEntry) => void;
}) {
  const { store, toast } = useChronicle();
  const projects = useProjects({});
  const chapters = useChapters({ statuses: ['open'] });
  const paths = usePaths({ states: ['active', 'paused'] });

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [type, setType] = useState<EntryType>('note');
  const [projectId, setProjectId] = useState('');
  const [chapterId, setChapterId] = useState('');
  const [pathId, setPathId] = useState('');
  const [date, setDate] = useState('');
  const [noDate, setNoDate] = useState(false);
  const [tags, setTags] = useState('');
  const [isPrivate, setPrivate] = useState(true);
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [seededFor, setSeededFor] = useState<string | null>(null);
  const seedKey = open ? (entry?.id ?? 'new') : null;

  if (open && seededFor !== seedKey) {
    setSeededFor(seedKey);
    setTitle(entry?.title ?? '');
    setBody(entry?.body ?? initialBody ?? '');
    setType(entry?.type ?? 'note');
    setProjectId(entry?.project_id ?? defaultProjectId ?? '');
    setChapterId(entry?.links?.chapter_ids[0] ?? '');
    setPathId(entry?.links?.path_ids[0] ?? '');
    setDate(localDateIso(entry?.occurred_at ?? new Date().toISOString(), 'UTC'));
    setNoDate(false);
    setTags((entry?.tags ?? []).join(', '));
    // New experiences are private unless the user says otherwise.
    setPrivate(entry ? entry.private : true);
    setPinned(entry?.pinned ?? false);
    setError(null);
  }

  /* Re-derive the local date from the store timezone once it is known, so a
     device outside UTC does not see the wrong day pre-filled. */
  const { timezone } = useChronicle();
  useEffect(() => {
    if (!open || seededFor !== seedKey) return;
    setDate(localDateIso(entry?.occurred_at ?? new Date().toISOString(), timezone));
    // Only when the dialog opens for a given record.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timezone, seedKey]);

  if (!open) return null;

  const save = async () => {
    if (busy) return; // repeat taps are ignored, not queued
    if (!body.trim() && !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const occurredAt = noDate
        ? entry?.occurred_at ?? new Date().toISOString()
        : zonedTimeToUtc(date as IsoDate, 12, 0, timezone);
      const changes = {
        title: title.trim(),
        body,
        type,
        project_id: projectId || null,
        occurred_at: occurredAt,
        occurred_precision: noDate ? ('unknown' as const) : entry ? entry.occurred_precision : ('day' as const),
        occurred_source: noDate ? ('user' as const) : entry ? entry.occurred_source : ('user' as const),
        tags: normalizeTags(tags.split(',')),
        private: isPrivate,
        pinned,
        visibility: isPrivate ? ('private' as const) : ('circles' as const)
      };
      const saved = entry
        ? await store.updateEntry(entry.id, changes, 'manual edit')
        : await store.createEntry(changes);
      // Chapter and path membership are written after the entry exists, in one
      // store transaction each; a failure here is reported, not hidden.
      const currentChapters = entry?.links?.chapter_ids ?? [];
      const currentPaths = entry?.links?.path_ids ?? [];
      const nextChapters = chapterId ? [chapterId] : [];
      const nextPaths = pathId ? [pathId] : [];
      if (
        nextChapters.join() !== currentChapters.join() ||
        nextPaths.join() !== currentPaths.join()
      ) {
        await store.setEntryRelations(saved.id, { chapter_ids: nextChapters, path_ids: nextPaths });
      }
      toast(entry ? 'Experience updated.' : 'Experience saved.', { tone: 'success' });
      onSaved?.(saved);
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The experience could not be saved. Nothing was written — your text is still here.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={entry ? 'Edit experience' : 'New experience'}
      wide
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void save()}
            busy={busy}
            disabled={!body.trim() && !title.trim()}
          >
            {entry ? 'Save changes' : 'Save experience'}
          </Button>
        </>
      }
    >
      <div className="form-stack">
        {error ? (
          <p className="note note--danger" role="alert">
            <Icon name="alert" size={16} className="note__icon" />
            <span>
              {error}
              <br />
              <span className="text-xs">Nothing was saved. Everything you typed is still in the form.</span>
            </span>
          </p>
        ) : null}
        <Field label="Title" hint="Optional — the first line is used when empty.">
          <TextInput value={title} onChange={setTitle} maxLength={200} />
        </Field>
        <Field label="What happened?" required hint="Markdown is supported. Your words are stored exactly as written.">
          <TextArea value={body} onChange={setBody} rows={8} />
        </Field>
        <div className="grid-fields">
          <Field label="Type">
            <Select label="Type" value={type} onChange={setType} options={ENTRY_TYPE_OPTIONS} />
          </Field>
          <Field label="Chapter" hint="Optional. Eras are on the Chapters page.">
            <Select
              label="Chapter"
              value={chapterId}
              onChange={setChapterId}
              options={[
                { value: '', label: 'No chapter' },
                ...(chapters ?? []).map((chapter) => ({ value: chapter.id, label: chapter.name }))
              ]}
            />
          </Field>
          <Field label="Path" hint="Optional. A goal or interest this belongs to.">
            <Select
              label="Path"
              value={pathId}
              onChange={setPathId}
              options={[
                { value: '', label: 'No path' },
                ...(paths ?? []).map((path) => ({ value: path.id, label: path.title }))
              ]}
            />
          </Field>
          <Field label="Project" hint="The older, engineering-oriented container.">
            <Select
              label="Project"
              value={projectId}
              onChange={setProjectId}
              options={[
                { value: '', label: 'No project' },
                ...(projects ?? []).map((project) => ({ value: project.id, label: project.name }))
              ]}
            />
          </Field>
        </div>
        <div className="grid-fields">
          <Field label="When it happened">
            <TextInput type="date" value={date} onChange={setDate} />
          </Field>
          <Field label="Tags" hint="Comma separated.">
            <TextInput value={tags} onChange={setTags} />
          </Field>
        </div>
        <div className="switch-row">
          <Switch
            checked={noDate}
            onChange={setNoDate}
            label="I don’t know when this happened"
            description="Stored honestly as an unknown date instead of guessing today."
          />
          <Switch
            checked={isPrivate}
            onChange={setPrivate}
            label="Private"
            description="Only you can see it. This build has no sharing, so everything stays on this device either way."
          />
          <Switch checked={pinned} onChange={setPinned} label="Pinned" description="Keeps this experience at the top." />
        </div>
      </div>
    </Dialog>
  );
}
