/**
 * The conversational capture engine's interface (§28).
 *
 * Three modes, one code path:
 *  - quick:      save directly when the reading is confident and unambiguous
 *  - review:     always show what Chronicle understood before writing
 *  - autonomous: write without asking (opt-in; corrections stay available)
 *
 * The original message is preserved verbatim in every case and shown in the
 * review sheet. Nothing is written before validation, and a failed write is
 * reported as a failure — the text stays in the composer.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { Badge, Button, Field, Segmented, Select, Switch, TextArea, TextInput } from '../../ui/primitives';
import { useChronicle } from '../../state/ChronicleContext';
import { getAiSessionKey } from '../../state/aiSession';
import { ENTRY_TYPE_OPTIONS } from '../../state/hooks';
import type {
  CaptureProposal,
  CommitResult,
  ProposedMilestone,
  ProposedRecord,
  ProposedTask,
  ProposedEntry
} from '../../domain/capture/types';
import type { EntryType, IsoDate, JournalEntry, Milestone } from '../../domain/types';
import { localDateIso, zonedTimeToUtc } from '../../domain/time';
import { normalizeTags } from '../../domain/text';
// The capture engine ships inside the main bundle on purpose: saving must
// never depend on a runtime network fetch. A lazily-imported analyzer chunk
// whose request stalls (flaky mobile network, proxy, service-worker edge
// cases) leaves `await import()` pending forever — no timeout, no rejection —
// which froze the Save button with a spinner and no error to show. Capture is
// a core feature (§28), so its code is loaded with the app, not on demand.
import { analyzeCapture } from '../../domain/capture/analyzer';
import { selectProvider } from '../../domain/capture/provider';

type Phase = 'compose' | 'working' | 'review' | 'saved';

/**
 * Optional stage tracer for field diagnosis. Enable by setting
 * `localStorage['chronicle:debug'] = 'capture'` in the browser console.
 * Logs stage names and elapsed milliseconds only — never capture text,
 * API keys, or record contents.
 */
function traceStage(stage: string, startedAt?: number, detail?: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (localStorage.getItem('chronicle:debug') !== 'capture') return;
  } catch {
    return;
  }
  const elapsed = startedAt !== undefined ? ` +${Math.round(performance.now() - startedAt)}ms` : '';
  console.debug(`[chronicle:capture] ${stage}${elapsed}${detail ? ` (${detail})` : ''}`);
}

interface UndoSnapshot {
  created: { kind: 'entries' | 'tasks' | 'milestones'; id: string }[];
  previous: { kind: 'entries' | 'milestones'; record: JournalEntry | Milestone }[];
}

export function CaptureDialog() {
  const {
    store,
    settings,
    timezone,
    captureOpen,
    captureSeed,
    closeCapture,
    toast,
    lastCommit,
    setLastCommit
  } = useChronicle();

  const [phase, setPhase] = useState<Phase>('compose');
  const [input, setInput] = useState(captureSeed);
  const [mode, setMode] = useState<'quick' | 'review' | 'autonomous'>(settings?.capture_mode ?? 'quick');
  const [proposal, setProposal] = useState<CaptureProposal | null>(null);
  const [records, setRecords] = useState<ProposedRecord[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [answered, setAnswered] = useState<Record<string, string>>({});
  const [result, setResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [correction, setCorrection] = useState('');
  const [correctionProposal, setCorrectionProposal] = useState<CaptureProposal | null>(null);
  const undoRef = useRef<UndoSnapshot | null>(null);
  const projects = useMemo(() => [], []);
  void projects;

  const projectOptions = useRef<{ value: string; label: string }[]>([]);

  /* Seed text arrives when the sheet opens from the Home composer. */
  useEffect(() => {
    if (captureOpen) {
      setInput(captureSeed);
      setPhase('compose');
      setProposal(null);
      setRecords([]);
      setResult(null);
      setError(null);
      setCorrection('');
      setCorrectionProposal(null);
    }
  }, [captureOpen, captureSeed]);

  const projectList = useRef<{ id: string; name: string }[]>([]);

  // Guards every user-triggered capture action. Repeat taps while a save is
  // in flight are ignored instead of racing a second pipeline run.
  const busyRef = useRef(false);

  const analyzeAndRoute = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const startedAt = performance.now();
    let stage = startedAt;
    const mark = (name: string) => {
      traceStage(name, stage);
      stage = performance.now();
    };
    mark('save:start');
    try {
      const context = await store.captureContext();
      mark('capture-context:done');
      projectList.current = context.projects.map((project) => ({ id: project.id, name: project.name }));
      projectOptions.current = [
        { value: '', label: 'No project' },
        ...projectList.current.map((project) => ({ value: project.id, label: project.name }))
      ];

      const provider = settings
        ? selectProvider(
            {
              enabled: settings.ai.enabled,
              provider: settings.ai.provider,
              endpoint: settings.ai.endpoint,
              model: settings.ai.model,
              allowPrivate: settings.ai.allow_private
            },
            getAiSessionKey()
          )
        : null;
      const analysed = provider
        ? await provider.analyze(text, context)
        : { proposal: analyzeCapture({ input: text, context }), usedRemote: false, notices: [] };
      mark(analysed.usedRemote ? 'analyze:done(remote)' : 'analyze:done(local)');

      const found = analysed.proposal;
      const providerNotices = 'notices' in analysed ? (analysed.notices as string[]) : [];
      setNotices(providerNotices);

      const needsReview =
        mode === 'review' || found.requires_review || found.understanding.questions.length > 0;

      if (mode !== 'autonomous' && needsReview) {
        setProposal(found);
        setRecords(found.records.map((record) => ({ ...record })));
        setPhase('review');
        mark('review:shown');
      } else {
        await commit(found);
        mark('commit:done');
      }
    } catch (cause) {
      traceStage('save:error', startedAt, cause instanceof Error ? cause.name : 'unknown');
      setError(cause instanceof Error ? cause.message : 'Capture failed.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [input, mode, settings, store]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = useCallback(
    async (nextProposal: CaptureProposal) => {
      setBusy(true);
      setError(null);
      const startedAt = performance.now();
      traceStage('commit:start');
      try {
        const commitResult = await store.commitCapture(nextProposal);
        traceStage('commit:done', startedAt, `ok=${String(commitResult.ok)} duplicate=${String(commitResult.duplicate)}`);
        if (!commitResult.ok) {
          setError(commitResult.errors.map((item) => item.message).join(' '));
          setPhase('compose');
          return;
        }
        undoRef.current = {
          created: [
            ...commitResult.created.entries.map((id) => ({ kind: 'entries' as const, id })),
            ...commitResult.created.tasks.map((id) => ({ kind: 'tasks' as const, id })),
            ...commitResult.created.milestones.map((id) => ({ kind: 'milestones' as const, id }))
          ],
          previous: []
        };
        setResult(commitResult);
        setPhase('saved');
        const savedCount =
          commitResult.created.entries.length +
          commitResult.created.tasks.length +
          commitResult.created.milestones.length +
          commitResult.updated.length;
        toast(
          commitResult.duplicate
            ? 'That capture was already saved; nothing was duplicated.'
            : `Saved ${savedCount} record${savedCount === 1 ? '' : 's'}.`,
          {
            tone: 'success',
            action: {
              label: 'Undo',
              run: () => {
                void undoLast();
              }
            }
          }
        );
      } catch (cause) {
        // An AbortError here means the storage watchdog rolled a wedged
        // transaction back (see dexieStore.captureWriter). Aborts are atomic,
        // so nothing was partially saved and the text is still in the composer.
        const aborted = cause instanceof Error && cause.name === 'AbortError';
        traceStage('commit:error', startedAt, cause instanceof Error ? cause.name : 'unknown');
        setError(
          aborted
            ? 'Saving was taking too long, so Chronicle stopped and rolled the write back.'
            : cause instanceof Error
              ? cause.message
              : 'Saving failed.'
        );
        setPhase('compose');
      } finally {
        setBusy(false);
      }
    },
    [store, toast] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const undoLast = useCallback(async () => {
    const snapshot = undoRef.current;
    if (!snapshot) return;
    for (const created of snapshot.created) {
      if (created.kind === 'entries') await store.deleteEntry(created.id).catch(() => undefined);
      if (created.kind === 'tasks') await store.deleteTask(created.id).catch(() => undefined);
      if (created.kind === 'milestones') await store.deleteMilestone(created.id).catch(() => undefined);
    }
    for (const previous of snapshot.previous) {
      if (previous.kind === 'entries') {
        await store.updateEntry(previous.record.id, previous.record).catch(() => undefined);
      } else {
        await store.updateMilestone(previous.record.id, previous.record).catch(() => undefined);
      }
    }
    undoRef.current = null;
    await setLastCommit(null);
    setPhase('compose');
    setResult(null);
    toast('The capture was undone.');
  }, [store, setLastCommit, toast]);

  const applyCorrectionsAndCommit = useCallback(async () => {
    if (!proposal) return;
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const next: CaptureProposal = { ...proposal, records: records.map((record) => ({ ...record })) };
      // Snapshot records that will be updated so Undo can restore them.
      const previous: UndoSnapshot['previous'] = [];
      for (const record of next.records) {
        if (record.kind !== 'update' || !record.include) continue;
        const target = record.update.target_id;
        const entry = await store.getEntry(target);
        if (entry) previous.push({ kind: 'entries', record: entry });
        else {
          const milestone = await store.getMilestone(target);
          if (milestone) previous.push({ kind: 'milestones', record: milestone });
        }
      }
      undoRef.current = { created: [], previous };
      await commit(next);
    } catch (cause) {
      traceStage('review-commit:error', undefined, cause instanceof Error ? cause.name : 'unknown');
      setError(cause instanceof Error ? cause.message : 'Saving failed.');
      setPhase('compose');
    } finally {
      busyRef.current = false;
    }
  }, [proposal, records, store, commit]);

  const runCorrection = useCallback(async () => {
    const text = correction.trim();
    if (!text) return;
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const context = await store.captureContext();
      const found = analyzeCapture({ input: text, context });
      const hasUpdate = found.records.some((record) => record.kind === 'update');
      if (!hasUpdate) {
        toast('Chronicle could not tie that to a previous record, so nothing was changed.', {
          tone: 'danger'
        });
      } else {
        found.records.forEach((record) => {
          record.include = true;
        });
        setCorrectionProposal(found);
      }
    } catch (cause) {
      traceStage('correction:error', undefined, cause instanceof Error ? cause.name : 'unknown');
      setError(cause instanceof Error ? cause.message : 'That correction could not be applied.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [correction, store, toast]);

  const applyCorrectionProposal = useCallback(async () => {
    if (!correctionProposal) return;
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      undoRef.current = { created: [], previous: [] };
      for (const record of correctionProposal.records) {
        if (record.kind !== 'update') continue;
        const entry = await store.getEntry(record.update.target_id);
        if (entry) undoRef.current.previous.push({ kind: 'entries', record: entry });
      }
      await commit(correctionProposal);
      setCorrectionProposal(null);
      setCorrection('');
    } catch (cause) {
      traceStage('correction-commit:error', undefined, cause instanceof Error ? cause.name : 'unknown');
      setError(cause instanceof Error ? cause.message : 'Saving failed.');
    } finally {
      busyRef.current = false;
    }
  }, [correctionProposal, store, commit]);

  const updateRecord = useCallback((key: string, patch: (record: ProposedRecord) => ProposedRecord) => {
    setRecords((current) => current.map((record) => (record.key === key ? patch(record) : record)));
  }, []);

  const entryRecords = records.filter((record): record is ProposedEntry => record.kind === 'entry');
  const taskRecords = records.filter((record): record is ProposedTask => record.kind === 'task');
  const milestoneRecords = records.filter((record): record is ProposedMilestone => record.kind === 'milestone');

  const questions = proposal?.understanding.questions ?? [];
  const issues = proposal?.issues ?? [];

  return (
    <Dialog
      open={captureOpen}
      onClose={closeCapture}
      title={phase === 'saved' ? 'Saved' : phase === 'review' ? 'Review before saving' : 'Capture'}
      wide={phase === 'review'}
      footer={
        phase === 'compose' ? (
          <>
            <Button variant="quiet" onClick={closeCapture}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void analyzeAndRoute()} busy={busy} disabled={!input.trim()}>
              {mode === 'review' ? 'Review' : 'Save'}
            </Button>
          </>
        ) : phase === 'review' ? (
          <>
            <Button variant="quiet" onClick={() => setPhase('compose')}>
              Back
            </Button>
            <Button variant="primary" onClick={() => void applyCorrectionsAndCommit()} busy={busy}>
              Save to archive
            </Button>
          </>
        ) : phase === 'saved' ? (
          <>
            <Button variant="quiet" onClick={() => void undoLast()}>
              Undo
            </Button>
            <Button variant="primary" onClick={closeCapture}>
              Done
            </Button>
          </>
        ) : undefined
      }
    >
      {phase === 'compose' && (
        <div className="form-stack">
          <Field
            label="Your message"
            htmlFor="capture-input"
            hint="Write it the way you would say it. Dates, projects and tasks are picked up from the sentence."
          >
            <TextArea
              id="capture-input"
              value={input}
              onChange={setInput}
              rows={6}
              autoFocus
              placeholder="Fixed the retrieval bug in JARVIS today; ranking still fails on ambiguous references. Need to re-run the benchmark tomorrow."
            />
          </Field>
          <Field label="Mode">
            <Segmented
              label="Capture mode"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'quick', label: 'Quick' },
                { value: 'review', label: 'Review' },
                { value: 'autonomous', label: 'Autonomous' }
              ]}
            />
          </Field>
          <p className="text-xs text-faint">
            {mode === 'quick'
              ? 'Saves straight away when the reading is confident; anything ambiguous is shown for review first.'
              : mode === 'review'
                ? 'Always shows what Chronicle understood before anything is written.'
                : 'Writes without asking. Corrections remain available afterwards; enable only if that suits you.'}
          </p>
          {error ? (
            <p className="notice notice--danger" role="alert">
              <Icon name="alert" size={15} className="icon-inline" />
              <span>
                {error} Your text is still here — nothing was lost.
              </span>
            </p>
          ) : null}
        </div>
      )}

      {phase === 'review' && proposal && (
        <div className="form-stack">
          <section className="proposal" aria-label="Your original words">
            <div className="proposal__head">
              <span className="section-head__title">Your words, kept verbatim</span>
              <Badge tone={proposal.analyzer === 'remote' ? 'warning' : 'neutral'}>
                {proposal.analyzer === 'remote' ? 'model-assisted' : 'on-device'}
              </Badge>
            </div>
            <div className="proposal__body">
              <pre className="provenance">{proposal.input}</pre>
              {notices.length > 0 ? (
                <div className="form-stack form-stack--tight">
                  {notices.map((notice) => (
                    <p key={notice} className="text-sm text-muted">
                      <Icon name="info" size={14} className="icon-inline" /> {notice}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          </section>

          {questions.length > 0 ? (
            <section className="proposal" aria-label="Questions from Chronicle">
              <div className="proposal__head">
                <h3 className="text-sm">Chronicle wants to confirm</h3>
              </div>
              <div className="proposal__body">
                {questions.map((question) => (
                  <div key={question.id} className="form-stack form-stack--tight">
                    <p className="text-sm">{question.question}</p>
                    {question.options.length > 0 ? (
                      <div className="chip-row">
                        {question.options.map((option) => (
                          <Button
                            key={option.label}
                            size="sm"
                            variant={answered[question.id] === option.label ? 'primary' : 'quiet'}
                            onClick={() => setAnswered((current) => ({ ...current, [question.id]: option.label }))}
                          >
                            {option.label}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {entryRecords.map((record) => (
            <section className="proposal" key={record.key} aria-label="Proposed journal entry">
              <div className="proposal__head">
                <h3 className="text-sm">Journal entry</h3>
                <Switch
                  checked={record.include}
                  onChange={(next) => updateRecord(record.key, (item) => ({ ...item, include: next }))}
                  label="Save this entry"
                />
              </div>
              <div className="proposal__body">
                <Field label="Title">
                  <TextInput
                    value={record.entry.title}
                    onChange={(next) =>
                      updateRecord(record.key, (item) =>
                        item.kind === 'entry' ? { ...item, entry: { ...item.entry, title: next } } : item
                      )
                    }
                  />
                </Field>
                <div className="grid-fields">
                  <Field label="Type">
                    <Select
                      label="Entry type"
                      value={record.entry.type ?? 'note'}
                      onChange={(next) =>
                        updateRecord(record.key, (item) =>
                          item.kind === 'entry'
                            ? { ...item, entry: { ...item.entry, type: next as EntryType } }
                            : item
                        )
                      }
                      options={ENTRY_TYPE_OPTIONS}
                    />
                  </Field>
                  <Field label="Project">
                    <Select
                      label="Project"
                      value={record.entry.project_id ?? ''}
                      onChange={(next) =>
                        updateRecord(record.key, (item) =>
                          item.kind === 'entry'
                            ? { ...item, entry: { ...item.entry, project_id: next || null } }
                            : item
                        )
                      }
                      options={projectOptions.current}
                    />
                  </Field>
                  <Field label="When it happened">
                    <TextInput
                      type="date"
                      value={localDateIso(record.entry.occurred_at ?? proposal.created_at, timezone)}
                      onChange={(next) =>
                        updateRecord(record.key, (item) =>
                          item.kind === 'entry'
                            ? {
                                ...item,
                                entry: {
                                  ...item.entry,
                                  occurred_at: zonedTimeToUtc(next as IsoDate, 12, 0, timezone),
                                  occurred_precision: 'day',
                                  occurred_source: 'user'
                                }
                              }
                            : item
                        )
                      }
                    />
                  </Field>
                </div>
                <Field label="Tags" hint="Comma separated.">
                  <TextInput
                    value={(record.entry.tags ?? []).join(', ')}
                    onChange={(next) =>
                      updateRecord(record.key, (item) =>
                        item.kind === 'entry' ? { ...item, entry: { ...item.entry, tags: normalizeTags(next.split(',')) } } : item
                      )
                    }
                  />
                </Field>
                <Switch
                  checked={Boolean(record.entry.private)}
                  onChange={(next) =>
                    updateRecord(record.key, (item) => (item.kind === 'entry' ? { ...item, entry: { ...item.entry, private: next } } : item))
                  }
                  label="Private"
                  description="Private entries are excluded from AI context and from shared exports."
                />
                <p className="text-xs text-faint">
                  Evidence level: <strong>{record.entry.evidence_level ?? 'concept'}</strong>
                  {record.reason ? ` — ${record.reason}` : ''}
                </p>
              </div>
            </section>
          ))}

          {taskRecords.length > 0 ? (
            <section className="proposal" aria-label="Proposed tasks">
              <div className="proposal__head">
                <h3 className="text-sm">Tasks</h3>
              </div>
              <div className="proposal__body">
                {taskRecords.map((record) => (
                  <div key={record.key} className="form-stack form-stack--tight">
                    <div className="proposal__row">
                      <Switch
                        checked={record.include}
                        onChange={(next) => updateRecord(record.key, (item) => ({ ...item, include: next }))}
                        label={`Include task: ${record.task.title || 'untitled'}`}
                        hiddenLabel
                      />
                      <TextInput
                        value={record.task.title ?? ''}
                        onChange={(next) =>
                          updateRecord(record.key, (item) =>
                            item.kind === 'task' ? { ...item, task: { ...item.task, title: next } } : item
                          )
                        }
                      />
                    </div>
                    <div className="proposal__row">
                      <label className="text-xs text-faint" htmlFor={`due-${record.key}`}>
                        Due
                      </label>
                      <div style={{ maxWidth: 180, flex: 1 }}>
                        <TextInput
                          id={`due-${record.key}`}
                          type="date"
                          value={record.task.due_on ?? ''}
                          onChange={(next) =>
                            updateRecord(record.key, (item) =>
                              item.kind === 'task'
                                ? { ...item, task: { ...item.task, due_on: next || null, due_precision: next ? 'day' : 'unknown' } }
                                : item
                            )
                          }
                        />
                      </div>
                      {record.reason ? <span className="text-xs text-faint">{record.reason}</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {milestoneRecords.length > 0 ? (
            <section className="proposal" aria-label="Proposed milestones">
              <div className="proposal__head">
                <h3 className="text-sm">Milestones</h3>
              </div>
              <div className="proposal__body">
                {milestoneRecords.map((record) => (
                  <div key={record.key} className="proposal__row">
                    <Switch
                      checked={record.include}
                      onChange={(next) => updateRecord(record.key, (item) => ({ ...item, include: next }))}
                      label={`Include milestone: ${record.milestone.title || 'untitled'}`}
                      hiddenLabel
                    />
                    <TextInput
                      value={record.milestone.title ?? ''}
                      onChange={(next) =>
                        updateRecord(record.key, (item) =>
                          item.kind === 'milestone' ? { ...item, milestone: { ...item.milestone, title: next } } : item
                        )
                      }
                    />
                  </div>
                ))}
                <p className="text-xs text-faint">
                  Milestones start as claims. Verification changes only when you attach evidence.
                </p>
              </div>
            </section>
          ) : null}

          {issues.length > 0 ? (
            <div className="notice notice--info" role="status">
              <Icon name="info" size={15} className="icon-inline" />
              <span>
                {issues.map((issue) => issue.message).join(' ')}
              </span>
            </div>
          ) : null}

          {settings?.ai.enabled && settings.ai.provider === 'http' ? (
            <p className="text-xs text-faint">
              AI assistance is on. The model suggested structure only; your text was never rewritten.
            </p>
          ) : null}
        </div>
      )}

      {phase === 'saved' && result && (
        <div className="form-stack">
          <div className="proposal__row">
            <div
              className="state__halo"
              style={{ background: 'var(--color-success-subtle)', color: 'var(--color-success)' }}
            >
              <Icon name="check" size={24} />
            </div>
            <div>
              <h3>Saved to your archive</h3>
              <p className="text-sm text-muted">
                {result.created.entries.length > 0 && `Journal entry saved. `}
                {result.created.tasks.length > 0 && `${result.created.tasks.length} task${result.created.tasks.length === 1 ? '' : 's'} added. `}
                {result.created.milestones.length > 0 && `${result.created.milestones.length} milestone recorded. `}
                {result.updated.length > 0 && `${result.updated.length} record updated. `}
              </p>
            </div>
          </div>
          <Field label="Correct this capture" hint='For example: “That entry belongs to VERONICA instead.” or “Don’t create a separate task.”'>
            <div className="chip-row">
              <TextInput value={correction} onChange={setCorrection} placeholder="Say what should change…" />
              <Button onClick={() => void runCorrection()} busy={busy} disabled={!correction.trim()}>
                Apply
              </Button>
            </div>
          </Field>
          {correctionProposal && (
            <div className="card">
              <div className="card__body text-sm form-stack form-stack--tight">
                <p>Chronicle proposes:</p>
                <ul style={{ margin: 0, paddingLeft: 'var(--space-4)' }}>
                  {correctionProposal.records.map((record) => (
                    <li key={record.key}>
                      {record.kind === 'update'
                        ? `Update ${record.update.target_kind}: ${record.update.target_label} — ${Object.entries(
                            record.update.changes ?? {}
                          )
                            .map(([field, value]) => `${field} → ${String(value)}`)
                            .join(', ')}`
                        : 'A new record'}
                    </li>
                  ))}
                </ul>
                <div className="chip-row">
                  <Button variant="primary" size="sm" onClick={() => void applyCorrectionProposal()}>
                    Apply correction
                  </Button>
                  <Button variant="quiet" size="sm" onClick={() => setCorrectionProposal(null)}>
                    Discard
                  </Button>
                </div>
              </div>
            </div>
          )}
          {lastCommit ? (
            <p className="text-xs text-faint">
              Session capture <code>{lastCommit.capture_id.slice(0, 8)}</code> is active for corrections.
            </p>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
