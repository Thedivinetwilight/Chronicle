/**
 * The shell: a persistent sidebar on wide screens, a bottom tab bar on small
 * ones, and a single capture action that is always within reach.
 *
 * Navigation shape (V0.2):
 *   Today · Life map · Journal · Chapters · Paths    ← the archive loop
 *   Trips · Collections · Share preview              ← gathering and sharing
 *   Projects · Timeline · Search · Roadmap · Settings ← everything else
 *
 * Phones get five tabs plus capture; everything else lives behind "More",
 * which is a real dialog rather than a truncated menu that hides half its
 * items off-screen.
 */

import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Icon, type IconName } from '../../ui/Icon';
import { useChronicle } from '../../state/ChronicleContext';
import { CaptureDialog } from '../capture/CaptureDialog';
import { Dialog } from '../../ui/Dialog';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Short label for the tab bar, where space is tight. */
  short?: string;
  hint?: string;
}

const PRIMARY: NavItem[] = [
  { to: '/', label: 'Today', icon: 'home', short: 'Today' },
  { to: '/map', label: 'Life map', icon: 'map', short: 'Map' },
  { to: '/journal', label: 'Journal', icon: 'book', short: 'Journal' },
  { to: '/chapters', label: 'Chapters', icon: 'layers', short: 'Chapters' },
  { to: '/paths', label: 'Paths', icon: 'route' }
];

const GATHER: NavItem[] = [
  { to: '/trips', label: 'Trips', icon: 'plane' },
  { to: '/places', label: 'Places & people', icon: 'pin' },
  { to: '/collections', label: 'Collections', icon: 'archive' },
  { to: '/share-preview', label: 'Share preview', icon: 'shield', hint: 'Preview only — nothing is published' }
];

const ELSEWHERE: NavItem[] = [
  { to: '/projects', label: 'Projects', icon: 'folder' },
  { to: '/timeline', label: 'Timeline', icon: 'history' },
  { to: '/search', label: 'Search', icon: 'search' },
  { to: '/roadmap', label: 'Roadmap', icon: 'compass' },
  { to: '/settings', label: 'Settings', icon: 'settings' }
];

const TABS: NavItem[] = PRIMARY;

/** Look up the section a path belongs to; deeper paths inherit their parent. */
function sectionTitle(pathname: string): string {
  const all = [...PRIMARY, ...GATHER, ...ELSEWHERE];
  const match = all.find((item) => (item.to === '/' ? pathname === '/' : pathname.startsWith(item.to)));
  return match?.label ?? 'Chronicle';
}

function Brand() {
  return (
    <NavLink to="/" className="shell__brand" aria-label="Chronicle home">
      <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true">
        <rect x="2" y="2" width="60" height="60" rx="14" fill="var(--color-surface)" stroke="var(--color-border-strong)" />
        <g stroke="currentColor" strokeWidth="4.2" strokeLinecap="round" fill="none">
          <path d="M15 22h27" />
          <path d="M15 33h27" />
          <path d="M15 44h11" />
        </g>
        <circle cx="41" cy="43" r="12" fill="var(--color-surface)" stroke="var(--color-accent)" strokeWidth="4" />
        <path d="M41 36.5V43l4.8 3.2" fill="none" stroke="var(--color-accent)" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span style={{ fontSize: 'var(--font-size-md)' }}>Chronicle</span>
    </NavLink>
  );
}

function SidebarLink({ item }: { item: NavItem }) {
  return (
    <NavLink to={item.to} end={item.to === '/'} className="shell__sidebar-item" title={item.hint}>
      <Icon name={item.icon} size={18} />
      {item.label}
    </NavLink>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { openCapture, toasts, dismissToast } = useChronicle();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <div className="shell">
      <aside className="shell__sidebar">
        <Brand />
        <nav className="shell__sidebar-nav" aria-label="Primary">
          {PRIMARY.map((item) => (
            <SidebarLink key={item.to} item={item} />
          ))}
        </nav>
        <nav className="shell__sidebar-nav shell__sidebar-nav--secondary" aria-label="Gather">
          {GATHER.map((item) => (
            <SidebarLink key={item.to} item={item} />
          ))}
        </nav>
        <nav className="shell__sidebar-nav shell__sidebar-nav--secondary" aria-label="Elsewhere">
          {ELSEWHERE.map((item) => (
            <SidebarLink key={item.to} item={item} />
          ))}
        </nav>
        <button type="button" className="btn btn--primary btn--block shell__sidebar-capture" onClick={() => openCapture()}>
          <Icon name="plus" size={17} />
          Capture
        </button>
      </aside>

      <header className="shell__header">
        <span className="shell__brand-mobile">
          <Brand />
        </span>
        <span className="shell__title">{sectionTitle(location.pathname)}</span>
        <div className="shell__actions">
          <NavLink to="/search" className="iconbtn" aria-label="Search" title="Search">
            <Icon name="search" size={20} />
          </NavLink>
          <NavLink to="/settings" className="iconbtn" aria-label="Settings" title="Settings">
            <Icon name="settings" size={20} />
          </NavLink>
        </div>
      </header>

      <main className="shell__main" id="main">
        {children}
      </main>

      <nav className="tabbar" aria-label="Primary">
        {TABS.slice(0, 3).map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} className="tabbar__item">
            <Icon name={item.icon} size={21} />
            {item.short ?? item.label}
          </NavLink>
        ))}
        <button
          type="button"
          className="tabbar__capture"
          onClick={() => openCapture()}
          aria-label="Capture something that happened"
        >
          <Icon name="plus" size={24} />
        </button>
        {TABS.slice(3).map((item) => (
          <NavLink key={item.to} to={item.to} className="tabbar__item">
            <Icon name={item.icon} size={21} />
            {item.short ?? item.label}
          </NavLink>
        ))}
        <button type="button" className="tabbar__item" onClick={() => setMoreOpen(true)} aria-haspopup="dialog">
          <Icon name="menu" size={21} />
          More
        </button>
      </nav>

      <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title="Everything else" wide>
        <nav aria-label="All destinations" className="form-stack form-stack--tight">
          {[...PRIMARY, ...GATHER, ...ELSEWHERE].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className="shell__sidebar-item"
              onClick={() => setMoreOpen(false)}
            >
              <Icon name={item.icon} size={18} />
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.hint ? <span className="text-xs text-faint">{item.hint}</span> : null}
            </NavLink>
          ))}
        </nav>
      </Dialog>

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((item) => (
          <div className="toast" key={item.id}>
            <span style={{ flex: 1 }}>{item.text}</span>
            {item.action ? (
              <button
                type="button"
                className="btn btn--quiet btn--sm"
                onClick={() => {
                  item.action?.run();
                  dismissToast(item.id);
                }}
              >
                {item.action.label}
              </button>
            ) : null}
            <button type="button" className="iconbtn" aria-label="Dismiss" onClick={() => dismissToast(item.id)}>
              <Icon name="close" size={15} />
            </button>
          </div>
        ))}
      </div>

      <CaptureDialog />
    </div>
  );
}
