/**
 * Provider-independent capture interface (§28.12, §14).
 *
 * The local analyzer is the default and always works offline. A remote provider
 * is an *optional enhancement*: it may refine titles, summaries, tags, project
 * links and task extraction, but it can never
 *
 * - replace the user's original text,
 * - raise a claim above what the local analysis supports, or
 * - write anything to storage (it only proposes).
 *
 * Every remote response is treated as untrusted input and validated field by
 * field. Anything malformed falls back to the local proposal with an honest
 * notice; the interface never reports success for data it rejected.
 *
 * API keys are held in memory for the session only. They are never written to
 * the bundle, to localStorage, to IndexedDB or to an export.
 */

import { deterministicId } from '../ids';
import { normalizeWhitespace, truncate } from '../text';
import { isValidIsoDate, isValidIsoDateTime } from '../time';
import { classifyIntent } from './intent';
import { analyzeCapture } from './analyzer';
import { ENTRY_TYPES, EVIDENCE_LEVELS, DATE_PRECISIONS } from '../types';
import type { EntryType, EvidenceLevel, DatePrecision } from '../types';
import type {
  CaptureContext,
  CaptureProposal,
  ProposedRecord,
  ProposedTask
} from './types';

export interface ProviderOptions {
  captureId?: string;
  signal?: AbortSignal;
}

export interface ProviderResult {
  proposal: CaptureProposal;
  /** True when a remote model contributed fields to the proposal. */
  usedRemote: boolean;
  /** Honest, user-visible notices about what happened. */
  notices: string[];
}

export interface CaptureProvider {
  readonly id: string;
  readonly kind: 'local' | 'remote';
  readonly label: string;
  isAvailable(): boolean;
  /** Describe exactly what would leave the device, for the opt-in disclosure. */
  describeTransmission(input: string, context: CaptureContext): string[];
  analyze(input: string, context: CaptureContext, options?: ProviderOptions): Promise<ProviderResult>;
}

/* ------------------------------------------------------------------ *
 * Local provider (default)
 * ------------------------------------------------------------------ */

export const localProvider: CaptureProvider = {
  id: 'local',
  kind: 'local',
  label: 'On-device',
  isAvailable: () => true,
  describeTransmission: () => ['Nothing leaves this device.'],
  analyze: async (input, context, options) => ({
    proposal: analyzeCapture({ input, context, ...(options?.captureId ? { captureId: options.captureId } : {}) }),
    usedRemote: false,
    notices: []
  })
};

/* ------------------------------------------------------------------ *
 * Remote provider
 * ------------------------------------------------------------------ */

export interface RemoteProviderConfig {
  endpoint: string;
  model: string;
  /** Session-only secret. Never persisted, never exported. */
  apiKey: string;
  timeoutMs?: number;
  /** When false, entries that look personal are never sent. */
  allowPrivate?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

/** The exact JSON shape Chronicle asks a model to return. */
export const REMOTE_SCHEMA_DESCRIPTION = `Return JSON only, matching:
{
  "entry": {
    "title": string (<= 90 chars, derived from the user's words),
    "summary": string (<= 240 chars),
    "type": one of ${ENTRY_TYPES.join(' | ')},
    "tags": string[] (max 5, lowercase, hyphenated),
    "project_id": string | null (must be one of the ids in context.projects),
    "occurred_at": ISO-8601 UTC string | null,
    "occurred_precision": one of ${DATE_PRECISIONS.join(' | ')},
    "evidence_level": one of ${EVIDENCE_LEVELS.join(' | ')},
    "private": boolean
  },
  "tasks": [{ "title": string, "description": string | null, "due_on": "YYYY-MM-DD" | null }],
  "milestone": { "title": string, "description": string | null, "date": "YYYY-MM-DD" } | null,
  "notes": string[]
}
Rules: never invent facts, dates or results; keep the user's uncertainty; leave a
field null when the text does not support it.`;

export function createRemoteProvider(config: RemoteProviderConfig): CaptureProvider {
  const timeoutMs = config.timeoutMs ?? 12_000;
  const fetchImpl = config.fetchImpl ?? globalThis.fetch?.bind(globalThis);

  function buildPayload(input: string, context: CaptureContext): Record<string, unknown> {
    const allowPrivate = config.allowPrivate ?? false;
    return {
      schema: 'chronicle.capture.v1',
      instructions: REMOTE_SCHEMA_DESCRIPTION,
      now: (config.now?.() ?? new Date()).toISOString(),
      timezone: context.timezone,
      message: input,
      context: {
        projects: context.projects
          .filter((project) => !project.deleted_at && (allowPrivate || project.privacy !== 'private'))
          .slice(0, 40)
          .map((project) => ({
            id: project.id,
            name: project.name,
            aliases: project.aliases.slice(0, 5),
            status: project.status
          })),
        recent_entries: context.recentEntries
          .filter((entry) => !entry.deleted_at && (allowPrivate || !entry.private))
          .slice(0, 8)
          .map((entry) => ({
            id: entry.id,
            title: truncate(entry.title, 80),
            occurred_at: entry.occurred_at,
            type: entry.type
          })),
        open_tasks: context.openTasks
          .filter((task) => !task.deleted_at && task.status !== 'done')
          .slice(0, 20)
          .map((task) => ({ id: task.id, title: truncate(task.title, 80) })),
        existing_tags: context.existingTags.slice(0, 60)
      }
    };
  }

  const isAvailable = (): boolean => Boolean(config.endpoint && config.apiKey && fetchImpl);

  return {
    id: 'remote-http',
    kind: 'remote',
    label: `Remote model (${config.model || 'unnamed'})`,
    isAvailable,
    describeTransmission: (input, context) => {
      const allowPrivate = config.allowPrivate ?? false;
      const projectCount = context.projects.filter(
        (project) => !project.deleted_at && (allowPrivate || project.privacy !== 'private')
      ).length;
      const entryCount = context.recentEntries.filter(
        (entry) => !entry.deleted_at && (allowPrivate || !entry.private)
      ).length;
      return [
        `Your message (${input.length} characters) will be sent to ${config.endpoint}.`,
        `Up to ${Math.min(40, projectCount)} project names and ${Math.min(8, entryCount)} recent entry titles are included as context.`,
        allowPrivate
          ? 'Private entries and projects ARE included because you allowed it.'
          : 'Records you marked private are excluded.',
        'The model returns structured suggestions only. It cannot write to your archive.',
        `Requests time out after ${Math.round(timeoutMs / 1000)}s and fall back to on-device capture.`
      ];
    },
    analyze: async (input, context, options) => {
      const local = analyzeCapture({
        input,
        context,
        ...(options?.captureId ? { captureId: options.captureId } : {})
      });
      const notices: string[] = [];

      if (!isAvailable()) {
        return { proposal: withAnalyzer(local, 'local'), usedRemote: false, notices: ['Remote capture is not configured; the on-device analyzer was used.'] };
      }

      if (!(config.allowPrivate ?? false) && classifyIntent(input).isPersonal) {
        return {
          proposal: withAnalyzer(local, 'local'),
          usedRemote: false,
          notices: ['This reads as a personal reflection and private sending is off, so nothing was transmitted.']
        };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      if (options?.signal) {
        options.signal.addEventListener('abort', () => controller.abort(), { once: true });
      }

      let payload: unknown;
      try {
        const response = await fetchImpl(config.endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${config.apiKey}`,
            accept: 'application/json'
          },
          body: JSON.stringify(buildPayload(input, context)),
          signal: controller.signal
        });
        if (!response.ok) {
          notices.push(`The remote model responded with HTTP ${response.status}; the on-device result was kept.`);
          return { proposal: withAnalyzer(local, 'local'), usedRemote: false, notices };
        }
        payload = await response.json();
      } catch (error) {
        const aborted = error instanceof Error && error.name === 'AbortError';
        notices.push(
          aborted
            ? `The remote model timed out after ${Math.round(timeoutMs / 1000)}s; the on-device result was kept.`
            : 'The remote model could not be reached; the on-device result was kept.'
        );
        return { proposal: withAnalyzer(local, 'local'), usedRemote: false, notices };
      } finally {
        clearTimeout(timer);
      }

      const parsed = parseProviderPayload(payload, local, context);
      if (!parsed.ok) {
        notices.push(
          `The remote model returned invalid data (${truncate(parsed.reason, 90)}); nothing from it was used.`
        );
        return { proposal: withAnalyzer(local, 'local'), usedRemote: false, notices };
      }

      const merged = mergeRemoteIntoLocal(local, parsed.value, context, config.model);
      notices.push(`Structured fields were suggested by ${config.model || 'the remote model'} and validated locally.`);
      return { proposal: merged, usedRemote: true, notices };
    }
  };
}

function withAnalyzer(proposal: CaptureProposal, analyzer: 'local' | 'remote'): CaptureProposal {
  return { ...proposal, analyzer };
}

/* ------------------------------------------------------------------ *
 * Untrusted-output validation
 * ------------------------------------------------------------------ */

export interface RemoteSuggestion {
  title?: string;
  summary?: string;
  type?: EntryType;
  tags?: string[];
  projectId?: string | null;
  occurredAt?: string | null;
  occurredPrecision?: DatePrecision;
  evidenceLevel?: EvidenceLevel;
  isPrivate?: boolean;
  tasks: { title: string; description?: string; dueOn?: string | null }[];
  milestone?: { title: string; description?: string; date?: string } | null;
  notes: string[];
}

export function parseProviderPayload(
  payload: unknown,
  local: CaptureProposal,
  context: CaptureContext
): { ok: true; value: RemoteSuggestion } | { ok: false; reason: string } {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'response was not an object' };
  const raw = payload as Record<string, unknown>;
  const entry = raw.entry;
  if (entry !== undefined && (entry === null || typeof entry !== 'object')) {
    return { ok: false, reason: '"entry" was not an object' };
  }
  const entryRaw = (entry ?? {}) as Record<string, unknown>;
  const suggestion: RemoteSuggestion = { tasks: [], notes: [] };

  const knownProjectIds = new Set(context.projects.map((project) => project.id));

  if (typeof entryRaw.title === 'string') suggestion.title = truncate(normalizeWhitespace(entryRaw.title), 90);
  if (typeof entryRaw.summary === 'string') suggestion.summary = truncate(normalizeWhitespace(entryRaw.summary), 240);
  if (typeof entryRaw.type === 'string' && (ENTRY_TYPES as readonly string[]).includes(entryRaw.type)) {
    suggestion.type = entryRaw.type as EntryType;
  }
  if (Array.isArray(entryRaw.tags)) {
    suggestion.tags = entryRaw.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 5);
  }
  if (entryRaw.project_id === null) suggestion.projectId = null;
  else if (typeof entryRaw.project_id === 'string') {
    // A model may not invent a project: only ids we sent are accepted.
    if (knownProjectIds.has(entryRaw.project_id)) suggestion.projectId = entryRaw.project_id;
    else return { ok: false, reason: `"project_id" (${truncate(entryRaw.project_id, 24)}) is not a known project` };
  }
  if (typeof entryRaw.occurred_at === 'string') {
    if (!isValidIsoDateTime(entryRaw.occurred_at)) return { ok: false, reason: '"occurred_at" was not a valid UTC timestamp' };
    suggestion.occurredAt = new Date(entryRaw.occurred_at).toISOString();
  } else if (entryRaw.occurred_at === null) {
    suggestion.occurredAt = null;
  }
  if (typeof entryRaw.occurred_precision === 'string' && (DATE_PRECISIONS as readonly string[]).includes(entryRaw.occurred_precision)) {
    suggestion.occurredPrecision = entryRaw.occurred_precision as DatePrecision;
  }
  if (typeof entryRaw.evidence_level === 'string' && (EVIDENCE_LEVELS as readonly string[]).includes(entryRaw.evidence_level)) {
    suggestion.evidenceLevel = entryRaw.evidence_level as EvidenceLevel;
  }
  if (typeof entryRaw.private === 'boolean') suggestion.isPrivate = entryRaw.private;

  const tasks = raw.tasks;
  if (tasks !== undefined && !Array.isArray(tasks)) return { ok: false, reason: '"tasks" was not a list' };
  for (const task of (tasks ?? []) as unknown[]) {
    if (!task || typeof task !== 'object') return { ok: false, reason: 'a task was not an object' };
    const taskRaw = task as Record<string, unknown>;
    if (typeof taskRaw.title !== 'string' || !taskRaw.title.trim()) {
      return { ok: false, reason: 'a task had no title' };
    }
    const dueOn = taskRaw.due_on;
    if (dueOn !== null && dueOn !== undefined && (typeof dueOn !== 'string' || !isValidIsoDate(dueOn))) {
      return { ok: false, reason: 'a task had an invalid due_on date' };
    }
    suggestion.tasks.push({
      title: truncate(normalizeWhitespace(taskRaw.title), 120),
      ...(typeof taskRaw.description === 'string' ? { description: truncate(taskRaw.description, 600) } : {}),
      dueOn: typeof dueOn === 'string' ? dueOn : null
    });
  }

  const milestone = raw.milestone;
  if (milestone !== undefined && milestone !== null) {
    if (typeof milestone !== 'object') return { ok: false, reason: '"milestone" was not an object' };
    const milestoneRaw = milestone as Record<string, unknown>;
    if (typeof milestoneRaw.title !== 'string' || !milestoneRaw.title.trim()) {
      return { ok: false, reason: '"milestone" had no title' };
    }
    if (milestoneRaw.date !== undefined && milestoneRaw.date !== null && !isValidIsoDate(milestoneRaw.date)) {
      return { ok: false, reason: '"milestone" had an invalid date' };
    }
    suggestion.milestone = {
      title: truncate(normalizeWhitespace(milestoneRaw.title), 90),
      ...(typeof milestoneRaw.description === 'string' ? { description: truncate(milestoneRaw.description, 400) } : {}),
      ...(typeof milestoneRaw.date === 'string' ? { date: milestoneRaw.date } : {})
    };
  }

  if (Array.isArray(raw.notes)) {
    suggestion.notes = raw.notes.filter((note): note is string => typeof note === 'string').slice(0, 5);
  }

  // Guard against a model that returns nothing usable.
  const hasContent =
    suggestion.title || suggestion.summary || suggestion.type || (suggestion.tags?.length ?? 0) > 0 ||
    suggestion.tasks.length > 0 || suggestion.milestone || suggestion.projectId !== undefined;
  if (!hasContent) return { ok: false, reason: 'the response contained no usable fields' };

  void local;
  return { ok: true, value: suggestion };
}

/* ------------------------------------------------------------------ *
 * Merge
 * ------------------------------------------------------------------ */

/**
 * Merge validated remote suggestions into the local proposal.
 *
 * Honesty constraints enforced here:
 * - `body` and `source.original_input` are never touched.
 * - `evidence_level` may not be raised more than one step above the local
 *   reading, and never to `verified` without evidence.
 * - A remote project link is accepted only when the local analysis found no
 *   project, or when it agrees; otherwise it becomes a candidate question.
 * - Remote tasks/milestones are added as *unchecked* suggestions.
 */
export function mergeRemoteIntoLocal(
  local: CaptureProposal,
  suggestion: RemoteSuggestion,
  context: CaptureContext,
  model: string
): CaptureProposal {
  const records: ProposedRecord[] = local.records.map((record) => {
    if (record.kind !== 'entry') return record;
    const entry = { ...record.entry };
    const derived = { ...entry.derived };

    if (suggestion.title && !entry.title) {
      entry.title = suggestion.title;
      derived.title = true;
    }
    if (suggestion.summary && !entry.summary) {
      entry.summary = suggestion.summary;
      derived.summary = true;
    }
    if (suggestion.type && suggestion.type !== entry.type) {
      // Prefer the remote reading only when the local one was low confidence.
      if (local.understanding.type_confidence < 0.6) {
        entry.type = suggestion.type;
        derived.type = true;
      }
    }
    if (suggestion.tags && suggestion.tags.length > 0) {
      const merged = [...new Set([...(entry.tags ?? []), ...suggestion.tags])].slice(0, 6);
      entry.tags = merged;
      derived.tags = true;
    }
    if (suggestion.projectId && !entry.project_id) {
      const project = context.projects.find((candidate) => candidate.id === suggestion.projectId);
      if (project) {
        entry.project_id = project.id;
        derived.project = true;
      }
    }
    if (suggestion.occurredAt && entry.occurred_source === 'capture_time') {
      entry.occurred_at = suggestion.occurredAt;
      entry.occurred_precision = suggestion.occurredPrecision ?? 'day';
      entry.occurred_source = 'text';
      derived.occurred_at = true;
    }
    if (suggestion.evidenceLevel) {
      const allowed = capEvidence(local.understanding.evidence_level, suggestion.evidenceLevel, entry.evidence?.length ?? 0);
      if (allowed !== entry.evidence_level) {
        entry.evidence_level = allowed;
        derived.evidence_level = true;
      }
    }
    if (suggestion.isPrivate === true) entry.private = true;
    entry.derived = derived;

    return { ...record, entry };
  });

  // Remote-only tasks that the local analyzer missed: offered, not applied.
  const existingTitles = new Set<string>([
    ...records
      .filter((record): record is ProposedTask => record.kind === 'task')
      .map((record) => record.task.title ?? '')
      .filter((title): title is string => Boolean(title)),
    ...context.openTasks.map((task) => task.title)
  ]);
  const captureId = local.capture_id;
  const base = Date.parse(local.created_at) || 0;
  suggestion.tasks.slice(0, 3).forEach((task, index) => {
    const normalized = normalizeWhitespace(task.title).toLowerCase();
    if (existingTitles.has(task.title) || [...existingTitles].some((title) => title.toLowerCase() === normalized)) return;
    const entryRecord = records.find((record) => record.kind === 'entry');
    records.push({
      key: `task-remote-${index + 1}`,
      kind: 'task',
      include: false,
      confidence: 0.45,
      reason: `Suggested by ${model || 'the remote model'}; not created automatically.`,
      task: {
        id: deterministicId(`${captureId}:remote-task:${index}`, base),
        title: task.title,
        ...(task.description ? { description: task.description } : {}),
        project_id: entryRecord?.kind === 'entry' ? (entryRecord.entry.project_id ?? null) : null,
        status: 'todo',
        priority: 'normal',
        due_on: task.dueOn ?? null,
        due_precision: task.dueOn ? 'day' : 'unknown',
        tags: [],
        source_entry_id: entryRecord?.kind === 'entry' ? (entryRecord.entry.id ?? null) : null,
        derived: { title: true }
      }
    });
  });

  const notes = [
    ...local.understanding.notes,
    ...suggestion.notes.map((note) => `${model || 'Remote model'}: ${truncate(note, 140)}`),
    'Fields suggested by a remote model are marked in the review panel.'
  ];

  return {
    ...local,
    analyzer: 'remote',
    model,
    records,
    understanding: { ...local.understanding, notes: [...new Set(notes)] },
    // Anything a remote model touched must be reviewed.
    requires_review: true
  };
}

function capEvidence(local: EvidenceLevel, proposed: EvidenceLevel, evidenceCount: number): EvidenceLevel {
  const order = EVIDENCE_LEVELS as readonly EvidenceLevel[];
  const localIndex = order.indexOf(local);
  const proposedIndex = order.indexOf(proposed);
  let allowedIndex = Math.min(proposedIndex, localIndex + 1);
  if (order[allowedIndex] === 'verified' && evidenceCount === 0) allowedIndex = Math.min(allowedIndex, order.indexOf('tested'));
  if (order[allowedIndex] === 'deployed' && evidenceCount === 0) allowedIndex = Math.min(allowedIndex, order.indexOf('tested'));
  return order[Math.max(0, allowedIndex)] ?? local;
}

/** Choose the provider for a capture, based on settings and availability. */
export function selectProvider(
  settings: { enabled: boolean; provider: 'none' | 'http'; endpoint: string; model: string; allowPrivate: boolean },
  sessionApiKey: string | null,
  remoteFactory: (config: RemoteProviderConfig) => CaptureProvider = createRemoteProvider
): CaptureProvider {
  if (!settings.enabled || settings.provider !== 'http' || !settings.endpoint || !sessionApiKey) {
    return localProvider;
  }
  return remoteFactory({
    endpoint: settings.endpoint,
    model: settings.model,
    apiKey: sessionApiKey,
    allowPrivate: settings.allowPrivate
  });
}
