import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 8;
export const ZOOM_STEP = 0.1;

/** Breathing room between the image and the edge of its pane. */
const INSET = 32;

type Props = {
  /** natural pixel dimensions, used to work out the fitted size */
  width: number;
  height: number;
  zoom: number;
  onZoom: (zoom: number) => void;
  frameRef?: RefObject<HTMLDivElement | null>;
  onFrameClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
  frameClassName?: string;
  children: ReactNode;
};

/**
 * The image pane, shared by every tool that shows the picture.
 *
 * The frame is given an explicit pixel size rather than being left to CSS
 * `max-width`/`max-height`. That matters because zoom has to change the size
 * the browser lays out, not just how it paints: a CSS transform would scale the
 * picture but leave the scroll area the original size, so there would be
 * nothing to pan across once you zoomed in.
 *
 * Everything inside positions itself against the frame — the image fills it,
 * markers sit at percentages of it — so nothing downstream has to know the zoom
 * level, and click coordinates stay correct at any magnification.
 */
export default function Stage({
  width,
  height,
  zoom,
  onZoom,
  frameRef,
  onFrameClick,
  frameClassName = '',
  children,
}: Props) {
  const paneRef = useRef<HTMLDivElement>(null);
  const [fitted, setFitted] = useState({ w: 0, h: 0 });

  // Recompute the fit-to-pane size whenever the pane or the image changes.
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane || width === 0 || height === 0) return;

    const measure = () => {
      const available = Math.max(1, pane.clientWidth - INSET);
      const tall = Math.max(1, pane.clientHeight - INSET);
      const scale = Math.min(available / width, tall / height);
      setFitted({ w: width * scale, h: height * scale });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    return () => observer.disconnect();
  }, [width, height]);

  const w = Math.round(fitted.w * zoom);
  const h = Math.round(fitted.h * zoom);

  return (
    <div className="relative flex min-w-0 shrink-0 flex-col lg:min-h-0 lg:flex-1 lg:shrink">
      {/* `m-auto` on the child rather than centring on the flex parent: a
          centred flex item clips its own overflow at the top and left, which
          would put part of a zoomed image permanently out of reach. */}
      <div
        ref={paneRef}
        className="min-h-[52vh] overflow-auto lg:min-h-0 lg:flex-1"
      >
        <div
          ref={frameRef}
          onClick={onFrameClick}
          style={{ width: w || undefined, height: h || undefined }}
          className={`checkerboard relative m-auto overflow-hidden rounded-xl shadow-2xl ${frameClassName}`}
        >
          {children}
        </div>
      </div>

      <ZoomBar zoom={zoom} onZoom={onZoom} />
    </div>
  );
}

function ZoomBar({ zoom, onZoom }: { zoom: number; onZoom: (z: number) => void }) {
  const clamp = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
  const step = (delta: number) => onZoom(clamp(Number((zoom + delta).toFixed(2))));

  return (
    <div className="flex shrink-0 items-center justify-center gap-2 px-4 pb-3">
      <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 shadow-lg">
        <button
          type="button"
          onClick={() => step(-0.25)}
          disabled={zoom <= MIN_ZOOM}
          aria-label="Zoom out"
          className="grid h-5 w-5 place-items-center rounded text-sm text-muted transition-colors hover:text-ink disabled:opacity-30"
        >
          −
        </button>

        <input
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={ZOOM_STEP}
          value={zoom}
          onChange={(e) => onZoom(Number(e.target.value))}
          aria-label="Zoom"
          className="w-28 sm:w-40"
        />

        <button
          type="button"
          onClick={() => step(0.25)}
          disabled={zoom >= MAX_ZOOM}
          aria-label="Zoom in"
          className="grid h-5 w-5 place-items-center rounded text-sm text-muted transition-colors hover:text-ink disabled:opacity-30"
        >
          +
        </button>

        <button
          type="button"
          onClick={() => onZoom(1)}
          title="Reset to fit"
          className="w-12 rounded text-right font-mono text-[11px] tabular-nums text-muted transition-colors hover:text-ink"
        >
          {Math.round(zoom * 100)}%
        </button>
      </div>
    </div>
  );
}
