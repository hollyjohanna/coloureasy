import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import {
  MAX_PICKS,
  MIN_PICKS,
  type Pick,
} from '../hooks/usePicks';
import { formatAll, readableTextOn, rgbToHex } from '../lib/colour';
import type { LoadedImage } from '../lib/loadImage';
import Stage from './Stage';

type Props = {
  image: LoadedImage;
  picks: Pick[];
  count: number;
  onCount: (n: number) => void;
  onMove: (id: string, x: number, y: number) => void;
  dragging: string | null;
  setDragging: (id: string | null) => void;
  onReset: () => void;
  edited: boolean;
  onCopy: (label: string, value: string) => void;
  onExportPng: () => void;
  onShare: () => void;
  zoom: number;
  onZoom: (zoom: number) => void;
};

export default function PalettePicker({
  image,
  picks,
  count,
  onCount,
  onMove,
  dragging,
  setDragging,
  onReset,
  edited,
  onCopy,
  onExportPng,
  onShare,
  zoom,
  onZoom,
}: Props) {
  const frameRef = useRef<HTMLDivElement>(null);

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
          <label htmlFor="picks" className="text-sm font-medium">
            Colours
          </label>
          <input
            id="picks"
            type="range"
            min={MIN_PICKS}
            max={MAX_PICKS}
            value={count}
            onChange={(e) => onCount(Number(e.target.value))}
            className="w-32"
          />
          <span className="font-mono text-sm tabular-nums text-muted">{count}</span>
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
          rows on a phone, where eight bars would be too narrow to read. */}
      <div className="flex shrink-0 flex-col border-t border-line sm:h-44 sm:flex-row">
        {picks.map((pick, i) => {
          const formats = formatAll(pick.rgb);
          const ink = readableTextOn(pick.rgb);

          return (
            <button
              key={pick.id}
              type="button"
              onClick={() => onCopy(`Colour ${i + 1}`, formats.hex)}
              title={`Copy ${formats.hex}`}
              className="group flex flex-1 items-center justify-between px-4 py-3 text-left transition-[flex] sm:flex-col sm:items-center sm:justify-end sm:py-6"
              style={{ background: formats.hex, color: ink }}
            >
              <span className="font-mono text-sm font-semibold tracking-wide">
                {formats.hex}
              </span>
              <span className="text-[11px] opacity-0 transition-opacity group-hover:opacity-70 sm:mt-1">
                {pick.custom ? 'moved' : 'click to copy'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
