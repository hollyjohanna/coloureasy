import { readableTextOn, rgbToHex } from '../lib/colour';
import type { Layer } from '../hooks/usePosterise';
import type { LayerMode } from '../lib/exportLayers';
import type { Detail } from '../lib/posterise';

type Props = {
  layers: Layer[];
  hidden: ReadonlySet<number>;
  allVisible: boolean;
  detail: Detail;
  onDetail: (detail: Detail) => void;
  onToggle: (index: number) => void;
  onSolo: (index: number) => void;
  onShowAll: () => void;
  compare: boolean;
  onCompare: (compare: boolean) => void;
  mode: LayerMode;
  onMode: (mode: LayerMode) => void;
  onExportZip: () => void;
  onExportSheet: () => void;
  busy: boolean;
  exporting: string | null;
};

const DETAILS: { id: Detail; label: string }[] = [
  { id: 'fine', label: 'Fine' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'bold', label: 'Bold' },
];

export default function LayerList({
  layers,
  hidden,
  allVisible,
  detail,
  onDetail,
  onToggle,
  onSolo,
  onShowAll,
  compare,
  onCompare,
  mode,
  onMode,
  onExportZip,
  onExportSheet,
  busy,
  exporting,
}: Props) {
  const used = layers.filter((l) => l.pixels > 0).length;

  return (
    <aside className="flex w-full shrink-0 flex-col border-line bg-shell lg:w-[380px] lg:border-l">
      <div className="space-y-3 border-b border-line px-5 py-4">
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium">Detail</span>
            <span className="font-mono text-xs text-muted">
              {used} layer{used === 1 ? '' : 's'}
            </span>
          </div>

          <div
            role="group"
            aria-label="Detail"
            className="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-surface p-1"
          >
            {DETAILS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={detail === option.id}
                onClick={() => onDetail(option.id)}
                className={`rounded-md py-1.5 text-xs font-medium transition-colors ${
                  detail === option.id
                    ? 'bg-raised text-ink'
                    : 'text-muted hover:text-ink'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <p className="mt-2 text-xs text-faint">
            How much fine detail to keep. Bolder gives larger, flatter areas.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="flex flex-1 cursor-pointer items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={compare}
              onChange={(e) => onCompare(e.target.checked)}
              className="accent-current"
            />
            Show original underneath
          </label>

          {!allVisible && (
            <button
              type="button"
              onClick={onShowAll}
              className="rounded px-2 py-1 text-xs text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              Show all
            </button>
          )}
        </div>
      </div>

      <ul className="space-y-1 px-3 py-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {layers.map((layer, position) => {
          const isHidden = hidden.has(layer.index);
          const hex = rgbToHex(layer.swatch.rgb);
          const unused = layer.pixels === 0;

          return (
            <li
              key={layer.swatch.id}
              className={`flex items-center gap-2 rounded-lg border border-line px-2 py-1.5 transition-opacity ${
                isHidden || unused ? 'opacity-40' : ''
              }`}
            >
              <span className="w-6 shrink-0 text-center font-mono text-[10px] text-faint">
                {unused ? '–' : position + 1}
              </span>

              <span
                aria-hidden
                className="h-7 w-7 shrink-0 rounded"
                style={{ background: hex }}
              />

              <span className="min-w-0 flex-1">
                <span className="block font-mono text-xs">{hex.toUpperCase()}</span>
                <span className="block text-[11px] text-faint">
                  {unused
                    ? 'not used'
                    : `${(layer.coverage * 100).toFixed(1)}% coverage`}
                </span>
              </span>

              <button
                type="button"
                onClick={() => onSolo(layer.index)}
                title="Show only this layer"
                className="shrink-0 rounded px-2 py-1 text-[11px] text-muted transition-colors hover:bg-raised hover:text-ink"
              >
                Solo
              </button>

              <button
                type="button"
                onClick={() => onToggle(layer.index)}
                aria-pressed={!isHidden}
                aria-label={`${isHidden ? 'Show' : 'Hide'} ${hex.toUpperCase()}`}
                className="shrink-0 rounded px-2 py-1 text-xs transition-colors hover:bg-raised"
                style={{ color: isHidden ? undefined : readableTextOn(layer.swatch.rgb) }}
              >
                <span
                  className="grid h-5 w-5 place-items-center rounded"
                  style={{ background: isHidden ? 'transparent' : hex }}
                >
                  {isHidden ? '○' : '●'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="space-y-2.5 border-t border-line px-5 py-4">
        <div>
          <span className="text-xs text-muted">Export layers as</span>
          <div
            role="group"
            aria-label="Layer mode"
            className="mt-1.5 grid grid-cols-2 gap-1 rounded-lg bg-surface p-1"
          >
            {(
              [
                ['isolated', 'Isolated'],
                ['cumulative', 'Cumulative'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={mode === id}
                onClick={() => onMode(id)}
                className={`rounded-md py-1.5 text-xs font-medium transition-colors ${
                  mode === id ? 'bg-raised text-ink' : 'text-muted hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onExportZip}
            disabled={busy || layers.length === 0}
            className="rounded-lg border border-line py-2 text-xs font-medium transition-colors hover:bg-raised disabled:opacity-40"
          >
            {exporting ?? 'Layers (ZIP)'}
          </button>
          <button
            type="button"
            onClick={onExportSheet}
            disabled={busy || layers.length === 0}
            className="rounded-lg border border-line py-2 text-xs font-medium transition-colors hover:bg-raised disabled:opacity-40"
          >
            Reference sheet
          </button>
        </div>

        <p className="text-[11px] leading-relaxed text-faint">
          {mode === 'isolated'
            ? 'One PNG per colour, transparent elsewhere. Stack them in any order to rebuild the image.'
            : 'Each PNG is a full coat over the last. Stack them in order, 01 first.'}
        </p>
      </div>
    </aside>
  );
}
