/**
 * Chronicle marks — a small set of one-line ink drawings.
 *
 * The whole set shares a 24-unit grid, a 1.5 stroke, round caps and round joins,
 * and an open, slightly hand-cut quality: paths are deliberately not perfectly
 * symmetrical, and where a real pen would overshoot or taper, these do too. That
 * is what keeps a set of vector marks from reading as stock clip art.
 *
 * These are authored SVG paths, not traced or generated artwork. They are small
 * enough to sit beside a label at 16–28px.
 *
 * Accessibility: every mark is `aria-hidden` by default because it is decorative
 * next to text that already says what it is. Pass `title` only when the mark is
 * the sole carrier of meaning, and then it gets a real `role="img"` + `<title>`.
 */

import type { CSSProperties } from 'react';

export type MarkName =
  | 'sprig'
  | 'frond'
  | 'moon'
  | 'sun'
  | 'wave'
  | 'ridge'
  | 'compass'
  | 'feather'
  | 'shell'
  | 'seed'
  | 'star'
  | 'route'
  | 'quill'
  | 'leaf-cluster';

interface MarkProps {
  name: MarkName;
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** Only when the mark carries meaning on its own. */
  title?: string;
  stroke?: number;
}

const PATHS: Record<MarkName, { d: string; closed?: boolean[] }[]> = {
  /* A sprig: one stem, two leaves, and a third that is still opening. */
  sprig: [
    // A stem that bends once, with two leaves large enough to read at 20 px.
    { d: 'M8.4 21c.6-5 2.2-9 5.4-12.2' },
    { d: 'M13.2 9.6C9.9 9.6 7.6 8 6.4 4.4c3.4-.3 5.8 1.4 6.8 5.2z', closed: [true] },
    { d: 'M11.7 13.4c.6-3.2 2.7-5.2 6.2-5.6-.3 3.3-2.4 5.2-6.2 5.6z', closed: [true] }
  ],
  /* A fern frond: a spine with diminishing pinnae, the older ones curling. */
  frond: [
    // Five broad leaflets alternating either side of one curving spine.
    { d: 'M10.6 21.4C10 15.4 10.8 9.8 13.4 4.8' },
    { d: 'M12.4 7.2C9.6 7.6 7.6 6.5 6.6 3.6c2.9-.5 5 .5 5.8 3.6z', closed: [true] },
    { d: 'M14.6 6.4c1.2-2.6 3.2-3.6 6.1-3.1-.6 2.8-2.6 3.9-6.1 3.1z', closed: [true] },
    { d: 'M11.6 11.8c-2.7.5-4.7-.6-5.8-3.5 2.9-.5 5 .6 5.8 3.5z', closed: [true] },
    { d: 'M13.5 11.4c1.2-2.6 3.2-3.7 6.1-3.2-.5 2.9-2.6 4-6.1 3.2z', closed: [true] },
    { d: 'M11 16.6c-2.7.4-4.7-.7-5.7-3.6 2.8-.4 4.9.7 5.7 3.6z', closed: [true] }
  ],
  /* A moon in its third quarter, with the unlit edge left open. */
  moon: [
    { d: 'M15.4 4.2a8.3 8.3 0 1 0 4.2 11.8 10.6 10.6 0 0 1-4.2-11.8z', closed: [true] },
    { d: 'M6.6 9.1h2.1M6.1 12.9h1.6M7.1 16.6h1.5' }
  ],
  /* A rising sun over a low horizon. */
  sun: [
    { d: 'M4.6 18.4h14.8' },
    { d: 'M6.2 18.4a6.4 6.4 0 0 1 11.6 0' },
    { d: 'M12 4.4v2.6M5.4 7.2l1.7 1.9M18.6 7.2l-1.7 1.9' }
  ],
  /* Three overlapping swells — a sea, not a "wave icon". */
  wave: [
    { d: 'M3.4 10.6c2.1-2.2 3.9-2.2 6 0s3.9 2.2 6 0 2.9-1.6 5.2-.4' },
    { d: 'M3.4 15.2c2.1-2.2 3.9-2.2 6 0s3.9 2.2 6 0 2.9-1.6 5.2-.4' },
    { d: 'M5.1 19.4c1.7-1.4 3.1-1.4 4.8 0s3.1 1.4 4.8 0' }
  ],
  /* A ridge line: two summits, the higher one asymmetric. */
  ridge: [
    { d: 'M2.8 19.2 9 8.4l3.6 6.1L15 10.2l6.2 9z', closed: [true] },
    { d: 'M9 8.4l1.6 2.9 1.4 2.2' },
    { d: 'M15 10.2l1.1 2 1.4 2.6' }
  ],
  /* A compass card: a four-point star in a ring, N marked by a longer tip. */
  compass: [
    { d: 'M12 12m-8.6 0a8.6 8.6 0 1 0 17.2 0a8.6 8.6 0 1 0-17.2 0' },
    { d: 'M12 4.6 13.5 10.5 19.4 12 13.5 13.5 12 19.4 10.5 13.5 4.6 12 10.5 10.5z', closed: [true] }
  ],
  /* A feather, barbed on one side only — the asymmetric kind. */
  feather: [
    { d: 'M17.4 4.2c-3.4.3-6.9 2.6-8.6 5.9-1 2-1.1 4-.6 5.9' },
    { d: 'M8.2 16c1.7-4 4.9-6.9 9.2-11.8' },
    { d: 'M10.6 11.4l-2.2-1M13.2 9.1l-1.4-1.7M11.9 13.6l2.4.9M9.4 15.9l2.9 1.6' }
  ],
  /* A scallop shell: radiating ribs from a hinge. */
  shell: [
    // A wide fan with a scalloped lower edge, ribs meeting at the hinge.
    { d: 'M12 21c-4.8 0-8.4-3.4-8.4-7.7C3.6 8.3 7.4 4.6 12 3.2c4.6 1.4 8.4 5.1 8.4 10.1 0 4.3-3.6 7.7-8.4 7.7z', closed: [true] },
    { d: 'M12 21V6.6M12 21c-2.1-3.4-3.3-7.1-3.6-11M12 21c2.1-3.4 3.3-7.1 3.6-11' },
    { d: 'M8.4 10c-1.2-2.9-1.6-5.4-1.2-7.4M15.6 10c1.2-2.9 1.6-5.4 1.2-7.4' }
  ],
  /* A seed with one emerging shoot. */
  seed: [
    { d: 'M12 20.6c-3.4 0-5.6-2.3-5.6-5.4 0-3.7 2.5-6.6 5.6-9.4 3.1 2.8 5.6 5.7 5.6 9.4 0 3.1-2.2 5.4-5.6 5.4z', closed: [true] },
    { d: 'M12 17.4V9.6' }
  ],
  /* An eight-ray asterisk star, arms of unequal length. */
  star: [
    { d: 'M12 3.4v6.1M12 14.5v6.1M3.9 12h6.1M14 12h6.1' },
    { d: 'M6.3 6.3l3.2 3.2M14.5 14.5l3.2 3.2M17.7 6.3l-3.2 3.2M9.5 14.5l-3.2 3.2' }
  ],
  /* A travelled route: a curving path with two waypoints. */
  route: [
    { d: 'M4.2 19.4c1.4-3 1-5.9-.4-8.6 2.6-1.1 5.2-1 7.7.4 2.3 1.3 4.7.9 6.9-1.2' },
    { d: 'M5.6 20.7a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6z', closed: [true] },
    { d: 'M18.4 11.3a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6z', closed: [true] }
  ],
  /* A quill resting on a drawn baseline. */
  quill: [
    { d: 'M4 20c3.4-.4 6.2-1.6 8.6-3.7 3.1-2.8 4.9-6.2 5.9-11.9-4.6 1.5-8.1 3.4-10.7 6-1.8 1.8-2.6 4-2.5 6.6' },
    { d: 'M7.2 16.9c-.6-1.9-.3-3.7.9-5.4M10.4 13.9c-.3-1.6.2-3 1.4-4.2M4 20h7.6' }
  ],
  /* Three leaves on a shared stem — the "collection" mark. */
  'leaf-cluster': [
    { d: 'M11.2 21V10.4' },
    { d: 'M11.2 13.4C7.4 13.4 4.8 11.2 4.4 7c3.8-.4 6.4 1.8 6.8 6.4z', closed: [true] },
    { d: 'M11.2 13.4c3.8 0 6.4-2.2 6.8-6.4-3.8-.4-6.4 1.8-6.8 6.4z', closed: [true] },
    { d: 'M11.2 9.6C9.4 6.8 10 4.2 12 2.2c2 2 2.6 4.6.8 7.4', closed: [true] }
  ]
};

export function Mark({ name, size = 24, className, style, title, stroke = 1.5 }: MarkProps) {
  const paths = PATHS[name];
  const labelled = Boolean(title);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      role={labelled ? 'img' : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
    >
      {labelled ? <title>{title}</title> : null}
      {paths.map((path, index) => (
        <path
          key={index}
          d={path.d}
          fill={path.closed?.[0] ? 'var(--art-wash, none)' : 'none'}
        />
      ))}
    </svg>
  );
}


/**
 * A small landscape study for the Today masthead.
 *
 * Wider than the marks (they are square signposts) but drawn on the same grid
 * with the same stroke and caps, so it reads as the same hand rather than as a
 * different illustration style. A horizon, a low sun and reeds: the vocabulary
 * of a field notebook, and it claims nothing about the day's content.
 */
export function DayPlate({ width = 112, height = 64, className }: { width?: number; height?: number; className?: string }) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 56 36"
      fill="none"
      stroke="currentColor"
      strokeWidth="0.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* A low sun rising *behind* a flat sea horizon, with the far shore
          interrupted where the disc crosses it. The break is what makes the
          sun read as behind the line rather than sitting on it. */}
      <circle cx="27.5" cy="19.4" r="6.4" />
      <path d="M3.4 25.8h17.2" />
      <path d="M34.4 25.8h18.2" />
      {/* Light escaping upward, unevenly spaced. */}
      <path d="M27.5 7.8v2.6M18.6 11.2l1.9 1.9M36.4 11.2l-1.9 1.9M16.6 20.4h2.2M36.2 20.4h2.2" />
      {/* Three water lines below the horizon, each a different length. */}
      <path d="M8 29.2c2.4-1.3 4.8-1.3 7.2 0s4.8 1.3 7.2 0" />
      <path d="M27.4 29.2c2.2-1.1 4.4-1.1 6.6 0s4.4 1.1 6.6 0" />
      <path d="M14.2 32.2c2-1 4-1 6 0s4 1 6 0" />
      {/* Two reeds at the near edge, leaning away from each other. */}
      <path d="M42.6 33.4c.7-3.2.5-5.6-.6-7.4" />
      <path d="M45.8 33.4c.8-2.4.9-4.2.5-5.6" />
    </svg>
  );
}

/** The six marks used as section signposts in navigation and headings. */
/** Every mark the set can draw, for tests and for exhaustive switches. */
export const MARK_NAMES = [
  'sprig','frond','moon','sun','wave','ridge','compass','feather',
  'shell','seed','star','route','quill','leaf-cluster'
] as const satisfies readonly MarkName[];

export const SECTION_MARKS = {
  today: 'sun',
  journal: 'quill',
  map: 'compass',
  chapters: 'sprig',
  paths: 'route',
  trips: 'ridge',
  places: 'shell',
  collections: 'leaf-cluster',
  share: 'feather'
} as const satisfies Record<string, MarkName>;
