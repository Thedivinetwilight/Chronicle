/**
 * Markdown export (§17 item 2).
 *
 * Markdown is the "read it anywhere, keep it forever" format: journal entries,
 * project dossiers and a whole-archive file bundle. Every document starts with
 * YAML front matter carrying the record id, timestamps and relationships, so a
 * Markdown export can be read back into Chronicle by a future importer and so
 * the human-readable copy still proves where a claim came from.
 */

import { slugify, tidyText, truncate } from '../text';
import { formatDateLabel, formatDateTime, localDateIso, resolveTimeZone } from '../time';
import {
  EVIDENCE_EXPLANATION
} from '../capture/proposal';
import type {
  ChronicleRecords,
  EntryType,
  EvidenceLevel,
  JournalEntry,
  Milestone,
  Project,
  Task,
  TimeZoneId
} from '../types';

export interface MarkdownFile {
  path: string;
  content: string;
}

export interface MarkdownOptions {
  timezone?: TimeZoneId | 'device';
  /** Include entries flagged private (default true for local exports). */
  includePrivate?: boolean;
}

const ENTRY_TYPE_LABEL: Record<EntryType, string> = {
  note: 'Note',
  reflection: 'Personal reflection',
  progress: 'Progress update',
  research: 'Research note',
  decision: 'Technical decision',
  experiment: 'Experiment',
  failure: 'Failure / lesson',
  discovery: 'Discovery',
  milestone: 'Milestone'
};

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function yamlList(values: readonly string[]): string {
  if (values.length === 0) return '[]';
  return `[${values.map(yamlString).join(', ')}]`;
}

function frontMatter(fields: [string, string | number | boolean | null | undefined][]): string {
  const lines = fields
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join('\n')}\n---\n\n`;
}

export function entryTypeLabel(type: EntryType): string {
  return ENTRY_TYPE_LABEL[type] ?? type;
}

export function evidenceLabel(level: EvidenceLevel): string {
  return `${level} — ${EVIDENCE_EXPLANATION[level]}`;
}

/** One journal entry as a standalone Markdown document. */
export function entryToMarkdown(
  entry: JournalEntry,
  options: MarkdownOptions & { project?: Project | null; tasks?: Task[]; milestone?: Milestone | null } = {}
): string {
  const tz = resolveTimeZone(options.timezone);
  const project = options.project ?? null;
  const head = frontMatter([
    ['id', yamlString(entry.id)],
    ['kind', yamlString('chronicle.journal-entry')],
    ['entry_type', yamlString(entry.type)],
    ['title', yamlString(entry.title)],
    ['occurred_at', yamlString(entry.occurred_at)],
    ['occurred_precision', yamlString(entry.occurred_precision)],
    ['occurred_source', yamlString(entry.occurred_source)],
    ['created_at', yamlString(entry.created_at)],
    ['updated_at', yamlString(entry.updated_at)],
    ['rev', entry.rev],
    ['project', project ? yamlString(project.name) : null],
    ['project_id', entry.project_id ? yamlString(entry.project_id) : null],
    ['tags', yamlList(entry.tags)],
    ['evidence_level', yamlString(entry.evidence_level)],
    ['private', entry.private],
    ['source_kind', yamlString(entry.source.kind)],
    ['timezone', yamlString(entry.timezone ?? tz)],
    ...(entry.deleted_at ? ([['deleted_at', yamlString(entry.deleted_at)]] as [string, string][]) : [])
  ]);

  const title = entry.title?.trim() || `Untitled entry (${formatDateLabel(localDateIso(entry.occurred_at, tz))})`;
  const meta: string[] = [
    `**${entryTypeLabel(entry.type)}**`,
    formatDateTime(entry.occurred_at, tz),
    ...(project ? [project.name] : []),
    ...(entry.private ? ['Private'] : [])
  ];
  if (entry.occurred_precision !== 'exact') meta.push(`date precision: ${entry.occurred_precision}`);

  const parts: string[] = [head, `# ${title}`, '', `_${meta.join(' · ')}_`, ''];

  if (entry.summary) parts.push(`> ${tidyText(entry.summary)}`, '');
  if (entry.evidence_level !== 'concept') {
    parts.push(`**Evidence level:** ${evidenceLabel(entry.evidence_level)}`, '');
  }
  parts.push(tidyText(entry.body) || '_No body text._', '');

  if (entry.evidence.length > 0) {
    parts.push('## Evidence', '');
    for (const evidence of entry.evidence) {
      const where = evidence.location ? ` — \`${evidence.location}\`` : '';
      parts.push(`- **${evidence.kind}**${where} ${evidence.description ?? ''} _(${evidence.verification})_`);
    }
    parts.push('');
  }

  const tasks = options.tasks ?? [];
  if (tasks.length > 0) {
    parts.push('## Tasks from this entry', '');
    for (const task of tasks) {
      const due = task.due_on ? ` (due ${formatDateLabel(task.due_on)})` : '';
      parts.push(`- [${task.status === 'done' ? 'x' : ' '}] ${task.title}${due}`);
    }
    parts.push('');
  }

  if (options.milestone) {
    parts.push('## Milestone', '', `- ${options.milestone.title} (${formatDateLabel(options.milestone.date)}, ${options.milestone.status}, ${options.milestone.verification})`, '');
  }

  if (entry.source.original_input && entry.source.original_input !== entry.body) {
    parts.push('## Original capture', '', '> The verbatim message that produced this entry.', '', '```text', entry.source.original_input, '```', '');
  }

  if (entry.derived && Object.keys(entry.derived).length > 0) {
    const fields = Object.entries(entry.derived)
      .filter(([, value]) => value)
      .map(([key]) => key);
    parts.push(`_Suggested by Chronicle: ${fields.join(', ')}. Everything above the "Original capture" section is your own text._`, '');
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** A complete project dossier. */
export function projectToMarkdown(
  project: Project,
  records: ChronicleRecords,
  options: MarkdownOptions = {}
): string {
  const tz = resolveTimeZone(options.timezone);
  const entries = records.entries
    .filter((entry) => entry.project_id === project.id && !entry.deleted_at)
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const milestones = records.milestones
    .filter((milestone) => milestone.project_id === project.id && !milestone.deleted_at)
    .sort((a, b) => a.date.localeCompare(b.date));
  const tasks = records.tasks.filter((task) => task.project_id === project.id && !task.deleted_at);
  const linked = records.projects.filter((other) => project.linked_project_ids.includes(other.id));

  const head = frontMatter([
    ['id', yamlString(project.id)],
    ['kind', yamlString('chronicle.project')],
    ['name', yamlString(project.name)],
    ['status', yamlString(project.status)],
    ['stage', yamlString(project.stage)],
    ['started_on', project.started_on ? yamlString(project.started_on) : null],
    ['target_date', project.target_date ? yamlString(project.target_date) : null],
    ['tags', yamlList(project.tags)],
    ['created_at', yamlString(project.created_at)],
    ['updated_at', yamlString(project.updated_at)],
    ['entry_count', entries.length],
    ['milestone_count', milestones.length]
  ]);

  const parts: string[] = [head, `# ${project.name}`, ''];
  if (project.summary) parts.push(tidyText(project.summary), '');
  parts.push(
    '| | |',
    '| --- | --- |',
    `| Status | ${project.status} |`,
    `| Evidence stage | ${project.stage} |`,
    `| Started | ${project.started_on ? formatDateLabel(project.started_on) : '—'} |`,
    `| Target | ${project.target_date ? formatDateLabel(project.target_date) : '—'} |`,
    `| Tags | ${project.tags.length > 0 ? project.tags.map((tag) => `#${tag}`).join(' ') : '—'} |`,
    `| Journal entries | ${entries.length} |`,
    ''
  );

  if (project.objectives) parts.push('## Objectives', '', tidyText(project.objectives), '');
  if (linked.length > 0) {
    parts.push('## Linked projects', '', ...linked.map((other) => `- ${other.name} (${other.status})`), '');
  }

  if (milestones.length > 0) {
    parts.push('## Milestones', '');
    for (const milestone of milestones) {
      const verified = milestone.verification === 'verified' ? 'verified' : milestone.verification;
      parts.push(`- **${formatDateLabel(milestone.date)}** — ${milestone.title} (${milestone.status}, ${verified})`);
      if (milestone.description) parts.push(`  ${truncate(tidyText(milestone.description), 220)}`);
    }
    parts.push('');
  }

  const openTasks = tasks.filter((task) => task.status !== 'done' && task.status !== 'dropped');
  if (openTasks.length > 0) {
    parts.push('## Open tasks', '');
    for (const task of openTasks) {
      parts.push(`- [ ] ${task.title}${task.due_on ? ` — due ${formatDateLabel(task.due_on)}` : ''} (${task.status}${task.priority !== 'normal' ? `, ${task.priority}` : ''})`);
    }
    parts.push('');
  }

  if (entries.length > 0) {
    parts.push(`## Journal (${entries.length})`, '');
    for (const entry of entries) {
      const when = formatDateLabel(localDateIso(entry.occurred_at, tz));
      parts.push(`### ${when} — ${entry.title || 'Untitled'}`, '');
      parts.push(`_${entryTypeLabel(entry.type)} · evidence: ${entry.evidence_level}${entry.private ? ' · private' : ''}_`, '');
      if (entry.summary) parts.push(`> ${truncate(tidyText(entry.summary), 240)}`, '');
      parts.push(tidyText(entry.body), '');
    }
  } else {
    parts.push('## Journal', '', '_No entries recorded yet._', '');
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** All milestones across the archive, oldest first. */
export function milestonesToMarkdown(records: ChronicleRecords, options: MarkdownOptions = {}): string {
  const milestones = records.milestones
    .filter((milestone) => !milestone.deleted_at)
    .sort((a, b) => a.date.localeCompare(b.date));
  const projectName = (id: string | null | undefined): string =>
    records.projects.find((project) => project.id === id)?.name ?? 'Personal';

  const parts: string[] = [
    frontMatter([['kind', yamlString('chronicle.milestones')], ['count', milestones.length]]),
    '# Milestones',
    '',
    'Achievements are recorded as claims. `verified` means the owner attached evidence and confirmed it; everything else is still a claim.',
    ''
  ];
  if (milestones.length === 0) parts.push('_No milestones yet._', '');
  for (const milestone of milestones) {
    parts.push(
      `## ${formatDateLabel(milestone.date)} — ${milestone.title}`,
      '',
      `- Project: ${projectName(milestone.project_id)}`,
      `- Status: ${milestone.status} · Verification: ${milestone.verification}`,
      `- Id: \`${milestone.id}\``,
      ''
    );
    if (milestone.description) parts.push(tidyText(milestone.description), '');
    if (milestone.evidence.length > 0) {
      parts.push('Evidence:');
      for (const evidence of milestone.evidence) {
        parts.push(`- ${evidence.kind}${evidence.location ? `: \`${evidence.location}\`` : ''} (${evidence.verification})`);
      }
      parts.push('');
    }
  }
  void options;
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** All open and completed tasks. */
export function tasksToMarkdown(records: ChronicleRecords): string {
  const tasks = records.tasks
    .filter((task) => !task.deleted_at)
    .sort((a, b) => (a.due_on ?? '9999').localeCompare(b.due_on ?? '9999'));
  const projectName = (id: string | null | undefined): string =>
    records.projects.find((project) => project.id === id)?.name ?? 'Personal';

  const parts: string[] = [
    frontMatter([['kind', yamlString('chronicle.tasks')], ['count', tasks.length]]),
    '# Tasks',
    ''
  ];
  if (tasks.length === 0) parts.push('_No tasks yet._', '');
  for (const task of tasks) {
    const box = task.status === 'done' ? 'x' : ' ';
    const due = task.due_on ? ` — due ${formatDateLabel(task.due_on)}${task.due_precision !== 'day' ? ` (${task.due_precision})` : ''}` : '';
    parts.push(`- [${box}] **${task.title}**${due} · ${projectName(task.project_id)} · ${task.status}${task.priority !== 'normal' ? ` · ${task.priority}` : ''}`);
    if (task.description) parts.push(`  ${truncate(tidyText(task.description), 200)}`);
  }
  return parts.join('\n').trimEnd() + '\n';
}

/** Journal entries grouped by month. */
export function journalToMarkdown(records: ChronicleRecords, options: MarkdownOptions = {}): string {
  const tz = resolveTimeZone(options.timezone);
  const includePrivate = options.includePrivate ?? true;
  const entries = records.entries
    .filter((entry) => !entry.deleted_at && (includePrivate || !entry.private))
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const projectName = (id: string | null | undefined): string =>
    records.projects.find((project) => project.id === id)?.name ?? '';

  const parts: string[] = [
    frontMatter([['kind', yamlString('chronicle.journal')], ['count', entries.length], ['timezone', yamlString(tz)]]),
    '# Journal',
    ''
  ];
  if (entries.length === 0) parts.push('_No entries yet._', '');

  let currentMonth = '';
  for (const entry of entries) {
    const month = localDateIso(entry.occurred_at, tz).slice(0, 7);
    if (month !== currentMonth) {
      currentMonth = month;
      parts.push(`## ${month}`, '');
    }
    const when = formatDateLabel(localDateIso(entry.occurred_at, tz));
    const project = projectName(entry.project_id);
    parts.push(
      `### ${when} — ${entry.title || 'Untitled'}`,
      '',
      `_${entryTypeLabel(entry.type)}${project ? ` · ${project}` : ''}${entry.private ? ' · private' : ''} · evidence: ${entry.evidence_level}_`,
      '',
      tidyText(entry.body) || '_No body text._',
      ''
    );
    if (entry.source.original_input && entry.source.original_input !== entry.body) {
      parts.push('> Original capture:', '> ', ...entry.source.original_input.split('\n').map((line) => `> ${line}`.trimEnd()), '');
    }
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/**
 * A complete Markdown bundle: an index plus one file per project, the journal,
 * milestones and tasks. Returned as paths so the UI can save them as files.
 */
export function archiveToMarkdownFiles(records: ChronicleRecords, options: MarkdownOptions = {}): MarkdownFile[] {
  const includePrivate = options.includePrivate ?? true;
  const files: MarkdownFile[] = [];
  const projects = records.projects.filter((project) => !project.deleted_at);
  const visibleEntries = records.entries.filter(
    (entry) => !entry.deleted_at && (includePrivate || !entry.private)
  );

  files.push({
    path: 'chronicle/README.md',
    content: [
      frontMatter([
        ['kind', yamlString('chronicle.index')],
        ['exported_at', yamlString(new Date().toISOString())],
        ['projects', projects.length],
        ['entries', visibleEntries.length],
        ['milestones', records.milestones.filter((milestone) => !milestone.deleted_at).length],
        ['tasks', records.tasks.filter((task) => !task.deleted_at).length]
      ]),
      '# Chronicle export',
      '',
      'This is a human-readable export of a Chronicle archive. The authoritative,',
      'machine-readable version is the JSON archive; these documents are for',
      'reading, sharing and long-term storage.',
      '',
      '## Contents',
      '',
      '- `journal.md` — every journal entry, newest first',
      '- `milestones.md` — achievements and planned milestones',
      '- `tasks.md` — commitments and their state',
      '- `projects/<name>.md` — one dossier per project',
      '',
      '## Projects',
      '',
      ...(projects.length > 0
        ? projects.map((project) => `- **${project.name}** (${project.status}, ${project.stage}) — ${truncate(project.summary ?? '', 120) || 'no description'}`)
        : ['_No projects yet._']),
      ''
    ].join('\n').trimEnd() + '\n'
  });

  files.push({ path: 'chronicle/journal.md', content: journalToMarkdown(records, options) });
  files.push({ path: 'chronicle/milestones.md', content: milestonesToMarkdown(records, options) });
  files.push({ path: 'chronicle/tasks.md', content: tasksToMarkdown(records) });

  for (const project of projects) {
    const slug = slugify(project.name) || project.id.slice(-6);
    files.push({ path: `chronicle/projects/${slug}.md`, content: projectToMarkdown(project, records, options) });
  }

  return files;
}

/** Concatenate a bundle into one downloadable `.md` file. */
export function bundleToSingleMarkdown(files: readonly MarkdownFile[]): string {
  return files.map((file) => `<!-- ${file.path} -->\n\n${file.content}`).join('\n\n---\n\n');
}
