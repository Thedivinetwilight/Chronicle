/**
 * Inline icon set (§22). One component, no icon dependency.
 *
 * Every glyph is a stroked path on a 24px grid at 1.75 stroke width, chosen to
 * stay quiet next to text. Sizes: 16 / 20 / 24.
 */

import type { CSSProperties, JSX } from 'react';

export type IconName =
  | 'home'
  | 'folder'
  | 'book'
  | 'history'
  | 'search'
  | 'plus'
  | 'check'
  | 'close'
  | 'edit'
  | 'trash'
  | 'tag'
  | 'settings'
  | 'alert'
  | 'info'
  | 'sparkle'
  | 'download'
  | 'upload'
  | 'undo'
  | 'chevron-down'
  | 'chevron-left'
  | 'calendar'
  | 'flag'
  | 'task'
  | 'lock'
  | 'sun'
  | 'moon'
  | 'monitor'
  | 'dots'
  | 'link'
  | 'external'
  // Life archive (V0.2)
  | 'map'
  | 'compass'
  | 'route'
  | 'pin'
  | 'people'
  | 'plane'
  | 'layers'
  | 'eye'
  | 'shield'
  | 'zoom-in'
  | 'zoom-out'
  | 'fit'
  | 'list'
  | 'check-circle'
  | 'x-circle'
  | 'menu'
  | 'archive'
  | 'ellipsis';

const PATHS: Record<IconName, JSX.Element> = {
  menu: (
    <>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </>
  ),
  archive: (
    <>
      <rect x="3.5" y="4.5" width="17" height="4" rx="1" />
      <path d="M5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8.5" />
      <path d="M10 12h4" />
    </>
  ),
  home: (
    <>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9.5V20h12V9.5" />
    </>
  ),
  folder: (
    <path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h4l2 2.5h7A1.5 1.5 0 0 1 20 9v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18Z" />
  ),
  book: (
    <>
      <path d="M5 4.5h9a3 3 0 0 1 3 3V20a2.5 2.5 0 0 0-2.5-2.5H5Z" />
      <path d="M17 7.5h2v12h-2" />
    </>
  ),
  history: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  close: (
    <>
      <path d="m6 6 12 12" />
      <path d="m18 6-12 12" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17Z" />
      <path d="m13.5 6.5 3 3" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
      <path d="M6.5 7l1 12.5h9L17.5 7" />
    </>
  ),
  tag: (
    <>
      <path d="M4 11V4.5h6.5L20 14l-6.5 6.5Z" />
      <circle cx="8" cy="8" r="1.2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4.5 21 19.5H3Z" />
      <path d="M12 10v4" />
      <path d="M12 16.8v.2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5" />
      <path d="M12 7.8v.2" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 4.5 13.8 10 19.5 12l-5.7 2L12 19.5 10.2 14 4.5 12l5.7-2Z" />
      <path d="M18.5 4.5v3M20 6h-3" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11" />
      <path d="m7.5 11 4.5 4.5L16.5 11" />
      <path d="M5 19.5h14" />
    </>
  ),
  upload: (
    <>
      <path d="M12 19.5v-11" />
      <path d="m7.5 12.5 4.5-4.5 4.5 4.5" />
      <path d="M5 4.5h14" />
    </>
  ),
  undo: (
    <>
      <path d="M8 5.5 4 9.5l4 4" />
      <path d="M4 9.5h10a5.5 5.5 0 0 1 0 11H9" />
    </>
  ),
  'chevron-down': <path d="m6 9.5 6 6 6-6" />,
  'chevron-left': <path d="m14.5 6-6 6 6 6" />,
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="15" rx="2" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    </>
  ),
  flag: (
    <>
      <path d="M6 20V4.5" />
      <path d="M6 5h11l-2 3.5 2 3.5H6" />
    </>
  ),
  task: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="m8.5 12 2.5 2.5 5-5.5" />
    </>
  ),
  lock: (
    <>
      <rect x="5.5" y="10.5" width="13" height="9.5" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M21 12h-2M5 12H3M18.4 5.6 17 7M7 17l-1.4 1.4M18.4 18.4 17 17M7 7 5.6 5.6" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
  monitor: (
    <>
      <rect x="3.5" y="5" width="17" height="11" rx="2" />
      <path d="M9.5 19.5h5M12 16v3.5" />
    </>
  ),
  dots: (
    <>
      <circle cx="6" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="18" cy="12" r="1.4" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1.2 1.2" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1.2-1.2" />
    </>
  ),
  map: (
    <>
      <path d="M9 4 3.5 6.2v13.3L9 17.3l6 2.2 5.5-2.2V4L15 6.2 9 4Z" />
      <path d="M9 4v13.3M15 6.2v13.3" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m15.2 8.8-2 4.4-4.4 2 2-4.4 4.4-2Z" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="18" cy="18" r="2.2" />
      <path d="M8.2 6h5.3a3.5 3.5 0 0 1 0 7H9a3.5 3.5 0 0 0 0 7h6.8" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21c4-4.6 6-7.7 6-10.2A6 6 0 0 0 6 10.8C6 13.3 8 16.4 12 21Z" />
      <circle cx="12" cy="10.5" r="2.2" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M16 6.2a3 3 0 0 1 0 5.6M17.5 14.8c2 .6 3 2.2 3 4.7" />
    </>
  ),
  plane: <path d="M21 4 3.5 11.2l6.2 2.4L12 20l3-6.9L21 4Z" />,
  layers: (
    <>
      <path d="m12 3.5 8.5 4.6L12 12.7 3.5 8.1 12 3.5Z" />
      <path d="m4 12.6 8 4.4 8-4.4" />
      <path d="m4 16.7 8 4.4 8-4.4" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.2 19 6v5.4c0 4.2-2.9 7.3-7 9.4-4.1-2.1-7-5.2-7-9.4V6l7-2.8Z" />
      <path d="m9 12 2.2 2.2L15.4 10" />
    </>
  ),
  'zoom-in': (
    <>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m15.6 15.6 4.4 4.4M8.4 10.8h4.8M10.8 8.4v4.8" />
    </>
  ),
  'zoom-out': (
    <>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m15.6 15.6 4.4 4.4M8.4 10.8h4.8" />
    </>
  ),
  fit: (
    <>
      <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5A1.5 1.5 0 0 1 18.5 20H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
    </>
  ),
  list: (
    <>
      <path d="M8.5 6.5H20M8.5 12H20M8.5 17.5H20" />
      <circle cx="4.6" cy="6.5" r="1.1" />
      <circle cx="4.6" cy="12" r="1.1" />
      <circle cx="4.6" cy="17.5" r="1.1" />
    </>
  ),
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.4 12.2 2.6 2.6 4.6-5.2" />
    </>
  ),
  'x-circle': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m9.2 9.2 5.6 5.6M14.8 9.2l-5.6 5.6" />
    </>
  ),
  ellipsis: (
    <>
      <circle cx="6" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="18" cy="12" r="1.4" />
    </>
  ),
  external: (
    <>
      <path d="M14 5h5v5" />
      <path d="M19 5 11 13" />
      <path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
    </>
  )
};

export function Icon({
  name,
  size = 20,
  className,
  title,
  style
}: {
  name: IconName;
  size?: number;
  className?: string;
  title?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  );
}
