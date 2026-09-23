import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  MAX_PICKS,
  MIN_PICKS,
  type Pick,
} from '../hooks/usePicks';
import { formatAll, readableTextOn, rgbToHex } from '../lib/colour';
import Loupe from './Loupe';

/** Travel before a press on a bar becomes a reorder rather than a copy. */
const REORDER_THRESHOLD = 6;
/** How long the carried bar takes to fall into its new slot once released. */
const SETTLE_MS = 180;
import type { LoadedImage } from '../lib/loadImage';
import Stage from './Stage';

type Props = {
  image: LoadedImage;
  picks: Pick[];
  count: number;
  onStep: (delta: number) => void;
  onMove: (id: string, x: number, y: number) => void;
  dragging: string | null;
  setDragging: (id: string | null) => void;
  onReset: () => void;
  edited: boolean;
  onCopy: (label: string, value: string) => void;
  onReorder: (from: number, to: number) => void;
  onExportPng: () => void;
  onShare: () => void;
  zoom: number;
  onZoom: (zoom: number) => void;
};

export default function PalettePicker({
  image,
  picks,
  count,
  onStep,
  onMove,
  dragging,
  setDragging,
  onReset,
  edited,
  onCopy,
  onReorder,
  onExportPng,
  onShare,
  zoom,
  onZoom,
}: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  /**
   * A bar being carried. The slots are measured once, at the moment the drag
   * starts, so the maths stays in one fixed frame of reference — the bars are
   * only ever moved by transforms, and the array order is left alone until the
   * bar is dropped. Re-measuring mid-drag would mean chasing positions that
   * the drag itself is changing.
   */
  const carry = useRef<{
    index: number;
    x: number;
    y: number;
    moved: boolean;
    /** a row from sm up, a stacked column on a phone */
    axis: 'x' | 'y';
    /** each slot's offset and length along that axis */
    slots: { start: number; size: number }[];
    bounds: { start: number; end: number };
    /** the slot it would drop into right now */
    to: number;
  } | null>(null);
  // Click-to-copy fires after the release that ended a drag; this swallows it.
  const dragged = useRef(false);
  const settleTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    },
    [],
  );

  /**
   * True for the single frame in which the new order is committed.
   *
   * Dropping ends with two things happening at once: the array reorders, and
   * the transforms that were holding the bars aside are dropped. React keeps
   * each bar's element and moves it to its new slot, so without this the
   * leftover transform would animate back to zero from the *new* slot — one
   * last unasked-for slide sideways, after the bar had already landed.
   */
  const [committing, setCommitting] = useState(false);

  const [carrying, setCarrying] = useState<{
    from: number;
    to: number;
    /** how far the carried bar has travelled from its slot, in px */
    offset: number;
    axis: 'x' | 'y';
    size: number;
    /** true once released: the bar is animating into its new slot */
    settling: boolean;
  } | null>(null);

  const startCarry = (index: number) => (event: ReactPointerEvent<HTMLElement>) => {
    // Mid-settle the strip is still catching up; a second grab would measure
    // slots that are about to move.
    if (event.button !== 0 || carrying) return;
    const strip = stripRef.current;
    if (!strip) return;

    const bars = [...strip.children] as HTMLElement[];
    const rects = bars.map((bar) => bar.getBoundingClientRect());
    const axis = rects.length > 1 && rects[1].left - rects[0].left > 1 ? 'x' : 'y';
    const box = strip.getBoundingClientRect();

    event.currentTarget.setPointerCapture(event.pointerId);
    dragged.current = false;
    carry.current = {
      index,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      axis,
      slots: rects.map((r) =>
        axis === 'x' ? { start: r.left, size: r.width } : { start: r.top, size: r.height },
      ),
      bounds:
        axis === 'x' ? { start: box.left, end: box.right } : { start: box.top, end: box.bottom },
      to: index,
    };
  };

  const moveCarry = (event: ReactPointerEvent<HTMLElement>) => {
    const held = carry.current;
    if (!held) return;

    if (!held.moved) {
      const travelled = Math.hypot(event.clientX - held.x, event.clientY - held.y);
      if (travelled < REORDER_THRESHOLD) return;
      held.moved = true;
      dragged.current = true;
    }

    const { axis, slots, index } = held;
    const slot = slots[index];
    const travel = axis === 'x' ? event.clientX - held.x : event.clientY - held.y;
    // The bar follows the pointer, but never leaves the strip.
    const offset = Math.min(
      held.bounds.end - (slot.start + slot.size),
      Math.max(held.bounds.start - slot.start, travel),
    );

    // The slot the bar's own centre is standing in — not the pointer's, and
    // not "every slot whose midpoint it has passed". Whichever slot the bar is
    // over is the one that opens up, so the gap stays under the bar being
    // carried instead of trailing half a slot behind it.
    const centre = slot.start + slot.size / 2 + offset;
    let to = slots.length - 1;
    for (let i = 0; i < slots.length; i++) {
      if (centre < slots[i].start + slots[i].size) {
        to = i;
        break;
      }
    }

    held.to = to;
    setCarrying({ from: index, to, offset, axis, size: slot.size, settling: false });
  };

  const endCarry = (event: ReactPointerEvent<HTMLElement>) => {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const held = carry.current;
    carry.current = null;

    if (!held?.moved) {
      setCarrying(null);
      return;
    }

    // Let go and the bar glides the rest of the way into its slot, rather than
    // snapping there. The array is only reordered once that has landed, so the
    // bars never jump between the animation ending and the new order arriving.
    const { slots, index } = held;
    const from = slots[index];
    const target = held.to;
    const landing =
      target > index
        ? slots[target].start + slots[target].size - from.size - from.start
        : target < index
          ? slots[target].start - from.start
          : 0;

    setCarrying({
      from: index,
      to: target,
      offset: landing,
      axis: held.axis,
      size: from.size,
      settling: true,
    });

    settleTimer.current = window.setTimeout(() => {
      setCommitting(true);
      onReorder(index, target);
      setCarrying(null);
      // Two frames: one to paint the new order with transitions off, then
      // hand them back for the next drag.
      requestAnimationFrame(() => requestAnimationFrame(() => setCommitting(false)));
    }, SETTLE_MS);
  };

  /** Where a bar sits right now: carried, shoved aside, or at home. */
  const shift = (i: number) => {
    if (!carrying) return undefined;
    const { from, to, offset, axis, size } = carrying;
    const move = (by: number) =>
      axis === 'x' ? `translateX(${by}px)` : `translateY(${by}px)`;

    if (i === from) return move(offset);
    // Everything the carried bar has passed over steps back one slot to make
    // room, which is the whole of the effect.
    if (to > from && i > from && i <= to) return move(-size);
    if (to < from && i >= to && i < from) return move(size);
    return undefined;
  };

  const normalise = (clientX: number, clientY: number) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    };
  };

  const startDrag = (id: string) => (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    // Capturing on the marker means every later move and the release land here
    // even when the pointer runs off the image.
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(id);
  };

  const drag = (id: string) => (event: ReactPointerEvent<HTMLElement>) => {
    if (dragging !== id) return;
    const at = normalise(event.clientX, event.clientY);
    if (at) onMove(id, at.x, at.y);
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setDragging(null);
  };

  /** Nudge a marker with the keyboard, for anyone not using a mouse. */
  const nudge = (pick: Pick) => (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 0.05 : 0.005;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    onMove(
      pick.id,
      Math.min(1, Math.max(0, pick.x + move[0])),
      Math.min(1, Math.max(0, pick.y + move[1])),
    );
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* Wraps rather than clipping: at phone width the slider and four
          buttons do not fit on one line. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-3 sm:px-5">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">Colours</span>

          <div className="flex items-center gap-1 rounded-lg border border-line p-0.5">
            <button
              type="button"
              onClick={() => onStep(-1)}
              disabled={count <= MIN_PICKS}
              aria-label="One colour fewer"
              className="grid h-7 w-7 place-items-center rounded-md text-base text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
            >
              −
            </button>

            <output
              id="picks"
              aria-live="polite"
              className="w-6 text-center font-mono text-sm tabular-nums"
            >
              {count}
            </output>

            <button
              type="button"
              onClick={() => onStep(1)}
              disabled={count >= MAX_PICKS}
              aria-label="One colour more"
              className="grid h-7 w-7 place-items-center rounded-md text-base text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
            >
              +
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {edited && (
            <button
              type="button"
              onClick={onReset}
              className="rounded-lg px-3 py-1.5 text-xs text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              Reset
            </button>
          )}
          <button
            type="button"
            onClick={() => onCopy('Palette', picks.map((p) => rgbToHex(p.rgb).toUpperCase()).join(', '))}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium transition-colors hover:bg-raised"
          >
            Copy all
          </button>
          <button
            type="button"
            onClick={onShare}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium transition-colors hover:bg-raised"
          >
            Share
          </button>
          <button
            type="button"
            onClick={onExportPng}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium transition-colors hover:bg-raised"
          >
            PNG
          </button>
        </div>
      </div>

      <Stage
        width={image.width}
        height={image.height}
        zoom={zoom}
        onZoom={onZoom}
        frameRef={frameRef}
      >
        <img
          src={image.src}
          alt={image.name}
          draggable={false}
          className="block h-full w-full select-none"
        />

        {/* While a marker is being dragged, magnify what is under it — the
            same problem the colour picker has, so the same glass. */}
        {picks.map((pick) =>
          dragging === pick.id ? (
            <Loupe
              key={`glass-${pick.id}`}
              src={image.src}
              width={image.width}
              height={image.height}
              x={pick.x}
              y={pick.y}
              rgb={pick.rgb}
            />
          ) : null,
        )}

        {picks.map((pick, i) => (
          <button
            key={pick.id}
            type="button"
            aria-label={`Colour ${i + 1}, ${rgbToHex(pick.rgb).toUpperCase()}. Drag or use arrow keys to move.`}
            onPointerDown={startDrag(pick.id)}
            onPointerMove={drag(pick.id)}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={nudge(pick)}
            className={`absolute grid h-8 w-8 touch-none place-items-center rounded-full border-[3px] border-white font-mono text-[11px] font-semibold shadow-[0_0_0_1px_rgba(0,0,0,0.5)] transition-transform ${
              dragging === pick.id ? 'scale-125 cursor-grabbing' : 'cursor-grab hover:scale-110'
            }`}
            style={{
              left: `${pick.x * 100}%`,
              top: `${pick.y * 100}%`,
              transform: 'translate(-50%, -50%)',
              background: rgbToHex(pick.rgb),
              color: readableTextOn(pick.rgb),
            }}
          >
            {i + 1}
          </button>
        ))}
      </Stage>

      {/* The palette itself. Vertical bars side by side from sm up; stacked
          rows on a phone, where ten bars would be too narrow to read. */}
      <div
        ref={stripRef}
        className="flex shrink-0 flex-col border-t border-line bg-raised sm:h-44 sm:flex-row"
      >
        {picks.map((pick, i) => {
          const formats = formatAll(pick.rgb);
          const ink = readableTextOn(pick.rgb);

          return (
            <button
              key={pick.id}
              type="button"
              onPointerDown={startCarry(i)}
              onPointerMove={moveCarry}
              onPointerUp={endCarry}
              onPointerCancel={endCarry}
              onClick={() => {
                // A reorder ends in a click too; only copy if nothing moved.
                if (dragged.current) {
                  dragged.current = false;
                  return;
                }
                onCopy(`Colour ${i + 1}`, formats.hex);
              }}
              title={`${formats.hex} — click to copy, drag to reorder`}
              aria-label={`Colour ${i + 1} of ${picks.length}, ${formats.hex}. Click to copy, or use the arrow keys to move it.`}
              onKeyDown={(event) => {
                const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
                const on = event.key === 'ArrowRight' || event.key === 'ArrowDown';
                if (!back && !on) return;
                event.preventDefault();
                onReorder(i, back ? i - 1 : i + 1);
              }}
              className={`group flex flex-1 touch-none flex-col items-center justify-center gap-1 px-4 py-3 text-center select-none ${
                carrying?.from === i
                  ? `z-10 cursor-grabbing shadow-2xl ${
                      // While it is being carried the bar tracks the pointer
                      // exactly; a transition here would lag behind the hand.
                      carrying.settling ? 'transition-transform duration-200 ease-out' : ''
                    }`
                  : `cursor-grab ${
                      committing ? '' : 'transition-transform duration-200 ease-out'
                    }`
              }`}
              style={{
                background: formats.hex,
                color: ink,
                transform: shift(i),
                // Lifted slightly, so it reads as being carried over the rest.
                scale: carrying?.from === i && !carrying.settling ? '1.04' : undefined,
              }}
            >
              <span className="font-mono text-sm font-semibold tracking-wide">
                {formats.hex}
              </span>
              <span className="text-[11px] opacity-0 transition-opacity group-hover:opacity-70">
                {pick.custom ? 'moved' : 'drag to reorder'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
