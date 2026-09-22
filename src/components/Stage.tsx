import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 8;
export const ZOOM_STEP = 0.1;

/** Breathing room between the image and the edge of its pane. */
const INSET = 32;

/**
 * How far the pointer must travel before a press counts as a pan rather than a
 * click. Without it, the tiny movement in any real click would swallow every
 * attempt to pick a colour.
 */
const PAN_THRESHOLD = 5;

/**
 * How long a still press becomes a hold. Long enough that dragging to pan
 * never trips it, short enough not to feel stuck.
 */
const HOLD_MS = 220;

type Props = {
  /** natural pixel dimensions, used to work out the fitted size */
  width: number;
  height: number;
  zoom: number;
  onZoom: (zoom: number) => void;
  frameRef?: RefObject<HTMLDivElement | null>;
  onFrameClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
  frameClassName?: string;
  /**
   * Press-and-hold, reported in 0-1 image coordinates. Supplying these turns on
   * the hold gesture; without them a press is only ever a click or a pan.
   */
  onHoldStart?: (x: number, y: number) => void;
  onHoldMove?: (x: number, y: number) => void;
  onHoldEnd?: (x: number, y: number) => void;
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
  onHoldStart,
  onHoldMove,
  onHoldEnd,
  children,
}: Props) {
  const paneRef = useRef<HTMLDivElement>(null);
  const [fitted, setFitted] = useState({ w: 0, h: 0 });

  // Where the drag started, and the scroll position it started from.
  const panFrom = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  // Set once a press has travelled far enough to be a pan; read by the click
  // handler so the release doesn't also register as a click on the image.
  const panned = useRef(false);
  const [panning, setPanning] = useState(false);

  // One place decides what a press turns into, so panning and magnifying can
  // never both claim the same gesture.
  const gesture = useRef<'idle' | 'pending' | 'pan' | 'hold'>('idle');
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<HTMLDivElement | null>(null);

  // The point of the image currently in the middle of the pane. Zooming keeps
  // this fixed, so the view grows around whatever you are looking at rather
  // than creeping towards the top-left corner.
  const anchor = useRef({ x: 0.5, y: 0.5 });

  const attachFrame = (el: HTMLDivElement | null) => {
    frame.current = el;
    if (frameRef) frameRef.current = el;
  };

  /** Client coordinates to 0-1 within the image. */
  const normalise = (clientX: number, clientY: number) => {
    const rect = frame.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    };
  };

  const clearHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  useEffect(() => clearHold, []);

  // Recompute the fit-to-pane size whenever the pane or the image changes.
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane || width === 0 || height === 0) return;

    const measure = () => {
      // offsetWidth/Height rather than clientWidth/Height: the latter shrinks
      // the instant a scrollbar appears, which — at sizes where the fit sits
      // right on the edge of overflowing — would make that shrink remove the
      // overflow, remove the scrollbar, grow clientWidth back, and repeat
      // forever. The outer box is unaffected by a scrollbar drawn inside it.
      const available = Math.max(1, pane.offsetWidth - INSET);
      const tall = Math.max(1, pane.offsetHeight - INSET);
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

  /** Remember what is centred, so a later resize can put it back. */
  const captureAnchor = () => {
    const pane = paneRef.current;
    const fr = frame.current;
    if (!pane || !fr) return;

    const p = pane.getBoundingClientRect();
    const f = fr.getBoundingClientRect();
    if (f.width === 0 || f.height === 0) return;

    anchor.current = {
      x: Math.min(1, Math.max(0, (p.left + p.width / 2 - f.left) / f.width)),
      y: Math.min(1, Math.max(0, (p.top + p.height / 2 - f.top) / f.height)),
    };
  };

  // Runs after the frame has been laid out at its new size but before paint,
  // so the correction is never visible as a jump.
  useLayoutEffect(() => {
    const pane = paneRef.current;
    const fr = frame.current;
    if (!pane || !fr || w === 0 || h === 0) return;

    const p = pane.getBoundingClientRect();
    const f = fr.getBoundingClientRect();

    // Scroll by however far the anchor has drifted from the middle. Measuring
    // rather than calculating means centring margins and insets are already
    // accounted for, and the browser clamps the result at the edges.
    pane.scrollLeft += f.left + anchor.current.x * f.width - (p.left + p.width / 2);
    pane.scrollTop += f.top + anchor.current.y * f.height - (p.top + p.height / 2);
  }, [w, h]);

  const overflows = () => {
    const pane = paneRef.current;
    return (
      !!pane &&
      (pane.scrollWidth > pane.clientWidth || pane.scrollHeight > pane.clientHeight)
    );
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Touch already pans natively, with momentum — taking it over would be
    // strictly worse.
    if (event.pointerType === 'touch' || event.button !== 0) return;
    // Markers and controls own their own presses.
    if ((event.target as Element).closest('button')) return;

    const pane = paneRef.current;
    if (!pane) return;

    panFrom.current = {
      x: event.clientX,
      y: event.clientY,
      left: pane.scrollLeft,
      top: pane.scrollTop,
    };
    panned.current = false;
    gesture.current = 'pending';

    if (!onHoldStart) return;

    const { clientX, clientY, pointerId } = event;
    clearHold();
    holdTimer.current = setTimeout(() => {
      // Still here after the delay, so this is a hold rather than a drag.
      if (gesture.current !== 'pending') return;
      const at = normalise(clientX, clientY);
      if (!at) return;
      gesture.current = 'hold';
      pane.setPointerCapture(pointerId);
      onHoldStart(at.x, at.y);
    }, HOLD_MS);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const from = panFrom.current;
    const pane = paneRef.current;
    if (!from || !pane) return;

    if (gesture.current === 'hold') {
      const at = normalise(event.clientX, event.clientY);
      if (at) onHoldMove?.(at.x, at.y);
      return;
    }

    const dx = event.clientX - from.x;
    const dy = event.clientY - from.y;

    if (gesture.current === 'pending') {
      if (Math.hypot(dx, dy) < PAN_THRESHOLD) return;
      // Moved first, so it is a drag, not a hold.
      clearHold();
      if (!overflows()) {
        gesture.current = 'idle';
        return;
      }
      gesture.current = 'pan';
      panned.current = true;
      setPanning(true);
      // Capture so the pan keeps following the pointer once it leaves the pane.
      pane.setPointerCapture(event.pointerId);
    }

    if (gesture.current === 'pan') {
      pane.scrollLeft = from.left - dx;
      pane.scrollTop = from.top - dy;
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    clearHold();
    const pane = paneRef.current;
    if (pane?.hasPointerCapture(event.pointerId)) {
      pane.releasePointerCapture(event.pointerId);
    }

    if (gesture.current === 'hold') {
      const at = normalise(event.clientX, event.clientY);
      if (at) onHoldEnd?.(at.x, at.y);
      // The release also fires a click; swallow it so the colour isn't taken
      // twice, once from the glass and once from the click underneath.
      panned.current = true;
    }

    panFrom.current = null;
    gesture.current = 'idle';
    setPanning(false);
  };

  return (
    <div className="relative flex min-w-0 shrink-0 flex-col lg:min-h-0 lg:flex-1 lg:shrink">
      {/* `m-auto` on the child rather than centring on the flex parent: a
          centred flex item clips its own overflow at the top and left, which
          would put part of a zoomed image permanently out of reach. */}
      <div
        ref={paneRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onScroll={captureAnchor}
        className={`flex min-h-[52vh] overflow-auto lg:min-h-0 lg:flex-1 ${
          panning ? 'cursor-grabbing select-none' : ''
        }`}
      >
        <div
          ref={attachFrame}
          onClick={(event) => {
            // A drag ends in a click event too; swallow that one so panning
            // across the picture doesn't also drop a colour on it.
            if (panned.current) {
              panned.current = false;
              return;
            }
            onFrameClick?.(event);
          }}
          style={{ width: w || undefined, height: h || undefined }}
          // A flex parent plus `m-auto` centres on both axes and still scrolls
          // to every edge when zoomed; `justify-center` would clip the overflow
          // at the top and left instead.
          className={`checkerboard relative m-auto shrink-0 overflow-hidden rounded-xl shadow-2xl ${frameClassName}`}
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
