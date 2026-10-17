/**
 * Settings (§17, §19, §28.10): appearance, capture behaviour, the opt-in AI
 * disclosure, data portability and the recovery bin.
 *
 * Nothing here phones home. The AI section is explicit about what would leave
 * the device, and a key entered here lives only in this session's memory.
 */

import { useMemo, useRef, useState } from 'react';
import { useChronicle } from '../../state/ChronicleContext';
import { useDeleted, useStats } from '../../state/hooks';
import { setAiSessionKey } from '../../state/aiSession';
import { Badge, Button, Details, Field, IconButton, Segmented, Select, Switch, TextInput } from '../../ui/primitives';
import { EmptyState } from '../../ui/states';
import { APP_VERSION } from '../../domain/export/archive';
import { serializeArchive } from '../../domain/export/archive';
import { bundleToSingleMarkdown } from '../../domain/export/markdown';
import type { ImportStrategy } from '../../domain/import/archive';
import { deviceTimeZone, formatDateLabel } from '../../domain/time';

const COMMON_TIMEZONES = [
  'device',
  'UTC',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Europe/Berlin',
  'Europe/London',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Pacific/Auckland'
];

function download(filename: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function SettingsPage() {
  const { store, settings, updateSettings, timezone, toast } = useChronicle();
  const stats = useStats();
  const deleted = useDeleted();
  const fileInput = useRef<HTMLInputElement>(null);

  const [importPreview, setImportPreview] = useState<Awaited<ReturnType<typeof store.parseArchive>> | null>(null);
  const [strategy, setStrategy] = useState<ImportStrategy>('merge');
  const [backupAcknowledged, setBackupAcknowledged] = useState(false);
  const [aiKey, setAiKey] = useState('');
  const [busy, setBusy] = useState(false);

  const timezoneOptions = useMemo(() => {
    const options = COMMON_TIMEZONES.map((zone) => ({ value: zone, label: zone === 'device' ? `Device (${deviceTimeZone()})` : zone }));
    if (settings && settings.timezone !== 'device' && !options.some((option) => option.value === settings.timezone)) {
      options.push({ value: settings.timezone, label: settings.timezone });
    }
    return options;
  }, [settings]);

  if (!settings) return null;

  const exportJson = async () => {
    const archive = await store.buildArchive();
    download(`chronicle-${archive.exported_at.slice(0, 10)}.json`, 'application/json', serializeArchive(archive));
    toast('Archive exported. Keep it somewhere safe.', { tone: 'success' });
  };

  const exportMarkdown = async () => {
    const files = await store.markdownFiles();
    download(`chronicle-${new Date().toISOString().slice(0, 10)}.md`, 'text/markdown', bundleToSingleMarkdown(files));
    toast('Markdown bundle exported.', { tone: 'success' });
  };

  const onImportFile = async (file: File) => {
    setBusy(true);
    try {
      const text = await file.text();
      const parsed = await store.parseArchive(text);
      if (!parsed.ok) {
        toast(parsed.errors[0] ?? 'The file could not be read.', { tone: 'danger' });
        return;
      }
      setImportPreview(parsed);
      setBackupAcknowledged(false);
    } finally {
      setBusy(false);
    }
  };

  const applyImport = async () => {
    if (!importPreview || !importPreview.ok) return;
    setBusy(true);
    try {
      const plan = await store.planImport(importPreview.value, strategy);
      const report = await store.applyImport(plan, { backupAcknowledged });
      if (report.ok) {
        toast(report.summary, { tone: 'success' });
        setImportPreview(null);
      } else {
        toast(report.errors[0] ?? 'Import failed.', { tone: 'danger' });
      }
    } finally {
      setBusy(false);
    }
  };

  const purge = async () => {
    const count = await store.purgeDeleted();
    toast(`Purged ${count} record(s). This cannot be undone.`, { tone: 'success' });
  };

  return (
    <div className="page" style={{ maxWidth: '44rem', margin: '0 auto' }}>
      <header className="page__header">
        <div className="page__title">
          <h1>Settings</h1>
          <span className="text-xs text-faint">Chronicle {APP_VERSION} · stored on this device</span>
        </div>
      </header>

      <section className="card" aria-label="Appearance">
        <div className="card__header">
          <h2 className="text-sm">Appearance</h2>
        </div>
        <div className="card__body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <Field label="Theme">
            <Segmented
              label="Theme"
              value={settings.theme}
              onChange={(next) => void updateSettings({ theme: next })}
              options={[
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' }
              ]}
            />
          </Field>
          <Switch
            checked={settings.reduce_motion}
            onChange={(next) => void updateSettings({ reduce_motion: next })}
            label="Reduce motion"
            description="Disables animated transitions. The system preference is honoured either way."
          />
          <Switch
            checked={settings.sidebar_pinned}
            onChange={(next) => void updateSettings({ sidebar_pinned: next })}
            label="Pin the sidebar on wide screens"
          />
        </div>
      </section>

      <section className="card" aria-label="Capture">
        <div className="card__header">
          <h2 className="text-sm">Capture</h2>
        </div>
        <div className="card__body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <Field label="Default mode" hint="Quick saves directly when the reading is confident; review always asks first.">
            <Segmented
              label="Default capture mode"
              value={settings.capture_mode}
              onChange={(next) => void updateSettings({ capture_mode: next })}
              options={[
                { value: 'quick', label: 'Quick' },
                { value: 'review', label: 'Review' },
                { value: 'autonomous', label: 'Autonomous' }
              ]}
            />
          </Field>
          <Field label="Timezone" hint={`Dates are stored in UTC and shown in this zone. Currently: ${timezone}.`}>
            <Select
              label="Timezone"
              value={settings.timezone}
              onChange={(next) => void updateSettings({ timezone: next })}
              options={timezoneOptions}
            />
          </Field>
        </div>
      </section>

      <section className="card" aria-label="AI assistance">
        <div className="card__header">
          <h2 className="text-sm">AI assistance (opt-in)</h2>
          <Badge tone={settings.ai.enabled ? 'warning' : 'neutral'}>{settings.ai.enabled ? 'enabled' : 'off'}</Badge>
        </div>
        <div className="card__body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <p className="text-sm text-muted">
            Capture works entirely on this device. A model can be consulted for structure suggestions
            only if you turn this on; your text is never rewritten by it, and nothing is sent while it
            is off.
          </p>
          <Switch
            checked={settings.ai.enabled}
            onChange={(next) => void updateSettings({ ai: { ...settings.ai, enabled: next } })}
            label="Consult a model when capturing"
          />
          {settings.ai.enabled && (
            <>
              <Field label="Endpoint" hint="An OpenAI-compatible /chat/completions URL you control.">
                <TextInput
                  value={settings.ai.endpoint}
                  onChange={(next) => void updateSettings({ ai: { ...settings.ai, endpoint: next } })}
                  placeholder="https://example.invalid/v1/chat/completions"
                />
              </Field>
              <Field label="Model">
                <TextInput
                  value={settings.ai.model}
                  onChange={(next) => void updateSettings({ ai: { ...settings.ai, model: next } })}
                  placeholder="model-name"
                />
              </Field>
              <Field label="API key (this session only)" hint="Kept in memory for this session; never stored, exported or logged.">
                <TextInput
                  type="password"
                  value={aiKey}
                  onChange={(next) => {
                    setAiKey(next);
                    setAiSessionKey(next);
                  }}
                  placeholder="sk-…"
                />
              </Field>
              <Switch
                checked={settings.ai.allow_private}
                onChange={(next) => void updateSettings({ ai: { ...settings.ai, allow_private: next } })}
                label="Allow private records in AI context"
                description="Off by default: private entries and projects are never sent."
              />
              <p className="text-xs text-faint">
                If the request fails or times out, Chronicle falls back to on-device capture and tells
                you it did.
              </p>
            </>
          )}
        </div>
      </section>

      <section className="card" aria-label="Data">
        <div className="card__header">
          <h2 className="text-sm">Your data</h2>
          {stats ? <span className="text-xs text-faint">≈{(stats.bytesEstimate / 1024).toFixed(0)} KiB</span> : null}
        </div>
        <div className="card__body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {stats && (
            <p className="text-sm text-muted">
              {stats.projects} projects · {stats.entries} entries · {stats.milestones} milestones ·{' '}
              {stats.openTasks} open tasks · {stats.deletedRecords} in the bin
              {stats.oldestEntry ? ` · since ${formatDateLabel(stats.oldestEntry.slice(0, 10))}` : ''}
            </p>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <Button icon="download" onClick={() => void exportJson()}>
              Export archive (.json)
            </Button>
            <Button icon="download" onClick={() => void exportMarkdown()}>
              Export Markdown
            </Button>
            <Button icon="upload" busy={busy} onClick={() => fileInput.current?.click()}>
              Import archive
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onImportFile(file);
                event.target.value = '';
              }}
            />
          </div>
          <Button
            variant="quiet"
            onClick={async () => {
              const count = await store.rebuildSearchIndex();
              toast(`Search index rebuilt: ${count} record(s).`, { tone: 'success' });
            }}
          >
            Rebuild search index
          </Button>
          <p className="text-xs text-faint">
            Imports never overwrite newer local records. Replacing everything requires an explicit
            backup acknowledgement and is offered only after a preview.
          </p>
        </div>
      </section>

      <section className="card" aria-label="Deleted">
        <div className="card__header">
          <h2 className="text-sm">Deleted</h2>
          {(deleted ?? []).length > 0 ? (
            <Button size="sm" variant="danger" onClick={() => void purge()}>
              Purge all
            </Button>
          ) : null}
        </div>
        <div className="card__body">
          {(deleted ?? []).length === 0 ? (
            <p className="text-sm text-faint">Nothing deleted. Deletions stay recoverable here until purged.</p>
          ) : (
            <div className="list">
              {(deleted ?? []).map((item) => (
                <div className="list__item" key={`${item.kind}:${item.id}`} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <div style={{ flex: 1 }}>
                    <div className="text-sm">{item.label}</div>
                    <div className="text-xs text-faint">
                      {item.kind} · deleted {formatDateLabel(item.deleted_at.slice(0, 10))}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="quiet"
                    icon="undo"
                    onClick={async () => {
                      const restored = await store.restoreRecord(item.kind, item.id);
                      toast(restored ? 'Restored.' : 'Could not restore that record.', {
                        tone: restored ? 'success' : 'danger'
                      });
                    }}
                  >
                    Restore
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <Details summary="About Chronicle">
        <p className="text-sm text-muted">
          Chronicle {APP_VERSION} is a local-first record of your projects, experiments and days. Your
          archive lives in this browser's IndexedDB; the app works offline and sends nothing anywhere
          unless you enable AI assistance above.
        </p>
        <p className="text-sm text-muted" style={{ marginTop: 'var(--space-3)' }}>
          Install it: on Android use “Add to Home screen”; on desktop use the browser's install option.
          Once installed it launches standalone and keeps working without a network.
        </p>
      </Details>

      {importPreview && importPreview.ok && (
        <div className="dialog" role="presentation">
          <div className="dialog__panel" role="dialog" aria-modal="true" aria-label="Import preview">
            <div className="dialog__header">
              <h2 style={{ fontSize: 'var(--font-size-lg)' }}>Import preview</h2>
              <IconButton name="close" label="Cancel import" onClick={() => setImportPreview(null)} />
            </div>
            <div className="card__body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <p className="text-sm">
                The file holds {importPreview.value.records.projects.length} projects,{' '}
                {importPreview.value.records.entries.length} entries, {importPreview.value.records.milestones.length}{' '}
                milestones and {importPreview.value.records.tasks.length} tasks.
              </p>
              {importPreview.value.warnings.length > 0 && (
                <ul className="text-xs text-faint">
                  {importPreview.value.warnings.slice(0, 6).map((warning) => (
                    <li key={warning.message}>{warning.message}</li>
                  ))}
                </ul>
              )}
              <Field label="Strategy">
                <Select
                  label="Import strategy"
                  value={strategy}
                  onChange={setStrategy}
                  options={[
                    { value: 'merge', label: 'Merge — keep newer local records' },
                    { value: 'replace', label: 'Replace — overwrite this device (dangerous)' }
                  ]}
                />
              </Field>
              {strategy === 'replace' && (
                <Switch
                  checked={backupAcknowledged}
                  onChange={setBackupAcknowledged}
                  label="I have exported a backup of this device"
                  description="Replace deletes everything currently stored here."
                />
              )}
            </div>
            <div className="dialog__footer">
              <Button variant="quiet" onClick={() => setImportPreview(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                busy={busy}
                disabled={strategy === 'replace' && !backupAcknowledged}
                onClick={() => void applyImport()}
              >
                Import
              </Button>
            </div>
          </div>
        </div>
      )}

      {importPreview && !importPreview.ok && (
        <EmptyState icon="alert" title="That file could not be imported">
          {importPreview.errors.join(' ')}
        </EmptyState>
      )}
    </div>
  );
}

