/**
 * Record a milestone by hand. Verification always starts as "claimed": a
 * milestone written in prose is a claim until evidence is attached (§15).
 */

import { useEffect, useState } from 'react';
import { Dialog } from '../../ui/Dialog';
import { Button, Field, Select, TextInput } from '../../ui/primitives';
import { useChronicle } from '../../state/ChronicleContext';
import type { IsoDate, MilestoneStatus } from '../../domain/types';
import { todayIso } from '../../domain/time';

export function MilestoneDialog({
  open,
  projectId,
  onClose
}: {
  open: boolean;
  projectId: string | null;
  onClose: () => void;
}) {
  const { store, toast, timezone } = useChronicle();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [status, setStatus] = useState<MilestoneStatus>('achieved');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle('');
      setDate(todayIso(timezone));
      setStatus('achieved');
    }
  }, [open, timezone]);

  if (!open) return null;

  const save = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await store.createMilestone({
        title: title.trim(),
        date: (date || todayIso(timezone)) as IsoDate,
        date_precision: 'day',
        project_id: projectId,
        status,
        verification: 'claimed',
        evidence: []
      });
      toast(`Milestone recorded: ${title.trim()}. Verification stays “claimed” until evidence is attached.`, {
        tone: 'success'
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New milestone"
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} busy={busy} disabled={!title.trim()}>
            Record milestone
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <Field label="What was achieved?" required>
          <TextInput value={title} onChange={setTitle} placeholder="First working retrieval pass" />
        </Field>
        <div className="grid-fields">
          <Field label="Date achieved">
            <TextInput type="date" value={date} onChange={setDate} />
          </Field>
          <Field label="Status">
            <Select
              label="Status"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'planned', label: 'Planned' },
                { value: 'achieved', label: 'Achieved' },
                { value: 'missed', label: 'Missed' },
                { value: 'dropped', label: 'Dropped' }
              ]}
            />
          </Field>
        </div>
        <p className="text-xs text-faint">
          Milestones created here start as claims. Attach evidence later from the project page to move
          verification to “supported” or “verified”.
        </p>
      </div>
    </Dialog>
  );
}
