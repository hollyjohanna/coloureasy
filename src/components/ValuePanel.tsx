import type { Layer } from '../hooks/usePosterise';
import { readableTextOn, rgbToHex } from '../lib/colour';
import type { LayerMode } from '../lib/exportLayers';
import type { Detail } from '../lib/posterise';
import { MAX_VALUES, MIN_VALUES, valueOf } from '../lib/valueStudy';

type Props = {
  layers: Layer[];
  steps: number;
  onSteps: (n: number) => void;
  detail: Detail;
  onDetail: (detail: Detail) => void;
  hidden: ReadonlySet<number>;
  allVisible: boolean;
  onToggle: (index: number) => void;
  onSolo: (index: number) => void;
  onShowAll: () => void;
  compare: boolean;
  onCompare: (compare: boolean) => void;
  mode: LayerMode;
  onMode: (mode: LayerMode) => void;
  onExportPng: () => void;
  onExportZip: () => void;
  busy: boolean;
  exporting: string | null;
};

const DETAILS: { id: Detail; label: string }[] = [
  { id: 'fine', label: 'Fine' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'bold', label: 'Bold' },
];

export default function ValuePanel({
  layers,
  steps,
  onSteps,
  detail,
  onDetail,
  hidden,
  allVisible,
  onToggle,
  onSolo,
  onShowAll,
  compare,
  onCompare,
  mode,
  onMode,
  onExportPng,
  onExportZip,
  busy,
  exporting,
}: Props) {
  const used = layers.filter((l) => l.pixels > 0);

  return (
    <aside className="flex w-full shrink-0 flex-col border-line bg-shell lg:w-[380px] lg:border-l">
      <div className="space-y-3 border-b border-line px-5 py-4">
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="steps" className="text-sm font-medium">
              Values
            </label>
            <span className="font-mono text-sm tabular-nums text-muted">{steps}</span>
          </div>

          <input
            id="steps"
            type="range"
            min={MIN_VALUES}
            max={MAX_VALUES}
            value={steps}
            onChange={(e) => onSteps(Number(e.target.value))}
            className="mt-3 w-full"
          />

          <p className="mt-2 text-xs text-faint">
            Three or four is the classic study. Check the structure reads before
            you think about colour.
          </p>
        </div>

        {/* The value scale itself: darkest to lightest, left to right. */}
        <div className="flex h-12 overflow-hidden rounded-lg">
          {used.map((layer, i) => (
            <div
              key={layer.swatch.id}
              title={`Value ${i + 1} — ${valueOf(layer.swatch.rgb)}% · ${(
                layer.coverage * 100
              ).toFixed(1)}% of image`}
              className="grid flex-1 place-items-center font-mono text-[10px]"
              style={{
                background: rgbToHex(layer.swatch.rgb),
                color: readableTextOn(layer.swatch.rgb),
              }}
            >
              {valueOf(layer.swatch.rgb)}
            </div>
          ))}
        </div>

        <div>
          <div
            role="group"
            aria-label="Detail"
            className="grid grid-cols-3 gap-1 rounded-lg bg-surface p-1"
          >
            {DETAILS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={detail === option.id}
                onClick={() => onDetail(option.id)}
                className={`rounded-md py-1.5 text-xs font-medium transition-colors ${
                  detail === option.id ? 'bg-raised text-ink' : 'text-muted hover:text-ink'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
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
        {used.map((layer, i) => {
          const isHidden = hidden.has(layer.index);
          const hex = rgbToHex(layer.swatch.rgb);

          return (
            <li
              key={layer.swatch.id}
              className={`flex items-center gap-3 rounded-lg border border-line px-2 py-1.5 transition-opacity ${
                isHidden ? 'opacity-40' : ''
              }`}
            >
              <span
                aria-hidden
                className="grid h-9 w-9 shrink-0 place-items-center rounded font-mono text-[11px] font-semibold"
                style={{ background: hex, color: readableTextOn(layer.swatch.rgb) }}
              >
                {i + 1}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block text-xs">
                  Value {valueOf(layer.swatch.rgb)}%
                </span>
                <span className="block text-[11px] text-faint">
                  {(layer.coverage * 100).toFixed(1)}% of the image · {hex.toUpperCase()}
                </span>
              </span>

              <button
                type="button"
                onClick={() => onSolo(layer.index)}
                title="Show only this value"
                className="shrink-0 rounded px-2 py-1 text-[11px] text-muted transition-colors hover:bg-raised hover:text-ink"
              >
                Solo
              </button>

              <button
                type="button"
                onClick={() => onToggle(layer.index)}
                aria-pressed={!isHidden}
                aria-label={`${isHidden ? 'Show' : 'Hide'} value ${i + 1}`}
                className="shrink-0 rounded px-2 py-1 text-xs transition-colors hover:bg-raised"
              >
                <span
                  className="grid h-5 w-5 place-items-center rounded"
                  style={{
                    background: isHidden ? 'transparent' : hex,
                    color: isHidden ? undefined : readableTextOn(layer.swatch.rgb),
                  }}
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
            onClick={onExportPng}
            disabled={busy || used.length === 0}
            className="rounded-lg border border-line py-2 text-xs font-medium transition-colors hover:bg-raised disabled:opacity-40"
          >
            Study (PNG)
          </button>
          <button
            type="button"
            onClick={onExportZip}
            disabled={busy || used.length === 0}
            className="rounded-lg border border-line py-2 text-xs font-medium transition-colors hover:bg-raised disabled:opacity-40"
          >
            {exporting ?? 'Layers (ZIP)'}
          </button>
        </div>

        <p className="text-[11px] leading-relaxed text-faint">
          {mode === 'cumulative'
            ? 'Cumulative layers block in the way you would paint: darkest mass first, each coat over the last.'
            : 'One PNG per value, transparent elsewhere.'}
        </p>
      </div>
    </aside>
  );
}
