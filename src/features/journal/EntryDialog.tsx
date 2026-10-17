/**
 * Write or edit a journal entry by hand.
 *
 * The body is never touched by Chronicle: what you type is what is stored.
 * Derived fields (title, summary, tags) are only suggested by capture, never
 * overwritten here.
 */

import { useEffect, useState } from 'react';
import { Dialog } from '../../ui/Dialog';
import { Button, Field, Select, Switch, TextArea, TextInput } from '../../ui/primitives';
import { useChronicle } from '../../state/ChronicleContext';
import { useProjects, ENTRY_TYPE_OPTIONS } from '../../state/hooks';
import type { EntryType, IsoDate, JournalEntry } from '../../domain/types';
import { localDateIso, zonedTimeToUtc } from '../../domain/time';
import { normalizeTags } from '../../domain/text';

export function EntryDialog({
  open,
  entry,
  defaultProjectId,
  onClose
}: {
  open: boolean;
  entry: JournalEntry | null;
  defaultProjectId?: string | null;
  onClose: () => void;
}) {
  const { store, toast, timezone } = useChronicle();
  const projects = useProjects({});
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [type, setType] = useState<EntryType>('note');
  const [projectId, setProjectId] = useState('');
  const [date, setDate] = useState('');
  const [tags, setTags] = useState('');
  const [isPrivate, setPrivate] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(entry?.title ?? '');
    setBody(entry?.body ?? '');
    setType(entry?.type ?? 'note');
    setProjectId(entry?.project_id ?? defaultProjectId ?? '');
    setDate(localDateIso(entry?.occurred_at ?? new Date().toISOString(), timezone));
    setTags((entry?.tags ?? []).join(', '));
    setPrivate(entry?.private ?? false);
    setPinned(entry?.pinned ?? false);
  }, [open, entry, defaultProjectId, timezone]);

  if (!open) return null;

  const save = async () => {
    if (!body.trim() && !title.trim()) return;
    setBusy(true);
    try {
      const changes = {
        title: title.trim(),
        body,
        type,
        project_id: projectId || null,
        occurred_at: zonedTimeToUtc(date as IsoDate, 12, 0, timezone),
        occurred_precision: entry ? entry.occurred_precision : ('day' as const),
        occurred_source: entry ? entry.occurred_source : ('user' as const),
        tags: normalizeTags(tags.split(',')),
        private: isPrivate,
        pinned
      };
      if (entry) {
        await store.updateEntry(entry.id, changes, 'manual edit');
        toast('Entry updated.', { tone: 'success' });
      } else {
        await store.createEntry(changes);
        toast('Entry saved.', { tone: 'success' });
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={entry ? 'Edit entry' : 'New entry'}
      wide
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} busy={busy} disabled={!body.trim() && !title.trim()}>
            {entry ? 'Save changes' : 'Save entry'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <Field label="Title" hint="Optional — the first line is used when empty.">
          <TextInput value={title} onChange={setTitle} />
        </Field>
        <Field label="What happened?" required hint="Markdown is supported. Your words are stored exactly as written.">
          <TextArea value={body} onChange={setBody} rows={10} />
        </Field>
        <div style={{ display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          <Field label="Type">
            <Select label="Type" value={type} onChange={setType} options={ENTRY_TYPE_OPTIONS} />
          </Field>
          <Field label="Project">
            <Select
              label="Project"
              value={projectId}
              onChange={setProjectId}
              options={[{ value: '', label: 'No project' }, ...(projects ?? []).map((p) => ({ value: p.id, label: p.name }))]}
            />
          </Field>
          <Field label="When it happened">
            <TextInput type="date" value={date} onChange={setDate} />
          </Field>
        </div>
        <Field label="Tags" hint="Comma separated.">
          <TextInput value={tags} onChange={setTags} />
        </Field>
        <div style={{ display: 'flex', gap: 'var(--space-5)', flexWrap: 'wrap' }}>
          <Switch checked={isPrivate} onChange={setPrivate} label="Private" description="Excluded from AI context and shared exports." />
          <Switch checked={pinned} onChange={setPinned} label="Pinned" description="Keeps this entry at the top of the journal." />
        </div>
      </div>
    </Dialog>
  );
}
