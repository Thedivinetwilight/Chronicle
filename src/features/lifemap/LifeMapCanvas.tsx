/**
 * The Life Map canvas.
 *
 * A calm, explorable drawing of the user's own archive. The layout is computed
 * in `domain/lifeMap/layout.ts`; this component only renders it and manages
 * the viewport.
 *
 * Interaction contract:
 * - **Pointer / touch**: drag to pan, pinch (or the +/− buttons) to zoom, tap a
 *   node to select. A finger tap never needs pixel precision: hits are taken
 *   within a generous radius (see `hitTest`).
 * - **Keyboard**: the canvas is focusable; arrows pan, +/− zoom, 0 fits the
 *   content, Tab moves between node buttons, Enter/Space selects. Every node is
 *   also a real <button> in the DOM, so keyboard and screen-reader users never
 *   have to operate the spatial view.
 * - **Reduced motion**: no transitions when the OS preference or the in-app
 *   setting asks for it, and no autoplay of any kind.
 * - **Hover is never required**: labels are always visible; selecting is a tap.
 *
 * The SVG is `role="group"` with a description of what it shows; the list view
 * next to it is the equivalent, complete text projection.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fitTransform,
  hitTest,
  placeLabel,
  type LifeEdge,
  type LifeMapLayout,
  type LifeNode,
  type LifeNodeKind
} from '../../domain/lifeMap/layout';
import { Icon } from '../../ui/Icon';

const KIND_LABEL: Record<LifeNodeKind, string> = {
  chapter: 'Chapter',
  experience: 'Experience',
  path: 'Path',
  place: 'Place',
  person: 'Person',
  trip: 'Trip',
  collection: 'Collection'
};

const MIN_SCALE = 0.35;
const MAX_SCALE = 2.6;

interface Transform {
  x: number;
  y: number;
  scale: number;
}

export interface LifeMapCanvasProps {
  layout: LifeMapLayout;
  selectedKey: string | null;
  onSelect: (node: LifeNode | null) => void;
  highlighted: ReadonlySet<string>;
  reducedMotion: boolean;
  /**
   * Fallback viewport height in CSS pixels. Height is normally set by CSS so it
   * can respond to the viewport (a 560px map on a 390×844 phone leaves nothing
   * for the record panel below it). The measured height is always read back.
   */
  height?: number;
  /**
   * Rebuilds the geometry for a given canvas size. The map is laid out in map
   * units and then fitted, so a fixed 920×720 design shrinks to 40% on a phone
   * and its labels become unreadable. Rebuilding at the measured size keeps
   * text at a constant on-screen size on every device.
   */
  buildAtSize?: (width: number, height: number) => LifeMapLayout;
}

export function LifeMapCanvas({
  layout: baseLayout,
  selectedKey,
  onSelect,
  highlighted,
  reducedMotion,
  buildAtSize
}: LifeMapCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 0, height: 520 });

  /* Rebuild geometry at the measured size. Until the first measure (width 0)
     the caller's layout is used so the first paint is not empty. */
  const layout = useMemo(() => {
    if (!buildAtSize || size.width === 0) return baseLayout;
    return buildAtSize(size.width, size.height);
  }, [baseLayout, buildAtSize, size.width, size.height]);
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });
  const [userMoved, setUserMoved] = useState(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const pinchRef = useRef<{ distance: number; scale: number } | null>(null);

  /* -- measure ------------------------------------------------------- */
  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    /* Height is read from the element, not the prop, so the stylesheet (and
       therefore the viewport) decides how tall the map is. */
    const measure = (): void =>
      setSize({ width: element.clientWidth, height: Math.round(element.clientHeight) });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fit = useCallback(() => {
    if (size.width === 0) return;
    setTransform(fitTransform(layout.bounds, { width: size.width, height: size.height }));
    setUserMoved(false);
  }, [layout.bounds, size.width, size.height]);

  /* Fit on first measure and whenever the content changes shape, unless the
     user has deliberately moved the view — their position is not stolen. */
  useEffect(() => {
    if (size.width === 0) return;
    if (userMoved) return;
    setTransform(fitTransform(layout.bounds, { width: size.width, height: size.height }));
  }, [layout.bounds, size.width, size.height, userMoved]);

  /* -- zoom ---------------------------------------------------------- */
  const zoomBy = useCallback(
    (factor: number) => {
      setUserMoved(true);
      setTransform((current) => {
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * factor));
        const cx = size.width / 2;
        const cy = size.height / 2;
        // Zoom around the viewport centre, not the origin.
        const ratio = scale / current.scale;
        return {
          scale,
          x: cx - (cx - current.x) * ratio,
          y: cy - (cy - current.y) * ratio
        };
      });
    },
    [size.width, size.height]
  );

  /* -- wheel: zoom with ctrl/⌘ (trackpad pinch), pan otherwise -------- */
  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent): void => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12);
        return;
      }
      if (Math.abs(event.deltaX) < 1 && Math.abs(event.deltaY) < 1) return;
      event.preventDefault();
      setUserMoved(true);
      setTransform((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  /* -- pointer drag & pinch ----------------------------------------- */
  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const target = event.target as Element;
    if (target.closest('[data-node="true"]')) return; // selection handles it
    (event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: transform.x,
      originY: transform.y
    };
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) setUserMoved(true);
    setTransform((current) => ({ ...current, x: drag.originX + dx, y: drag.originY + dy }));
  };

  const endDrag = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const onTouchStart = (event: React.TouchEvent): void => {
    if (event.touches.length !== 2) return;
    const [a, b] = [event.touches[0]!, event.touches[1]!];
    pinchRef.current = { distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), scale: transform.scale };
  };

  const onTouchMove = (event: React.TouchEvent): void => {
    const pinch = pinchRef.current;
    if (!pinch || event.touches.length !== 2) return;
    const [a, b] = [event.touches[0]!, event.touches[1]!];
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (pinch.distance <= 0) return;
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (pinch.scale * distance) / pinch.distance));
    setUserMoved(true);
    setTransform((current) => {
      const ratio = next / current.scale;
      const cx = size.width / 2;
      const cy = size.height / 2;
      return { scale: next, x: cx - (cx - current.x) * ratio, y: cy - (cy - current.y) * ratio };
    });
  };

  const onTouchEnd = (): void => {
    pinchRef.current = null;
  };

  /* -- keyboard ------------------------------------------------------ */
  const onKeyDown = (event: React.KeyboardEvent<SVGSVGElement>): void => {
    const step = event.shiftKey ? 80 : 32;
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        setUserMoved(true);
        setTransform((current) => ({ ...current, x: current.x + step }));
        break;
      case 'ArrowRight':
        event.preventDefault();
        setUserMoved(true);
        setTransform((current) => ({ ...current, x: current.x - step }));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setUserMoved(true);
        setTransform((current) => ({ ...current, y: current.y + step }));
        break;
      case 'ArrowDown':
        event.preventDefault();
        setUserMoved(true);
        setTransform((current) => ({ ...current, y: current.y - step }));
        break;
      case '+':
      case '=':
        event.preventDefault();
        zoomBy(1.18);
        break;
      case '-':
      case '_':
        event.preventDefault();
        zoomBy(1 / 1.18);
        break;
      case '0':
        event.preventDefault();
        fit();
        break;
      case 'Escape':
        onSelect(null);
        break;
      default:
        break;
    }
  };

  const chooseNearest = (point: { x: number; y: number }): void => {
    const world = {
      x: (point.x - transform.x) / transform.scale,
      y: (point.y - transform.y) / transform.scale
    };
    const node = hitTest(layout.nodes, world.x, world.y);
    onSelect(node ?? null);
  };

  /* On a narrow canvas there is simply no way to draw eleven legible labels in
     350 CSS pixels: each label is ~120px wide, so 11 of them need over three
     times the available width. Rather than shrink type below the legibility
     floor, narrow canvases label the *structure* — chapters and paths — plus
     the node you have selected. Every other node keeps its shape, its position
     and its tap target, and one tap names it. This is how graph views behave on
     phones, and the outline view lists everything in text regardless. */
  const labelAll = size.width >= 640;
  const showLabel = (key: string, kind: LifeNodeKind): boolean =>
    key === selectedKey
      ? true
      : labelAll || kind === 'chapter' || kind === 'path';

  const nodeByKey = useMemo(() => new Map(layout.nodes.map((node) => [node.key, node])), [layout.nodes]);
  const selected = selectedKey ? nodeByKey.get(selectedKey) ?? null : null;
  const transition = reducedMotion ? 'none' : 'transform 140ms var(--ease-out)';
  const dimmed = (key: string): boolean => highlighted.size > 0 && !highlighted.has(key);

  /* The scene is drawn in viewBox units and transformed by a <g>. */
  return (
    <div className="lifemap" ref={wrapRef}>
      <svg
        ref={svgRef}
        className="lifemap__canvas"
        viewBox={`0 0 ${Math.max(size.width, 1)} ${size.height}`}
        role="group"
        aria-label="Life map. Use arrow keys to pan, plus and minus to zoom, 0 to fit. Each node is also listed in the map outline."
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={(event) => {
          const target = event.target as Element;
          if (target.closest('[data-node="true"]')) return;
          const rect = svgRef.current?.getBoundingClientRect();
          if (!rect) return;
          chooseNearest({ x: event.clientX - rect.left, y: event.clientY - rect.top });
        }}
      >
        <defs>
          <radialGradient id="lifemap-canvas" cx="50%" cy="45%" r="70%">
            <stop offset="0%" stopColor="var(--map-canvas)" />
            <stop offset="100%" stopColor="var(--map-canvas-deep)" />
          </radialGradient>
        </defs>
        <rect width={Math.max(size.width, 1)} height={size.height} fill="url(#lifemap-canvas)" />
        <g style={{ transition, transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}>
          {/* Rings: quiet structure, not a progress target. */}
          {[0.42, 0.7, 0.95].map((fraction, index) => (
            <circle
              key={fraction}
              cx={layout.width / 2}
              cy={layout.height / 2}
              r={(Math.min(layout.width, layout.height) / 2) * fraction}
              className="lifemap__ring"
              aria-hidden="true"
              data-ring={index}
            />
          ))}

          {/* Edges first, so nodes stay above them. */}
          <g aria-hidden="true">
            {layout.edges.map((edge) => (
              <EdgePath
                key={edge.id}
                edge={edge}
                nodes={nodeByKey}
                selectedKey={selectedKey}
                dimmed={dimmed(edge.from) && dimmed(edge.to)}
              />
            ))}
          </g>

          {/* Centre: "you" — not a record, and labelled as the viewer. */}
          <g className="lifemap__self" aria-hidden="true">
            <circle cx={layout.width / 2} cy={layout.height / 2} r={30} className="lifemap__self-halo" />
            <circle cx={layout.width / 2} cy={layout.height / 2} r={9} className="lifemap__self-dot" />
            <text x={layout.width / 2} y={layout.height / 2 + 46} textAnchor="middle" className="lifemap__self-label">
              You
            </text>
          </g>

          {/* Axes: the map's grammar. Dashed = date not known. */}
          <g aria-hidden="true">
            {layout.axes.map((axis, index) => {
              const cx = layout.width / 2;
              const cy = layout.height / 2;
              const isPath = layout.nodes.some((node) => node.kind === 'path' && node.id === axis.chapterId);
              const start = {
                x: cx + Math.cos(axis.angle) * axis.startRadius,
                y: cy + Math.sin(axis.angle) * axis.startRadius
              };
              const end = {
                x: cx + Math.cos(axis.angle) * axis.endRadius,
                y: cy + Math.sin(axis.angle) * axis.endRadius
              };
              return (
                <line
                  key={`axis-${axis.chapterId}-${index}`}
                  x1={start.x}
                  y1={start.y}
                  x2={end.x}
                  y2={end.y}
                  className={isPath ? 'lifemap__axis lifemap__axis--path' : 'lifemap__axis'}
                  strokeDasharray={axis.undated ? '3 7' : undefined}
                  data-undated={axis.undated ? 'true' : undefined}
                />
              );
            })}
          </g>

          {/* Nodes. Each is a real button; the SVG group around it is the hit
              area, and the label is always rendered (no hover requirement). */}
          {layout.nodes.map((node) => (
            <NodeGlyph
              key={node.key}
              node={node}
              labels={layout.labels}
              mapWidth={layout.width}
              mapHeight={layout.height}
              showLabel={showLabel(node.key, node.kind)}
              selected={node.key === selectedKey}
              dimmed={dimmed(node.key)}
              onSelect={() => onSelect(node)}
            />
          ))}
        </g>
      </svg>

      <div className="lifemap__controls" role="toolbar" aria-label="Map view controls" aria-controls={undefined}>
        <button
          type="button"
          className="lifemap__control"
          onClick={() => zoomBy(1.18)}
          aria-label="Zoom in"
          title="Zoom in (+)"
        >
          <Icon name="zoom-in" size={18} />
        </button>
        <button
          type="button"
          className="lifemap__control"
          onClick={() => zoomBy(1 / 1.18)}
          aria-label="Zoom out"
          title="Zoom out (−)"
        >
          <Icon name="zoom-out" size={18} />
        </button>
        <button type="button" className="lifemap__control" onClick={fit} aria-label="Fit the map to the screen" title="Fit (0)">
          <Icon name="fit" size={18} />
        </button>
      </div>

      <p className="lifemap__hint text-xs text-faint">
        {labelAll
          ? 'Drag to move · pinch or use the buttons to zoom · tap a node to open it'
          : 'Tap a node to name it · pinch to zoom · Outline lists every record'}
      </p>

      {selected ? (
        <p className="sr-only" role="status">
          {KIND_LABEL[selected.kind]} selected: {selected.label}
        </p>
      ) : null}
      {layout.nodes.length === 0 ? null : null}
      <span className="sr-only">
        {layout.nodes.length} nodes and {layout.edges.length} connections are drawn.
        {layout.counts.suggestedLinks > 0
          ? ` ${layout.counts.suggestedLinks} suggested connections are listed separately and are not drawn.`
          : ''}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Edges
 * ------------------------------------------------------------------ */

function EdgePath({
  edge,
  nodes,
  selectedKey,
  dimmed
}: {
  edge: LifeEdge;
  nodes: Map<string, LifeNode>;
  selectedKey: string | null;
  dimmed: boolean;
}) {
  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);
  if (!from || !to) return null;
  const cx = (from.x + to.x) / 2;
  const cy = (from.y + to.y) / 2;
  // A gentle bow away from the centre keeps edges from stacking on the axes.
  const bow = 0.12;
  const control = {
    x: cx + (cx - (from.x + to.x) / 2) * bow + (to.y - from.y) * bow,
    y: cy + (to.x - from.x) * bow
  };
  const isActive = selectedKey === edge.from || selectedKey === edge.to;
  const className = [
    'lifemap__edge',
    `lifemap__edge--${edge.kind}`,
    isActive ? 'is-active' : '',
    dimmed ? 'is-dimmed' : ''
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <>
      <path d={`M ${from.x} ${from.y} Q ${control.x} ${control.y} ${to.x} ${to.y}`} className={className} />
      <title>{edge.label}</title>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Nodes — shape differs by kind, so colour is never the only signal
 * ------------------------------------------------------------------ */

function NodeGlyph({
  node,
  labels,
  mapWidth,
  mapHeight,
  showLabel,
  selected,
  dimmed,
  onSelect
}: {
  node: LifeNode;
  labels: LifeMapLayout['labels'];
  mapWidth: number;
  mapHeight: number;
  /** False on narrow canvases for nodes that are not structure or selection. */
  showLabel: boolean;
  selected: boolean;
  dimmed: boolean;
  onSelect: () => void;
}) {
  const kindClass = `lifemap__node lifemap__node--${node.kind}`;
  const className = [kindClass, selected ? 'is-selected' : '', dimmed ? 'is-dimmed' : ''].filter(Boolean).join(' ');

  /* Draw the placement the layout already resolved. Recomputing here would
     reintroduce the collisions the resolver removed (and the clipping the
     bounds calculation now prevents). A node with no placement is one the
     narrow-canvas mode deliberately does not label. */
  const resolved = labels.get(node.key);
  const placement = resolved ?? placeLabel(node, mapWidth, mapHeight);
  const { x, anchor, y: labelY } = placement;
  const uncertainY = labelY > node.y ? labelY + 13 : labelY - 13;

  return (
    <g
      className={className}
      data-node="true"
      role="button"
      tabIndex={0}
      aria-label={`${KIND_LABEL[node.kind]}: ${node.label}. ${node.description}`}
      aria-pressed={selected}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <circle cx={node.x} cy={node.y} r={node.r + 13} className="lifemap__hit" />
      <Glyph node={node} selected={selected} />
      {showLabel ? (
        <text x={x} y={labelY} textAnchor={anchor} className="lifemap__label">
          {node.label}
        </text>
      ) : null}
      {showLabel && node.uncertain ? (
        <text x={x} y={uncertainY} textAnchor={anchor} className="lifemap__uncertain">
          date not exact
        </text>
      ) : null}
      <title>{node.description}</title>
    </g>
  );
}

function Glyph({ node, selected }: { node: LifeNode; selected: boolean }) {
  const common = { cx: node.x, cy: node.y, className: 'lifemap__shape' };
  switch (node.kind) {
    case 'chapter':
      // Diamond: an era, not a point.
      return (
        <g className="lifemap__shape-wrap">
          <Rect x={node.x - node.r} y={node.y - node.r} r={node.r} rotate={45} selected={selected} className="lifemap__shape--chapter" />
        </g>
      );
    case 'path':
      return (
        <g className="lifemap__shape-wrap">
          <circle {...common} r={node.r} />
          <circle {...common} r={node.r + 4.5} className="lifemap__shape-ring" />
        </g>
      );
    case 'place':
      return (
        <g className="lifemap__shape-wrap">
          <path
            d={pinPath(node.x, node.y, node.r)}
            className="lifemap__shape lifemap__shape--place"
          />
        </g>
      );
    case 'person':
      return (
        <g className="lifemap__shape-wrap">
          <circle {...common} r={node.r} />
          <circle cx={node.x} cy={node.y - node.r * 0.25} r={node.r * 0.32} className="lifemap__shape-detail" />
          <path
            d={`M ${node.x - node.r * 0.6} ${node.y + node.r * 0.6} a ${node.r * 0.6} ${node.r * 0.55} 0 0 1 ${node.r * 1.2} 0`}
            className="lifemap__shape-detail"
            fill="none"
          />
        </g>
      );
    case 'trip':
      return (
        <g className="lifemap__shape-wrap">
          <circle {...common} r={node.r} />
          <path
            d={`M ${node.x - node.r * 0.5} ${node.y} h ${node.r} M ${node.x} ${node.y - node.r * 0.5} v ${node.r}`}
            className="lifemap__shape-detail"
            fill="none"
          />
        </g>
      );
    case 'collection':
      return (
        <g className="lifemap__shape-wrap">
          <Rect x={node.x - node.r * 0.85} y={node.y - node.r * 0.85} r={node.r * 0.85} rotate={0} selected={selected} className="lifemap__shape--collection" />
        </g>
      );
    default:
      return (
        <g className="lifemap__shape-wrap">
          <circle {...common} r={node.r} />
        </g>
      );
  }
}

/**
 * A square glyph, optionally rotated into a diamond. Chapters are diamonds and
 * collections are squares, so the two read differently in greyscale as well as
 * in colour.
 */
function Rect({
  x,
  y,
  r,
  rotate,
  selected,
  className
}: {
  x: number;
  y: number;
  r: number;
  rotate: number;
  selected: boolean;
  className: string;
}) {
  return (
    <rect
      x={x}
      y={y}
      width={r * 2}
      height={r * 2}
      rx={rotate === 45 ? 2 : 3}
      className={`lifemap__shape ${className} ${selected ? 'is-selected' : ''}`}
      transform={rotate ? `rotate(${rotate} ${x + r} ${y + r})` : undefined}
    />
  );
}

function pinPath(x: number, y: number, r: number): string {
  const top = y - r * 1.15;
  const base = y + r * 0.95;
  return `M ${x} ${base} C ${x - r * 1.25} ${y + r * 0.1} ${x - r} ${top} ${x} ${top} C ${x + r} ${top} ${x + r * 1.25} ${y + r * 0.1} ${x} ${base} Z`;
}

export { KIND_LABEL as LIFE_NODE_KIND_LABEL };
