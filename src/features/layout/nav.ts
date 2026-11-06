/**
 * The navigation model, kept out of the shell so it can be asserted directly.
 *
 * Shape (V0.2):
 *   Today · Life map · Journal · Chapters · Paths    ← the archive loop
 *   Trips · Places & people · Collections · Share     ← gathering and sharing
 *   Projects · Timeline · Search · Roadmap · Settings ← everything else
 */

import type { IconName } from '../../ui/Icon';
import { SECTION_MARKS, type MarkName } from '../../ui/art/Mark';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Short label for the tab bar, where space is tight. */
  short?: string;
  hint?: string;
  /**
   * The drawn mark for this destination. The five archive destinations each
   * have one, so the primary navigation carries the product's own hand rather
   * than a generic outline set. Secondary items keep the quiet stroke icons.
   */
  mark?: MarkName;
}

export const PRIMARY_NAV: NavItem[] = [
  { to: '/', label: 'Today', icon: 'home', short: 'Today', mark: SECTION_MARKS.today },
  { to: '/map', label: 'Life map', icon: 'map', short: 'Map', mark: SECTION_MARKS.map },
  { to: '/journal', label: 'Journal', icon: 'book', short: 'Journal', mark: SECTION_MARKS.journal },
  { to: '/chapters', label: 'Chapters', icon: 'layers', short: 'Chapters', mark: SECTION_MARKS.chapters },
  { to: '/paths', label: 'Paths', icon: 'route', short: 'Paths', mark: SECTION_MARKS.paths }
];

export const GATHER_NAV: NavItem[] = [
  { to: '/trips', label: 'Trips', icon: 'plane' },
  { to: '/places', label: 'Places & people', icon: 'pin', short: 'Places' },
  { to: '/collections', label: 'Collections', icon: 'archive' },
  { to: '/share-preview', label: 'Share preview', icon: 'shield', hint: 'Preview only — nothing is published' }
];

export const MORE_NAV: NavItem[] = [
  { to: '/projects', label: 'Projects', icon: 'folder' },
  { to: '/timeline', label: 'Timeline', icon: 'history' },
  { to: '/search', label: 'Search', icon: 'search' },
  /* A flag, not a compass: the Life map already owns the compass, and two
     needles in one sidebar read as the same destination twice. */
  { to: '/roadmap', label: 'Roadmap', icon: 'flag' },
  { to: '/settings', label: 'Settings', icon: 'settings' }
];

/** Every destination outside the primary five, in sidebar order. */
export const SECONDARY_NAV: NavItem[] = [...GATHER_NAV, ...MORE_NAV];
