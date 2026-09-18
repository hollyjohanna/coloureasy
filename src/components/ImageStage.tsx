import { useRef, type CSSProperties } from 'react';
import { readableTextOn, rgbToHex } from '../lib/colour';
import type { LoadedImage } from '../lib/loadImage';
import type { Swatch } from '../lib/palette';

type Props = {
  image: LoadedImage;
  swatches: Swatch[];
  hovered: string | null;
  onHover: (id: string | null) => void;
  onAdd: (x: number, y: number) => void;
  canPick: boolean;
};

export default function ImageStage({
  image,
  swatches,
  hovered,
  onHover,
  onAdd,
  canPick,
}: Props) {
  const frameRef = useRef<HTMLDivElement>(null);

  // The frame is sized by the image itself, so a click's offset within it maps
  // straight onto normalised image coordinates regardless of display size.
  const pick = (clientX: number, clientY: number) => {
    const frame = frameRef.current;
    if (!frame || !canPick) return;
    const rect = frame.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    onAdd(
      Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    );
  };

  return (
    <div className="flex shrink-0 items-center justify-center p-4 sm:p-8 lg:min-h-0 lg:flex-1 lg:shrink">
      {/* inline-block so the frame shrink-wraps the image exactly: marker
          percentages then land on real image pixels at any display size. */}
      <div
        ref={frameRef}
        onClick={(e) => pick(e.clientX, e.clientY)}
        className={`checkerboard relative inline-block overflow-hidden rounded-xl shadow-2xl ${
          canPick ? 'cursor-crosshair' : 'cursor-progress'
        }`}
      >
        <img
          src={image.src}
          alt={image.name}
          draggable={false}
          className="block max-h-[52vh] w-auto max-w-full select-none lg:max-h-[80vh]"
        />

        {swatches.map((swatch) => (
          <Marker
            key={swatch.id}
            swatch={swatch}
            active={hovered === swatch.id}
            dimmed={hovered !== null && hovered !== swatch.id}
            onHover={onHover}
          />
        ))}
      </div>
    </div>
  );
}

function Marker({
  swatch,
  active,
  dimmed,
  onHover,
}: {
  swatch: Swatch;
  active: boolean;
  dimmed: boolean;
  onHover: (id: string | null) => void;
}) {
  const hex = rgbToHex(swatch.rgb);

  const style: CSSProperties = {
    left: `${swatch.x * 100}%`,
    top: `${swatch.y * 100}%`,
    background: hex,
    // Manual picks get a square marker so they're distinguishable at a glance.
    borderRadius: swatch.source === 'manual' ? '4px' : '999px',
    transform: `translate(-50%, -50%) scale(${active ? 1.6 : 1})`,
    opacity: dimmed ? 0.35 : 1,
  };

  return (
    <div
      className="pointer-events-auto absolute h-5 w-5 border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)] transition-[transform,opacity] duration-150"
      style={style}
      onMouseEnter={() => onHover(swatch.id)}
      onMouseLeave={() => onHover(null)}
      // The marker is decorative; the swatch in the palette is the real control.
      aria-hidden="true"
    >
      {active && (
        <span
          className="pointer-events-none absolute left-1/2 top-full mt-2 -translate-x-1/2 rounded px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap"
          style={{ background: hex, color: readableTextOn(swatch.rgb) }}
        >
          {hex.toUpperCase()}
        </span>
      )}
    </div>
  );
}
