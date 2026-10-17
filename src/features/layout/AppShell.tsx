/**
 * The shell: a persistent sidebar on wide screens, a bottom tab bar on small
 * ones, and a single capture action that is always within reach (§20).
 */

import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Icon, type IconName } from '../../ui/Icon';
import { useChronicle } from '../../state/ChronicleContext';
import { CaptureDialog } from '../capture/CaptureDialog';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/projects', label: 'Projects', icon: 'folder' },
  { to: '/journal', label: 'Journal', icon: 'book' },
  { to: '/timeline', label: 'Timeline', icon: 'history' },
  { to: '/search', label: 'Search', icon: 'search' }
];

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

export function AppShell({ children }: { children: ReactNode }) {
  const { openCapture, toasts, dismissToast } = useChronicle();

  return (
    <div className="shell">
      <aside className="shell__sidebar">
        <Brand />
        <nav className="shell__sidebar-nav" aria-label="Primary">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className="shell__sidebar-item"
            >
              <Icon name={item.icon} size={18} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button type="button" className="btn btn--primary btn--block shell__sidebar-capture" onClick={() => openCapture()}>
          <Icon name="plus" size={17} />
          Capture
        </button>
        <div className="shell__sidebar-footer">
          <NavLink to="/settings" className="shell__sidebar-item">
            <Icon name="settings" size={18} />
            Settings
          </NavLink>
        </div>
      </aside>

      <header className="shell__header">
        <span style={{ display: 'none' }} className="shell__brand-desktop">
          <Brand />
        </span>
        <span className="shell__title" aria-hidden="true" />
        <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
          <NavLink to="/settings" className="iconbtn" aria-label="Settings" title="Settings">
            <Icon name="settings" size={20} />
          </NavLink>
        </div>
      </header>

      <main className="shell__main" id="main">
        {children}
      </main>

      <nav className="tabbar" aria-label="Primary">
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} className="tabbar__item">
            <Icon name={item.icon} size={21} />
            {item.label}
          </NavLink>
        ))}
        <button type="button" className="tabbar__capture" onClick={() => openCapture()} aria-label="Capture something that happened">
          <Icon name="plus" size={24} />
        </button>
      </nav>

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
            <button type="button" className="iconbtn" aria-label="Dismiss" onClick={() => dismissToast(item.id)} style={{ width: 32, height: 32 }}>
              <Icon name="close" size={15} />
            </button>
          </div>
        ))}
      </div>

      <CaptureDialog />
    </div>
  );
}
