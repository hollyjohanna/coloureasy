import { useRef, type CSSProperties } from 'react';
import { readableTextOn, rgbToHex } from '../lib/colour';
import type { LoadedImage } from '../lib/loadImage';
import type { Swatch } from '../lib/palette';
import Stage from './Stage';

type Props = {
  image: LoadedImage;
  swatches: Swatch[];
  hovered: string | null;
  onHover: (id: string | null) => void;
  onAdd: (x: number, y: number) => void;
  onRemove: (id: string) => void;
  canPick: boolean;
  zoom: number;
  onZoom: (zoom: number) => void;
};

export default function ImageStage({
  image,
  swatches,
  hovered,
  onHover,
  onAdd,
  onRemove,
  canPick,
  zoom,
  onZoom,
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
    <Stage
      width={image.width}
      height={image.height}
      zoom={zoom}
      onZoom={onZoom}
      frameRef={frameRef}
      onFrameClick={(e) => pick(e.clientX, e.clientY)}
      frameClassName={canPick ? 'cursor-crosshair' : 'cursor-progress'}
    >
      <img
        src={image.src}
        alt={image.name}
        draggable={false}
        className="block h-full w-full select-none"
      />

      {swatches.map((swatch) => (
        <Marker
          key={swatch.id}
          swatch={swatch}
          active={hovered === swatch.id}
          dimmed={hovered !== null && hovered !== swatch.id}
          onHover={onHover}
          onRemove={onRemove}
        />
      ))}
    </Stage>
  );
}

function Marker({
  swatch,
  active,
  dimmed,
  onHover,
  onRemove,
}: {
  swatch: Swatch;
  active: boolean;
  dimmed: boolean;
  onHover: (id: string | null) => void;
  onRemove: (id: string) => void;
}) {
  const hex = rgbToHex(swatch.rgb);
  const picked = swatch.source === 'manual';

  const style: CSSProperties = {
    left: `${swatch.x * 100}%`,
    top: `${swatch.y * 100}%`,
    background: hex,
    // Manual picks get a square marker so they're distinguishable at a glance.
    borderRadius: picked ? '4px' : '999px',
    transform: `translate(-50%, -50%) scale(${active ? 1.6 : 1})`,
    opacity: dimmed ? 0.35 : 1,
  };

  const className =
    'absolute grid h-5 w-5 place-items-center border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)] transition-[transform,opacity] duration-150';

  const hover = {
    onMouseEnter: () => onHover(swatch.id),
    onMouseLeave: () => onHover(null),
  };

  const label = active && (
    <span
      className="pointer-events-none absolute top-full left-1/2 mt-2 -translate-x-1/2 rounded px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap"
      style={{ background: hex, color: readableTextOn(swatch.rgb) }}
    >
      {hex.toUpperCase()}
    </span>
  );

  // Extracted colours come and go with the count slider, so their markers are
  // decorative — the palette list is the control for those.
  if (!picked) {
    return (
      <div className={className} style={style} {...hover} aria-hidden="true">
        {label}
      </div>
    );
  }

  // A colour you added by hand, you can take off again by clicking it.
  return (
    <button
      type="button"
      className={`${className} cursor-pointer`}
      style={style}
      {...hover}
      onFocus={() => onHover(swatch.id)}
      onBlur={() => onHover(null)}
      onClick={(event) => {
        // Without this the click also reaches the frame underneath, which
        // would immediately re-add the colour that was just removed.
        event.stopPropagation();
        onRemove(swatch.id);
      }}
      title={`Remove ${hex.toUpperCase()}`}
      aria-label={`Remove ${hex.toUpperCase()} from the palette`}
    >
      {active && (
        <span
          aria-hidden
          className="pointer-events-none text-[9px] leading-none font-bold"
          style={{ color: readableTextOn(swatch.rgb) }}
        >
          ×
        </span>
      )}
      {label}
    </button>
  );
}
