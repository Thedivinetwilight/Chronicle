/**
 * Local full-text search (§20). Everything runs against the on-device index;
 * results are grouped by kind with the matched terms marked in the snippet.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useChronicle } from '../../state/ChronicleContext';
import { useSearch } from '../../state/hooks';
import { hitPath, highlightSegments } from '../../domain/search';
import type { RecordKind } from '../../domain/types';
import { Badge, TextInput } from '../../ui/primitives';
import { Icon } from '../../ui/Icon';
import { EmptyState } from '../../ui/states';

const KIND_LABEL: Record<string, string> = {
  projects: 'Projects',
  entries: 'Journal',
  milestones: 'Milestones',
  tasks: 'Tasks'
};

export function SearchPage() {
  const { timezone } = useChronicle();
  const [text, setText] = useState('');
  const [kind, setKind] = useState<RecordKind | 'all'>('all');
  void timezone;

  const query = useMemo(() => ({ text, kinds: kind === 'all' ? undefined : [kind], limit: 40 }), [text, kind]);
  const hits = useSearch(query);

  const grouped = useMemo(() => {
    const groups = new Map<string, NonNullable<typeof hits>>();
    for (const hit of hits ?? []) {
      const list = groups.get(hit.kind) ?? [];
      list.push(hit);
      groups.set(hit.kind, list);
    }
    return [...groups.entries()];
  }, [hits]);

  const trimmed = text.trim();

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__title">
          <h1>Search</h1>
          <span className="text-xs text-faint">Your archive only. Nothing leaves this device.</span>
        </div>
      </header>

      <div className="searchfield">
        <Icon name="search" size={18} className="icon-inline" />
        <TextInput value={text} onChange={setText} placeholder="Search titles, text, tags, #tag…" />
      </div>

      <div className="page__controls">
        {(['all', 'entries', 'projects', 'tasks', 'milestones'] as const).map((option) => (
          <button
            key={option}
            type="button"
            className="tagchip"
            aria-pressed={kind === option}
            onClick={() => setKind(option)}
          >
            {option === 'all' ? 'Everything' : KIND_LABEL[option]}
          </button>
        ))}
      </div>

      {!trimmed ? (
        <EmptyState icon="search" title="Search your archive">
          Try a word from an old entry, a tag like <code>#debugging</code>, or a project name. Matches
          include titles, bodies, tags and the original capture text.
        </EmptyState>
      ) : hits === undefined ? (
        <EmptyState icon="search" title="Searching…" />
      ) : hits.length === 0 ? (
        <EmptyState icon="search" title={`No matches for “${trimmed}”`}>
          Check the spelling, try a shorter word, or search a tag with <code>#</code>.
        </EmptyState>
      ) : (
        grouped.map(([groupKind, groupHits]) => (
          <section key={groupKind} aria-label={KIND_LABEL[groupKind] ?? groupKind}>
            <div className="section-head">
              <h2 className="section-head__title">
                {KIND_LABEL[groupKind] ?? groupKind} · {groupHits.length}
              </h2>
            </div>
            <div className="card list">
              {groupHits.map((hit) => (
                <Link key={`${hit.kind}:${hit.id}`} className="list__item entrycard" to={hitPath(hit)}>
                  <div className="entrycard__title">
                    {highlightSegments(hit.title, hit.matched).map((segment, index) =>
                      segment.match ? (
                        <mark key={index} className="searchmark">
                          {segment.text}
                        </mark>
                      ) : (
                        <span key={index}>{segment.text}</span>
                      )
                    )}
                  </div>
                  <div className="entrycard__preview">
                    {highlightSegments(hit.snippet, hit.matched).map((segment, index) =>
                      segment.match ? (
                        <mark key={index} className="searchmark">
                          {segment.text}
                        </mark>
                      ) : (
                        <span key={index}>{segment.text}</span>
                      )
                    )}
                  </div>
                  <div className="entrycard__meta">
                    <span>{hit.origin}</span>
                    {hit.status ? <Badge>{hit.status}</Badge> : null}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
