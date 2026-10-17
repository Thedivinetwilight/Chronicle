/**
 * Create / edit a project, and the safe-delete flow (§20).
 *
 * Deleting a project never deletes its history by default: the project is
 * archived and its records are unlinked, so nothing a person wrote disappears
 * because a container went away.
 */

import { useEffect, useState } from 'react';
import { Dialog } from '../../ui/Dialog';
import { Button, Field, Select, Switch, TextArea, TextInput } from '../../ui/primitives';
import { useChronicle } from '../../state/ChronicleContext';
import type { EvidenceLevel, Project, ProjectStatus } from '../../domain/types';
import { normalizeTags } from '../../domain/text';

const STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: 'idea', label: 'Idea' },
  { value: 'research', label: 'Research' },
  { value: 'planning', label: 'Planning' },
  { value: 'prototyping', label: 'Prototyping' },
  { value: 'development', label: 'Development' },
  { value: 'testing', label: 'Testing' },
  { value: 'operational', label: 'Operational' },
  { value: 'paused', label: 'Paused' },
  { value: 'archived', label: 'Archived' }
];

const STAGE_OPTIONS: { value: EvidenceLevel; label: string }[] = [
  { value: 'concept', label: 'Concept' },
  { value: 'researched', label: 'Researched' },
  { value: 'designed', label: 'Designed' },
  { value: 'implemented', label: 'Implemented' },
  { value: 'tested', label: 'Tested' },
  { value: 'verified', label: 'Verified' },
  { value: 'deployed', label: 'Deployed' }
];

export function ProjectDialog({
  open,
  project,
  onClose
}: {
  open: boolean;
  project: Project | null;
  onClose: () => void;
}) {
  const { store, toast } = useChronicle();
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [objectives, setObjectives] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('idea');
  const [stage, setStage] = useState<EvidenceLevel>('concept');
  const [tags, setTags] = useState('');
  const [aliases, setAliases] = useState('');
  const [privacy, setPrivacy] = useState<'private' | 'shareable'>('private');
  const [startedOn, setStartedOn] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(project?.name ?? '');
    setSummary(project?.summary ?? '');
    setObjectives(project?.objectives ?? '');
    setStatus(project?.status ?? 'idea');
    setStage(project?.stage ?? 'concept');
    setTags((project?.tags ?? []).join(', '));
    setAliases((project?.aliases ?? []).join(', '));
    setPrivacy(project?.privacy ?? 'private');
    setStartedOn(project?.started_on ?? '');
    setTargetDate(project?.target_date ?? '');
  }, [project]);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const input = {
        name: name.trim(),
        summary: summary.trim() || undefined,
        objectives: objectives.trim() || undefined,
        status,
        stage,
        tags: normalizeTags(tags.split(',')),
        aliases: aliases.split(',').map((alias) => alias.trim()).filter(Boolean),
        privacy,
        started_on: startedOn || null,
        target_date: targetDate || null
      };
      if (project) {
        await store.updateProject(project.id, input);
        toast(`Updated ${name.trim()}.`, { tone: 'success' });
      } else {
        await store.createProject(input);
        toast(`Created ${name.trim()}.`, { tone: 'success' });
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={project ? 'Edit project' : 'New project'}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} busy={busy} disabled={!name.trim()}>
            {project ? 'Save changes' : 'Create project'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <Field label="Name" required>
          <TextInput value={name} onChange={setName} placeholder="JARVIS" />
        </Field>
        <Field label="One-line summary">
          <TextInput value={summary} onChange={setSummary} placeholder="What this project is, in a sentence." />
        </Field>
        <Field label="Objectives" hint="Optional. Markdown is fine.">
          <TextArea value={objectives} onChange={setObjectives} rows={3} />
        </Field>
        <div style={{ display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          <Field label="Status">
            <Select label="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
          </Field>
          <Field label="Evidence stage" hint="Where the work actually stands.">
            <Select label="Evidence stage" value={stage} onChange={setStage} options={STAGE_OPTIONS} />
          </Field>
          <Field label="Started">
            <TextInput type="date" value={startedOn} onChange={setStartedOn} />
          </Field>
          <Field label="Target date">
            <TextInput type="date" value={targetDate} onChange={setTargetDate} />
          </Field>
        </div>
        <Field label="Tags" hint="Comma separated.">
          <TextInput value={tags} onChange={setTags} placeholder="ai, retrieval" />
        </Field>
        <Field label="Aliases" hint="Other names Chronicle should recognise in your writing.">
          <TextInput value={aliases} onChange={setAliases} placeholder="assistant, jarvis-lite" />
        </Field>
        <Switch
          checked={privacy === 'private'}
          onChange={(next) => setPrivacy(next ? 'private' : 'shareable')}
          label="Private"
          description="Private projects are excluded from AI context and shared exports."
        />
      </div>
    </Dialog>
  );
}

/** Delete confirmation that shows exactly what will happen first. */
export function DeleteProjectDialog({
  project,
  onClose,
  onDeleted
}: {
  project: Project | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { store, toast } = useChronicle();
  const [children, setChildren] = useState<'unlink' | 'delete'>('unlink');
  const [impact, setImpact] = useState<{ entries: number; tasks: number; milestones: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!project) return;
    void store.projectImpact(project.id).then(setImpact);
  }, [project, store]);

  if (!project) return null;

  const remove = async () => {
    setBusy(true);
    try {
      await store.deleteProject(project.id, { children });
      toast(`${project.name} archived. You can restore it from Deleted.`, { tone: 'success' });
      onDeleted();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Delete ${project.name}?`}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Keep project
          </Button>
          <Button variant="danger" onClick={() => void remove()} busy={busy}>
            Archive project
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <p className="text-sm">
          The project is archived, not erased: it stays in your archive and in exports, and you can
          restore it later from Settings → Deleted.
        </p>
        {impact && (
          <p className="text-sm text-muted">
            It currently holds {impact.entries} journal entr{impact.entries === 1 ? 'y' : 'ies'}, {impact.tasks}{' '}
            task{impact.tasks === 1 ? '' : 's'} and {impact.milestones} milestone{impact.milestones === 1 ? '' : 's'}.
          </p>
        )}
        <Field label="What should happen to those records?">
          <Select
            label="Children"
            value={children}
            onChange={setChildren}
            options={[
              { value: 'unlink', label: 'Keep them, without the project link (recommended)' },
              { value: 'delete', label: 'Archive them with the project' }
            ]}
          />
        </Field>
      </div>
    </Dialog>
  );
}
