import { useCallback, useEffect, useMemo, useState } from 'react';
import DropZone from './components/DropZone';
import ImageStage from './components/ImageStage';
import LayerExtractor from './components/LayerExtractor';
import LayerList from './components/LayerList';
import PalettePanel from './components/PalettePanel';
import PalettePicker from './components/PalettePicker';
import SharedPalette from './components/SharedPalette';
import Sidebar, { type Tool } from './components/Sidebar';
import ValuePanel from './components/ValuePanel';
import { usePalette } from './hooks/usePalette';
import { usePicks } from './hooks/usePicks';
import { usePosterise } from './hooks/usePosterise';
import { useValueStudy } from './hooks/useValueStudy';
import type { Rgb } from './lib/colour';
import { exportStrip } from './lib/export';
import { exportLayerZip, exportReferenceSheet, type LayerMode } from './lib/exportLayers';
import { paletteFromLocation, shareUrlFor } from './lib/shareUrl';

export default function App() {
  const palette = usePalette();
  const [tool, setTool] = useState<Tool>('palette');
  const [hovered, setHovered] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [shared, setShared] = useState<Rgb[]>(() => paletteFromLocation());
  const [compare, setCompare] = useState(false);
  const [mode, setMode] = useState<LayerMode>('isolated');
  const [exporting, setExporting] = useState<string | null>(null);

  const colours = useMemo(() => palette.swatches.map((s) => s.rgb), [palette.swatches]);

  // Each heavy tool only runs while it's the one on screen — no point
  // posterising a full-resolution image nobody is looking at.
  const posterise = usePosterise(palette.image, palette.swatches, tool === 'layers');
  const values = useValueStudy(palette.image, tool === 'values');
  const picks = usePicks(palette.derive, palette.peekAt, palette.image);

  const notify = useCallback((message: string) => setToast(message), []);

  const copy = useCallback(
    async (label: string, value: string) => {
      try {
        await navigator.clipboard.writeText(value);
        notify(`${label} copied — ${value}`);
      } catch {
        notify('Your browser blocked the clipboard.');
      }
    },
    [notify],
  );

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  const busy = palette.status === 'loading' || palette.status === 'extracting';
  const error = palette.error ?? posterise.error ?? values.error;

  // Both the Layer Extractor and the Value Study produce the same shape of
  // result, so one export path serves them.
  const exportZipFor = async (
    result: typeof posterise.result,
    layers: typeof posterise.layers,
    swatchColours: Rgb[],
    suffix: string,
  ) => {
    if (!result || !palette.image) return;
    setExporting('Building…');
    try {
      await exportLayerZip(
        result,
        layers,
        swatchColours,
        `${palette.image.name} ${suffix}`.trim(),
        mode,
        (done, total) => setExporting(`${done}/${total}`),
      );
      notify('Layers exported.');
    } catch {
      notify('Could not build the ZIP.');
    } finally {
      setExporting(null);
    }
  };

  const exportZip = () =>
    exportZipFor(posterise.result, posterise.layers, colours, '');

  const exportSheet = async () => {
    if (!posterise.result || !palette.image) return;
    try {
      await exportReferenceSheet(
        posterise.result,
        posterise.layers,
        colours,
        palette.image.name,
      );
      notify('Reference sheet exported.');
    } catch {
      notify('Could not build the reference sheet.');
    }
  };

  const exportValuePng = async () => {
    if (!values.result || !palette.image) return;
    try {
      await exportReferenceSheet(
        values.result,
        values.layers,
        values.palette,
        palette.image.name,
        'values',
      );
      notify('Value study exported.');
    } catch {
      notify('Could not build the value study.');
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-5 py-3">
        <div>
          <h1 className="text-sm font-semibold tracking-tight">Colour Extractor</h1>
          <p className="text-xs text-faint">
            Pull a palette out of any image, in your browser.
          </p>
        </div>

        {palette.image && (
          <button
            type="button"
            onClick={() => {
              palette.reset();
              setHovered(null);
            }}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium transition-colors hover:bg-raised"
          >
            New image
          </button>
        )}
      </header>

      {palette.image ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          {/* Narrow screens scroll this whole column; from lg up the panes are
              fixed height and scroll their own contents. Without the mobile
              scroll the image overflows and covers the tool tabs. */}
          <Sidebar tool={tool} onChange={setTool} />

          <main className="flex min-w-0 flex-col lg:min-h-0 lg:flex-1 lg:flex-row">
            {tool === 'palette' && (
              <PalettePicker
                image={palette.image}
                picks={picks.picks}
                count={picks.count}
                onCount={picks.setCount}
                onMove={picks.moveTo}
                dragging={picks.dragging}
                setDragging={picks.setDragging}
                onReset={picks.reset}
                edited={picks.edited}
                onCopy={copy}
                onExportPng={() =>
                  exportStrip(
                    picks.picks.map((p) => p.rgb),
                    palette.image!.name,
                  )
                }
                onShare={() =>
                  copy('Share link', shareUrlFor(picks.picks.map((p) => p.rgb)))
                }
              />
            )}

            {tool === 'values' && (
              <>
                <LayerExtractor
                  result={values.result}
                  palette={values.palette}
                  visible={values.visible}
                  working={values.working}
                  compareSrc={palette.image.src}
                  compare={compare}
                />
                <ValuePanel
                  layers={values.layers}
                  steps={values.steps}
                  onSteps={values.setSteps}
                  detail={values.detail}
                  onDetail={values.setDetail}
                  hidden={values.hidden}
                  allVisible={values.allVisible}
                  onToggle={values.toggle}
                  onSolo={values.solo}
                  onShowAll={values.showAll}
                  compare={compare}
                  onCompare={setCompare}
                  mode={mode}
                  onMode={setMode}
                  onExportPng={exportValuePng}
                  onExportZip={() =>
                    exportZipFor(values.result, values.layers, values.palette, 'values')
                  }
                  busy={values.working || exporting !== null}
                  exporting={exporting}
                />
              </>
            )}

            {tool === 'picker' && (
              <>
                <ImageStage
                  image={palette.image}
                  swatches={palette.swatches}
                  hovered={hovered}
                  onHover={setHovered}
                  onAdd={(x, y) => palette.addAt(x, y)}
                  canPick={palette.canPick}
                />
                <PalettePanel
                  swatches={palette.swatches}
                  count={palette.count}
                  onCount={palette.setCount}
                  available={palette.available}
                  hovered={hovered}
                  onHover={setHovered}
                  onRemove={palette.removeManual}
                  imageName={palette.image.name}
                  notify={notify}
                />
              </>
            )}

            {tool === 'layers' && (
              <>
                <LayerExtractor
                  result={posterise.result}
                  palette={colours}
                  visible={posterise.visible}
                  working={posterise.working}
                  compareSrc={palette.image.src}
                  compare={compare}
                />
                <LayerList
                  layers={posterise.layers}
                  hidden={posterise.hidden}
                  allVisible={posterise.allVisible}
                  detail={posterise.detail}
                  onDetail={posterise.setDetail}
                  onToggle={posterise.toggle}
                  onSolo={posterise.solo}
                  onShowAll={posterise.showAll}
                  compare={compare}
                  onCompare={setCompare}
                  mode={mode}
                  onMode={setMode}
                  onExportZip={exportZip}
                  onExportSheet={exportSheet}
                  busy={posterise.working || exporting !== null}
                  exporting={exporting}
                />
              </>
            )}
          </main>
        </div>
      ) : (
        <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-10 py-10">
          <DropZone onFile={palette.openFile} onUrl={palette.openUrl} busy={busy} />
          {shared.length > 0 && (
            <SharedPalette
              colours={shared}
              onDismiss={() => {
                setShared([]);
                history.replaceState(null, '', window.location.pathname);
              }}
              notify={notify}
            />
          )}
        </main>
      )}

      {busy && (
        <div className="pointer-events-none fixed inset-x-0 top-0 h-0.5 overflow-hidden bg-line">
          <div className="h-full w-1/3 animate-[slide_1.1s_ease-in-out_infinite] bg-ink" />
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="fixed bottom-5 left-1/2 max-w-[90vw] -translate-x-1/2 rounded-lg border border-line bg-raised px-4 py-2.5 text-sm shadow-xl"
        >
          {error}
        </div>
      )}

      {/* Announced to screen readers as well as shown, since copying is
          otherwise a silent action. */}
      <div
        aria-live="polite"
        className={`fixed bottom-5 left-1/2 max-w-[90vw] -translate-x-1/2 rounded-lg border border-line bg-raised px-4 py-2.5 font-mono text-xs shadow-xl transition-opacity ${
          toast ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        {toast}
      </div>

      <style>{`
        @keyframes slide {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  );
}
