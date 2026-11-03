/**
 * Roadmap — the deliberate list of things this build does not do yet.
 *
 * The brief asks for unfinished areas to be *visible* as roadmap targets
 * rather than as dead buttons. Every row here says what exists today, what is
 * missing, and why the missing part cannot be faked safely. None of them is a
 * control, so nothing looks more complete than it is.
 */

import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../../ui/Icon';

interface Target {
  icon: IconName;
  title: string;
  now: string;
  next: string;
  /** True when the feature exists in a limited, honest form today. */
  partial?: boolean;
}

const TARGETS: Target[] = [
  {
    icon: 'layers',
    title: 'Photos and attachments',
    now: 'Experiences are text-first. No image is stored or referenced.',
    next: 'Blob storage in IndexedDB with checksums, shown on the experience and excluded from share previews until reviewed.'
  },
  {
    icon: 'pin',
    title: 'Places and people on the map',
    now: 'Places, people and trips are stored and can be selected in a share preview. A place is a name you typed — never coordinates.',
    next: 'A place/people manager, and experience→place links with the same review step that chapters use.',
    partial: true
  },
  {
    icon: 'people',
    title: 'Real sharing: accounts, circles, public posts',
    now: 'Nothing can be published. There are no accounts and no server, so there is nothing to publish to.',
    next: 'Accounts, end-to-end encrypted sync and a curated public projection — each requiring the privacy review described in the docs.'
  },
  {
    icon: 'calendar',
    title: 'Year in review',
    now: 'Not built. No recap is generated from your records.',
    next: 'A locally generated, editable recap over a chosen date range, with user facts and generated wording clearly separated.'
  },
  {
    icon: 'history',
    title: 'Memory resurfacing (“On this day”)',
    now: 'Not built, and deliberately quiet: no notifications, no streak pressure.',
    next: 'Optional resurfacing with topics, people, places and dates you can hide — and nothing surfaced without those controls.'
  },
  {
    icon: 'task',
    title: 'Voice capture',
    now: 'Not built. Chronicle never records audio.',
    next: 'Opt-in recording with visible state, on-device transcription where possible, a review step and one-tap deletion of the original.'
  },
  {
    icon: 'download',
    title: 'Multi-device sync',
    now: 'Local only. An export is the only way data leaves this device.',
    next: 'A transport-agnostic, end-to-end encrypted change log (design in docs/ROADMAP.md). Not a vendor decision.'
  },
  {
    icon: 'book',
    title: 'Journal and timeline as first-class areas',
    now: 'A journal, timeline, projects and search exist from V0.1 and are reachable from the main navigation.',
    next: 'Richer filters by chapter and path, a day recap on Today, and resurfacing controls.',
    partial: true
  }
];

export function RoadmapPage() {
  return (
    <div className="page">
      <header className="page__header">
        <div className="page__title">
          <span className="eyebrow">What is not here yet</span>
          <h1>Roadmap</h1>
          <p className="text-sm text-muted measure">
            Chronicle is deliberately small so that the parts that exist can be trusted with a real life. These are the
            next milestones — listed honestly rather than shown as buttons that do nothing.
          </p>
        </div>
      </header>

      <ul className="roadmap">
        {TARGETS.map((target) => (
          <li className="roadmap__item" key={target.title}>
            <span className="state__halo" style={{ width: 34, height: 34 }} aria-hidden="true">
              <Icon name={target.icon} size={17} />
            </span>
            <span>
              <h3>
                {target.title}{' '}
                {target.partial ? <span className="text-xs text-faint">· partly available</span> : <span className="text-xs text-faint">· not built</span>}
              </h3>
              <p>
                <strong>Today:</strong> {target.now}
              </p>
              <p>
                <strong>Next:</strong> {target.next}
              </p>
            </span>
          </li>
        ))}
      </ul>

      <div className="note">
        <Icon name="shield" size={16} className="note__icon" />
        <span>
          Your archive is the product here, not the feed. Export it any time from{' '}
          <Link to="/settings">Settings</Link>; that is the only way anything leaves this device today.
        </span>
      </div>
    </div>
  );
}
