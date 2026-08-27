import type { JSX } from 'react';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { SceneData } from '../storage/types';

/**
 * Draws a thumbnail of a scene directly from element geometry.
 *
 * Excalidraw ships exportToSvg, but importing it would pull the entire editor
 * back into a content script that runs on every excalidraw.com page load -- the
 * exact cost the content-script architecture exists to avoid. A few hundred
 * lines of SVG covers what a thumbnail needs.
 *
 * This is an approximation, deliberately. There is no roughjs hand-drawn
 * wobble, hachure fills render as flat translucent colour, and fonts are
 * whatever the panel has. It is for recognising "which drawing is this", not
 * for reproducing it.
 */

/** Beyond this, an SVG thumbnail costs more than it is worth. */
const MAX_ELEMENTS = 1200;

type El = OrderedExcalidrawElement & {
  points?: readonly (readonly [number, number])[];
  text?: string;
  fontSize?: number;
  fileId?: string;
  containerId?: string | null;
};

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function elementBounds(el: El): Bounds | null {
  const { x, y } = el;
  if (typeof x !== 'number' || typeof y !== 'number') return null;

  // Linear and freedraw elements carry their extent in `points`, relative to
  // the element origin; width/height alone would miss negative offsets.
  if (Array.isArray(el.points) && el.points.length) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of el.points) {
      if (!Array.isArray(p)) continue;
      minX = Math.min(minX, p[0]);
      minY = Math.min(minY, p[1]);
      maxX = Math.max(maxX, p[0]);
      maxY = Math.max(maxY, p[1]);
    }
    if (minX === Infinity) return null;
    return { minX: x + minX, minY: y + minY, maxX: x + maxX, maxY: y + maxY };
  }

  const w = typeof el.width === 'number' ? el.width : 0;
  const h = typeof el.height === 'number' ? el.height : 0;
  return { minX: x, minY: y, maxX: x + w, maxY: y + h };
}

function sceneBounds(elements: readonly El[]): Bounds | null {
  let box: Bounds | null = null;
  for (const el of elements) {
    const b = elementBounds(el);
    if (!b) continue;
    box = box
      ? {
          minX: Math.min(box.minX, b.minX),
          minY: Math.min(box.minY, b.minY),
          maxX: Math.max(box.maxX, b.maxX),
          maxY: Math.max(box.maxY, b.maxY),
        }
      : b;
  }
  return box;
}

function dashFor(el: El): string | undefined {
  const width = typeof el.strokeWidth === 'number' ? el.strokeWidth : 1;
  if (el.strokeStyle === 'dashed') return `${width * 4} ${width * 3}`;
  if (el.strokeStyle === 'dotted') return `${width} ${width * 2}`;
  return undefined;
}

function fillFor(el: El): { fill: string; fillOpacity?: number } {
  const bg = el.backgroundColor;
  if (!bg || bg === 'transparent') return { fill: 'none' };
  // hachure and cross-hatch are drawn as strokes by roughjs; flat translucent
  // colour reads closer than a solid block at thumbnail size.
  const solid = el.fillStyle === 'solid';
  return { fill: bg, fillOpacity: solid ? 1 : 0.45 };
}

function points(el: El): string {
  if (!Array.isArray(el.points)) return '';
  return el.points
    .filter((p) => Array.isArray(p))
    .map((p) => `${el.x + p[0]},${el.y + p[1]}`)
    .join(' ');
}

function renderElement(el: El, files: SceneData['files']): JSX.Element | null {
  const stroke = el.strokeColor || '#1b1b1f';
  const strokeWidth = typeof el.strokeWidth === 'number' ? el.strokeWidth : 1;
  const opacity = typeof el.opacity === 'number' ? el.opacity / 100 : 1;
  const dash = dashFor(el);
  const { fill, fillOpacity } = fillFor(el);

  const cx = el.x + (el.width ?? 0) / 2;
  const cy = el.y + (el.height ?? 0) / 2;
  const angle = typeof el.angle === 'number' ? el.angle : 0;
  const common = {
    stroke,
    strokeWidth,
    strokeDasharray: dash,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    opacity,
    transform: angle ? `rotate(${(angle * 180) / Math.PI} ${cx} ${cy})` : undefined,
  };

  switch (el.type) {
    case 'rectangle':
    case 'frame':
    case 'magicframe':
    case 'embeddable':
    case 'iframe': {
      // roundness.type 3 is the "round" preset; anything else is sharp.
      const r = el.roundness ? Math.min(16, Math.min(el.width ?? 0, el.height ?? 0) * 0.15) : 0;
      return (
        <rect
          x={el.x}
          y={el.y}
          width={Math.max(0, el.width ?? 0)}
          height={Math.max(0, el.height ?? 0)}
          rx={r}
          fill={fill}
          fillOpacity={fillOpacity}
          {...common}
        />
      );
    }

    case 'ellipse':
      return (
        <ellipse
          cx={cx}
          cy={cy}
          rx={Math.max(0, (el.width ?? 0) / 2)}
          ry={Math.max(0, (el.height ?? 0) / 2)}
          fill={fill}
          fillOpacity={fillOpacity}
          {...common}
        />
      );

    case 'diamond': {
      const w = el.width ?? 0;
      const h = el.height ?? 0;
      const pts = `${el.x + w / 2},${el.y} ${el.x + w},${el.y + h / 2} ${el.x + w / 2},${el.y + h} ${el.x},${el.y + h / 2}`;
      return <polygon points={pts} fill={fill} fillOpacity={fillOpacity} {...common} />;
    }

    case 'line':
    case 'arrow':
    case 'freedraw': {
      const pts = points(el);
      if (!pts) return null;
      return (
        <polyline
          points={pts}
          fill={el.type === 'freedraw' ? 'none' : fill}
          fillOpacity={el.type === 'freedraw' ? undefined : fillOpacity}
          {...common}
        />
      );
    }

    case 'text': {
      const size = typeof el.fontSize === 'number' ? el.fontSize : 16;
      const lines = String(el.text ?? '').split('\n');
      return (
        <text
          x={el.x}
          y={el.y + size * 0.85}
          fontSize={size}
          fill={stroke}
          opacity={opacity}
          transform={common.transform}
        >
          {lines.map((line, i) => (
            <tspan key={i} x={el.x} dy={i === 0 ? 0 : size * 1.25}>
              {line}
            </tspan>
          ))}
        </text>
      );
    }

    case 'image': {
      const data = el.fileId ? files[el.fileId]?.dataURL : undefined;
      if (!data) {
        // The image bytes were never captured; show its footprint rather than
        // silently leaving a hole in the layout.
        return (
          <rect
            x={el.x}
            y={el.y}
            width={Math.max(0, el.width ?? 0)}
            height={Math.max(0, el.height ?? 0)}
            fill="#00000010"
            stroke="#00000030"
            strokeDasharray="6 4"
            opacity={opacity}
          />
        );
      }
      return (
        <image
          href={data}
          x={el.x}
          y={el.y}
          width={Math.max(0, el.width ?? 0)}
          height={Math.max(0, el.height ?? 0)}
          opacity={opacity}
          transform={common.transform}
          preserveAspectRatio="none"
        />
      );
    }

    default:
      return null;
  }
}

interface Props {
  scene: SceneData;
  width?: number;
  height?: number;
}

export function ScenePreview({ scene, width = 260, height = 180 }: Props) {
  const all = scene.elements as readonly El[];
  const visible = all.filter((el) => !el.isDeleted);

  if (visible.length === 0) {
    return (
      <div className="preview-empty" style={{ width, height }}>
        Empty drawing
      </div>
    );
  }

  const shown = visible.slice(0, MAX_ELEMENTS);
  const box = sceneBounds(shown);
  if (!box) {
    return (
      <div className="preview-empty" style={{ width, height }}>
        Nothing to show
      </div>
    );
  }

  const pad = 12;
  const w = Math.max(1, box.maxX - box.minX);
  const h = Math.max(1, box.maxY - box.minY);
  const background = scene.appState.viewBackgroundColor || '#ffffff';

  return (
    <div className="preview" style={{ width, height, background }}>
      <svg
        width={width}
        height={height}
        viewBox={`${box.minX - pad} ${box.minY - pad} ${w + pad * 2} ${h + pad * 2}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Preview of a drawing with ${visible.length} elements`}
      >
        {shown.map((el, i) => (
          <g key={el.id ?? i}>{renderElement(el, scene.files ?? {})}</g>
        ))}
      </svg>
      {visible.length > shown.length && (
        <span className="preview-more">+{visible.length - shown.length} more</span>
      )}
    </div>
  );
}
