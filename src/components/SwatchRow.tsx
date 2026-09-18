import { formatAll, readableTextOn, rgbToHex } from '../lib/colour';
import type { Swatch } from '../lib/palette';

type Props = {
  swatch: Swatch;
  expanded: boolean;
  active: boolean;
  onToggle: () => void;
  onHover: (id: string | null) => void;
  onCopy: (label: string, value: string) => void;
  onRemove?: () => void;
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
}: Props) {
  const formats = formatAll(swatch.rgb);
  const hex = rgbToHex(swatch.rgb);
  const ink = readableTextOn(swatch.rgb);

  return (
    <li
      onMouseEnter={() => onHover(swatch.id)}
      onMouseLeave={() => onHover(null)}
      className={`overflow-hidden rounded-lg border transition-colors ${
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
        <span className="font-mono text-xs opacity-70">
          {swatch.source === 'manual'
            ? 'picked'
            : `${(swatch.share * 100).toFixed(1)}%`}
        </span>
        <span aria-hidden className="text-xs opacity-60">
          {expanded ? '−' : '+'}
        </span>
      </button>

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

          {onRemove && (
            <div className="px-3 py-2">
              <button
                type="button"
                onClick={onRemove}
                className="text-[11px] text-muted transition-colors hover:text-ink"
              >
                Remove this colour
              </button>
            </div>
          )}
        </dl>
      )}
    </li>
  );
}
