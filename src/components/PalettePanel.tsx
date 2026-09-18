import { useState } from 'react';
import { exportJson, exportPng } from '../lib/export';
import type { Swatch } from '../lib/palette';
import { MAX_COLOURS, MIN_COLOURS } from '../lib/quantise';
import { shareUrlFor } from '../lib/shareUrl';
import SwatchRow from './SwatchRow';

type Props = {
  swatches: Swatch[];
  count: number;
  onCount: (n: number) => void;
  /** colours actually in the palette right now */
  total: number;
  /** how many of those were placed by hand */
  picked: number;
  available: number;
  hovered: string | null;
  onHover: (id: string | null) => void;
  onRemove: (id: string) => void;
  imageName: string;
  notify: (message: string) => void;
};

export default function PalettePanel({
  swatches,
  count,
  onCount,
  total,
  picked,
  available,
  hovered,
  onHover,
  onRemove,
  imageName,
  notify,
}: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify(`${label} copied — ${value}`);
    } catch {
      notify('Your browser blocked the clipboard.');
    }
  };

  // An image with few distinct colours caps out below the requested total; say
  // so rather than letting the slider run on with nothing happening.
  const capped = total > 0 && total < count;

  return (
    <aside className="flex w-full shrink-0 flex-col border-line bg-shell lg:w-[380px] lg:border-l">
      <div className="border-b border-line px-5 py-4">
        <div className="flex items-baseline justify-between">
          <label htmlFor="count" className="text-sm font-medium">
            Colours
          </label>
          <span className="font-mono text-sm tabular-nums text-muted">{total}</span>
        </div>

        <input
          id="count"
          type="range"
          min={MIN_COLOURS}
          max={MAX_COLOURS}
          value={count}
          onChange={(e) => onCount(Number(e.target.value))}
          className="mt-3 w-full"
        />

        <p className="mt-2 text-xs text-faint">
          {capped
            ? `This image only has ${available} distinct colours to give.`
            : picked > 0
              ? `${total - picked} from the image, ${picked} picked by hand. Sliding down drops the generated ones first.`
              : `${MIN_COLOURS}–${MAX_COLOURS}. Click the image to add a colour, or hold to magnify. Click your own marker to remove it.`}
        </p>
      </div>

      <ul className="space-y-1.5 px-3 py-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {swatches.map((swatch) => (
          <SwatchRow
            key={swatch.id}
            swatch={swatch}
            expanded={expanded === swatch.id}
            active={hovered === swatch.id}
            onToggle={() =>
              setExpanded((prev) => (prev === swatch.id ? null : swatch.id))
            }
            onHover={onHover}
            onCopy={copy}
            onRemove={
              swatch.source === 'manual' ? () => onRemove(swatch.id) : undefined
            }
          />
        ))}
      </ul>

      <div className="space-y-2 border-t border-line px-5 py-4">
        <div className="grid grid-cols-3 gap-2">
          <ExportButton onClick={() => exportPng(swatches, imageName)}>
            PNG
          </ExportButton>
          <ExportButton onClick={() => exportJson(swatches, imageName)}>
            JSON
          </ExportButton>
          <ExportButton
            onClick={() =>
              copy('Share link', shareUrlFor(swatches.map((s) => s.rgb)))
            }
          >
            Link
          </ExportButton>
        </div>

        <p className="text-[11px] leading-relaxed text-faint">
          The link carries the palette, not the image.
        </p>
      </div>
    </aside>
  );
}

function ExportButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-line py-2 text-xs font-medium transition-colors hover:bg-raised"
    >
      {children}
    </button>
  );
}
