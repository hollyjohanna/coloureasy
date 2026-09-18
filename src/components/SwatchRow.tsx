import { formatAll, readableTextOn, rgbToHex } from '../lib/colour';
import type { Swatch } from '../lib/palette';

type Props = {
  swatch: Swatch;
  expanded: boolean;
  active: boolean;
  onToggle: () => void;
  onHover: (id: string | null) => void;
  onCopy: (label: string, value: string) => void;
  onRemove: () => void;
  onToggleLock: () => void;
};

const ORDER = [
  ['HEX', 'hex'],
  ['RGB', 'rgb'],
  ['HSL', 'hsl'],
  ['HSB', 'hsv'],
  ['CMYK', 'cmyk'],
] as const;

export default function SwatchRow({
  swatch,
  expanded,
  active,
  onToggle,
  onHover,
  onCopy,
  onRemove,
  onToggleLock,
}: Props) {
  const formats = formatAll(swatch.rgb);
  const hex = rgbToHex(swatch.rgb);
  const ink = readableTextOn(swatch.rgb);

  return (
    <li
      onMouseEnter={() => onHover(swatch.id)}
      onMouseLeave={() => onHover(null)}
      className={`group/row relative overflow-hidden rounded-lg border transition-colors ${
        active ? 'border-ink' : 'border-line'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        onFocus={() => onHover(swatch.id)}
        onBlur={() => onHover(null)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
        style={{ background: hex, color: ink }}
      >
        <span className="flex-1 font-mono text-sm font-medium">
          {formats.hex}
        </span>
        <span className="mr-14 font-mono text-xs opacity-70">
          {swatch.locked
            ? 'locked'
            : swatch.source === 'manual'
              ? 'picked'
              : `${(swatch.share * 100).toFixed(1)}%`}
        </span>
        <span aria-hidden className="text-xs opacity-60">
          {expanded ? '−' : '+'}
        </span>
      </button>

      {/* Sit over the colour rather than below it, so the row keeps its height
          and the strip still reads as a run of colours. */}
      <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-1 pr-9">
        <button
          type="button"
          onClick={onToggleLock}
          aria-pressed={swatch.locked}
          aria-label={`${swatch.locked ? 'Unlock' : 'Lock'} ${formats.hex}`}
          title={
            swatch.locked
              ? 'Locked — the slider and remove leave this one alone'
              : 'Lock this colour'
          }
          className={`pointer-events-auto grid h-6 w-6 place-items-center rounded text-[11px] transition-opacity ${
            swatch.locked
              ? 'opacity-90'
              : 'opacity-0 group-hover/row:opacity-70 focus-visible:opacity-100'
          }`}
          style={{ color: ink }}
        >
          {swatch.locked ? '🔒' : '🔓'}
        </button>

        <button
          type="button"
          onClick={onRemove}
          disabled={swatch.locked}
          aria-label={`Remove ${formats.hex}`}
          title={swatch.locked ? 'Locked colours cannot be removed' : 'Remove this colour'}
          className="pointer-events-auto grid h-6 w-6 place-items-center rounded text-sm opacity-0 transition-opacity group-hover/row:opacity-70 hover:!opacity-100 focus-visible:opacity-100 disabled:!opacity-0"
          style={{ color: ink }}
        >
          ×
        </button>
      </span>

      {expanded && (
        <dl className="divide-y divide-line bg-surface">
          {ORDER.map(([label, key]) => (
            <div key={key} className="flex items-center gap-3 px-3 py-1.5">
              <dt className="w-12 shrink-0 text-[11px] font-medium tracking-wide text-faint">
                {label}
              </dt>
              <dd className="min-w-0 flex-1 truncate font-mono text-xs">
                {formats[key]}
              </dd>
              <button
                type="button"
                onClick={() => onCopy(label, formats[key])}
                className="shrink-0 rounded px-2 py-1 text-[11px] text-muted transition-colors hover:bg-raised hover:text-ink"
              >
                Copy
              </button>
            </div>
          ))}

        </dl>
      )}
    </li>
  );
}
