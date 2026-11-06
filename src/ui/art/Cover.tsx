/**
 * Chronicle covers — generated plate artwork for chapters, paths, collections
 * and trips.
 *
 * Rules that keep this honest and maintainable:
 *
 * 1. **Deterministic.** The plate is derived from the record's own id and name
 *    via a small string hash. The same chapter always gets the same plate;
 *    nothing reshuffles between renders or devices.
 * 2. **Not illustrative of content.** A plate does not claim "this chapter was
 *    about the sea". It is a printer's plate — abstract line work chosen from a
 *    fixed grammar — so it can never imply a fact the user did not record.
 * 3. **Cheap.** Every plate is a handful of paths on a shared grid. No images,
 *    no filters, no gradients beyond one flat wash.
 * 4. **Decorative.** Always `aria-hidden`; the record's name carries the meaning.
 */

import type { CSSProperties } from 'react';

export type CoverKind = 'chapter' | 'path' | 'collection' | 'trip';

/** FNV-1a, 32-bit. Small, stable, and good enough to spread a dozen seeds. */
function hash(input: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    value ^= input.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/** Deterministic pseudo-random stream from one seed. */
function stream(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

/* The plate grammar. Each motif is drawn on a 120×84 plate with a 10-unit safe
   margin. Strokes stay on the same 1.5 weight as the marks so a cover and an
   inline mark look like the same hand. */
type Motif = 'contour' | 'strata' | 'hachure' | 'orbit' | 'ripple' | 'grid-cut';

const MOTIFS: Motif[] = ['contour', 'strata', 'hachure', 'orbit', 'ripple', 'grid-cut'];

export interface CoverSpec {
  motif: Motif;
  /** Flat wash behind the line work, as a token name. */
  wash: string;
  /** Paths in plate coordinates (120 × 84). */
  paths: string[];
  /** Rotation applied to the whole plate, in degrees. */
  rotate: number;
}

export function buildCover(kind: CoverKind, id: string, name: string): CoverSpec {
  const seed = hash(`${kind}:${id}:${name}`);
  const next = stream(seed);
  const motif = MOTIFS[Math.floor(next() * MOTIFS.length) % MOTIFS.length]!;
  const washes = ['--art-wash-a', '--art-wash-b', '--art-wash-c'];
  const wash = washes[Math.floor(next() * washes.length) % washes.length]!;
  const rotate = Math.round((next() - 0.5) * 12);

  const paths: string[] = [];
  const W = 120;
  const H = 84;
  const m = 10;

  if (motif === 'contour') {
    /* Contour lines — a map that is not of anywhere.
       Nested closed loops around one centre read as a ball of yarn, not a
       landscape: the eye follows the loops instead of the ground. Real contours
       drift downhill and, where the slope is even, run open off the plate. So
       the centre walks as the rings grow, and alternate rings are left unclosed
       with a gap where they would have met. */
    const rings = 5 + Math.floor(next() * 3);
    let cx = W / 2 + (next() - 0.5) * 14;
    let cy = H / 2 + (next() - 0.5) * 10;
    const driftX = (next() - 0.5) * 7;
    const driftY = (next() - 0.5) * 5;
    for (let r = 0; r < rings; r += 1) {
      const t = r / rings;
      cx += driftX * (0.4 + next() * 0.6);
      cy += driftY * (0.4 + next() * 0.6);
      const rw = (W / 2 - m) * (0.2 + t * 0.78);
      const rh = (H / 2 - m) * (0.22 + t * 0.74);
      const wobble = 0.07 + next() * 0.12;
      const open = r % 2 === 1;
      // Leave a gap where the open ring would close, so two rings never make a
      // seam that looks like one continuous line.
      const steps = 11;
      const span = open ? 0.82 + next() * 0.12 : 1;
      const start = next() * Math.PI * 2;
      const points: string[] = [];
      for (let i = 0; i <= steps; i += 1) {
        const a = start + (i / steps) * Math.PI * 2 * span;
        const k = 1 + Math.sin(a * 3 + r) * wobble + Math.cos(a * 2 - r) * wobble * 0.6;
        const x = cx + Math.cos(a) * rw * k;
        const y = cy + Math.sin(a) * rh * k;
        points.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`);
      }
      paths.push(open ? points.join(' ') : `${points.join(' ')} Z`);
    }
  } else if (motif === 'strata') {
    /* Sedimentary bands, each with one break — the page of a field notebook. */
    const bands = 6 + Math.floor(next() * 3);
    for (let b = 0; b < bands; b += 1) {
      const y = m + ((H - m * 2) / bands) * b + (next() - 0.5) * 4;
      const dip = 2 + next() * 7;
      const mid = W * (0.3 + next() * 0.4);
      paths.push(
        `M${m} ${y.toFixed(1)} Q${(mid - 14).toFixed(1)} ${(y + dip).toFixed(1)} ${mid.toFixed(1)} ${(y + dip * 0.4).toFixed(1)} T${W - m} ${(y - dip * 0.5).toFixed(1)}`
      );
    }
  } else if (motif === 'hachure') {
    /* Shading strokes in a drifting band — a printer's hatch. */
    const lines = 16 + Math.floor(next() * 8);
    const tilt = 0.5 + next() * 0.5;
    for (let i = 0; i < lines; i += 1) {
      const x = m + ((W - m * 2) / lines) * i;
      const drift = Math.sin((i / lines) * Math.PI) * (6 + next() * 8);
      const gap = Math.cos((i / lines) * Math.PI * 2) * 3;
      paths.push(
        `M${x.toFixed(1)} ${(m + gap).toFixed(1)} L${(x + tilt * 5).toFixed(1)} ${(H - m - drift).toFixed(1)}`
      );
    }
  } else if (motif === 'orbit') {
    /* Two offset ellipses and a scattering of points — a plotted sky. */
    const cx = W / 2;
    const cy = H / 2;
    const count = 2 + Math.floor(next() * 2);
    for (let i = 0; i < count; i += 1) {
      const rw = 16 + next() * (W / 2 - m - 16);
      const rh = 8 + next() * (H / 2 - m - 6);
      const rot = next() * 180;
      paths.push(
        `M${(cx - rw).toFixed(1)} ${cy.toFixed(1)} A${rw.toFixed(1)} ${rh.toFixed(1)} ${rot.toFixed(0)} 0 1 ${(cx + rw).toFixed(1)} ${cy.toFixed(1)} A${rw.toFixed(1)} ${rh.toFixed(1)} ${rot.toFixed(0)} 0 1 ${(cx - rw).toFixed(1)} ${cy.toFixed(1)}`
      );
    }
    const dots = 4 + Math.floor(next() * 5);
    for (let i = 0; i < dots; i += 1) {
      const x = m + next() * (W - m * 2);
      const y = m + next() * (H - m * 2);
      const r = 0.9 + next() * 1.3;
      paths.push(`M${(x - r).toFixed(1)} ${y.toFixed(1)}a${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(r * 2).toFixed(1)} 0a${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(-r * 2).toFixed(1)} 0`);
    }
  } else if (motif === 'ripple') {
    /* Concentric water rings from one off-centre stone. */
    const cx = m + next() * (W - m * 2);
    const cy = m + next() * (H - m * 2);
    const rings = 5 + Math.floor(next() * 4);
    /* The outermost ring must reach the plate edge somewhere but never run past
       it: a ripple that overflows is silently clipped by the viewBox and reads
       as a rendering fault rather than as a drawing. Each ring scales to the
       largest radius that still fits around this particular origin. */
    const maxRw = Math.max(4, Math.min(cx - 0, W - cx, (cy - 0) / 0.5, (H - cy) / 0.5));
    for (let i = 1; i <= rings; i += 1) {
      const t = i / rings;
      const rw = Math.max(4, Math.min(maxRw * t, maxRw));
      const rh = rw * (0.42 + next() * 0.16);
      paths.push(
        `M${(cx - rw).toFixed(1)} ${cy.toFixed(1)}a${rw.toFixed(1)} ${rh.toFixed(1)} 0 1 0 ${(rw * 2).toFixed(1)} 0a${rw.toFixed(1)} ${rh.toFixed(1)} 0 1 0 ${(-rw * 2).toFixed(1)} 0`
      );
    }
  } else {
    /* A cut grid: the plate divided, with one cell left open. */
    const cols = 3 + Math.floor(next() * 3);
    const rows = 2 + Math.floor(next() * 3);
    const skip = Math.floor(next() * cols * rows);
    for (let c = 1; c < cols; c += 1) {
      const x = m + ((W - m * 2) / cols) * c;
      paths.push(`M${x.toFixed(1)} ${m}V${H - m}`);
    }
    for (let r = 1; r < rows; r += 1) {
      const y = m + ((H - m * 2) / rows) * r;
      paths.push(`M${m} ${y.toFixed(1)}H${W - m}`);
    }
    // One cell gets a diagonal instead of being empty, so the grid breathes.
    const cellW = (W - m * 2) / cols;
    const cellH = (H - m * 2) / rows;
    const ci = skip % cols;
    const ri = Math.floor(skip / cols) % rows;
    paths.push(
      `M${(m + ci * cellW).toFixed(1)} ${(m + ri * cellH).toFixed(1)}L${(m + (ci + 1) * cellW).toFixed(1)} ${(m + (ri + 1) * cellH).toFixed(1)}`
    );
  }

  return { motif, wash, paths, rotate };
}

interface CoverProps {
  kind: CoverKind;
  id: string;
  name: string;
  className?: string;
  style?: CSSProperties;
  /** Rounded corners follow the radius token by default. */
  radius?: string;
}

export function Cover({ kind, id, name, className, style, radius }: CoverProps) {
  const spec = buildCover(kind, id, name);
  return (
    <svg
      className={className}
      style={{
        width: '100%',
        /* In a fixed-height slot (a shelf card, a rail thumbnail) the caller
           owns the height and the plate fills it; the SVG's own 120:84 viewBox
           is what guarantees the drawing inside still holds its proportion,
           because `meet` letterboxes rather than crops. On its own the plate
           holds its proportion from the width it is given. */
        /* The plate holds its own 120:84 proportion and fills whatever box it
           is given, because the box has the same proportion. Size is the
           container's job — the frame sets a width, this sets the shape. */
        height: 'auto',
        aspectRatio: '120 / 84',
        borderRadius: radius,
        display: 'block',
        ...style
      }}
      viewBox="0 0 120 84"
      /* The box is always 120:84 — `aspect-ratio` sets it, in the component and
         again on the frame — so `slice` has nothing to crop. That matters: a
         plate is a filled rectangle, and `meet` inside a box that is even
         slightly the wrong shape letterboxes the wash into a bare strip down
         one side, which is how covers first shipped. The earlier crop happened
         because callers handed the plate a fixed height against a fluid width
         (boxes of 1.9–3.1:1 around a 1.43:1 drawing); the height is a bound
         now, so the proportions agree and slice is safe. */
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="0" y="0" width="120" height="84" fill={`var(${spec.wash})`} />
      <g
        transform={`rotate(${spec.rotate} 60 42)`}
        fill="none"
        stroke="var(--art-ink)"
        strokeWidth="0.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.9"
      >
        {spec.paths.map((d, index) => (
          <path key={index} d={d} />
        ))}
      </g>
    </svg>
  );
}
