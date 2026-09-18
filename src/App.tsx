import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ImageStage from './components/ImageStage';
import Landing from './components/Landing';
import Library from './components/Library';
import LayerExtractor from './components/LayerExtractor';
import LayerList from './components/LayerList';
import PalettePanel from './components/PalettePanel';
import PalettePicker from './components/PalettePicker';
import Sidebar, { type Tool } from './components/Sidebar';
import ValuePanel from './components/ValuePanel';
import { useLibrary } from './hooks/useLibrary';
import { usePalette } from './hooks/usePalette';
import { usePicks } from './hooks/usePicks';
import { usePosterise } from './hooks/usePosterise';
import { useTheme } from './hooks/useTheme';
import { useThumbUrls } from './hooks/useThumbUrls';
import { useValueStudy } from './hooks/useValueStudy';
import { rgbToHex, type Rgb } from './lib/colour';
import { exportStrip } from './lib/export';
import { exportLayerZip, exportReferenceSheet, type LayerMode } from './lib/exportLayers';
import { paletteFromLocation, shareUrlFor } from './lib/shareUrl';

export default function App() {
  const palette = usePalette();
  const library = useLibrary();
  const { theme, toggle: toggleTheme } = useTheme();
  const thumbs = useThumbUrls(library.images);
  // Lands on a work tool, which with no image loaded shows the drop zone.
  // Opening on the Library instead would greet a first-time visitor with an
  // empty grid and every other tool greyed out.
  const [tool, setTool] = useState<Tool>('palette');
  const [hovered, setHovered] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [shared, setShared] = useState<Rgb[]>(() => paletteFromLocation());
  const [compare, setCompare] = useState(false);
  const [mode, setMode] = useState<LayerMode>('isolated');
  const [exporting, setExporting] = useState<string | null>(null);
  // Shared across tools, so zooming in to pick a colour and then switching to
  // the value study keeps you looking at the same part of the picture.
  const [zoom, setZoom] = useState(1);

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

  /* ----------------------------------------------------------- library --- */

  const [recordId, setRecordId] = useState<string | null>(null);
  // Set just before opening a library image, so the save effect below knows
  // this one is already stored and doesn't file a duplicate.
  const reopening = useRef<string | null>(null);
  const described = useRef(new Set<string>());
  // Where to return to after picking something in the Library.
  const lastWorkTool = useRef<Tool>('palette');

  useEffect(() => {
    if (tool !== 'library') lastWorkTool.current = tool;
  }, [tool]);

  // A new picture starts fitted; inheriting 500% from the last one would open
  // on a corner of it with no indication why.
  useEffect(() => {
    setZoom(1);
  }, [palette.image]);

  // Every image that gets opened is remembered, which is what makes Recent a
  // recent list. Filing into a collection stays deliberate.
  useEffect(() => {
    const image = palette.image;
    if (!image) {
      setRecordId(null);
      return;
    }

    if (reopening.current) {
      setRecordId(reopening.current);
      reopening.current = null;
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const blob = await fetch(image.src).then((r) => r.blob());
        if (cancelled) return;
        const id = await library.remember(blob, image.name, []);
        if (!cancelled) setRecordId(id);
      } catch {
        /* the library is a convenience; never block the tools on it */
      }
    })();

    return () => {
      cancelled = true;
    };
    // library.remember is stable enough; re-running per image is the intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette.image]);

  // Once extraction finishes, attach a few colours for the library grid.
  useEffect(() => {
    if (!recordId || palette.swatches.length === 0) return;
    if (described.current.has(recordId)) return;
    described.current.add(recordId);
    library.describe(
      recordId,
      palette.derive(6).map((s) => s.rgb),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId, palette.swatches.length]);

  const openFromLibrary = useCallback(
    (record: { id: string; blob: Blob; name: string }) => {
      reopening.current = record.id;
      library.open(record.id);
      palette.openBlob(record.blob, record.name);
      setTool(lastWorkTool.current);
    },
    [library, palette],
  );

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
        <div className="min-w-0">
          <h1 className="text-sm font-semibold tracking-tight">Colour Easy</h1>
          {palette.image && (
            <p className="truncate text-xs text-faint">{palette.image.name}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            className="rounded-lg border border-line px-2.5 py-1.5 text-xs transition-colors hover:bg-raised"
          >
            <span aria-hidden>{theme === 'dark' ? '☀' : '☾'}</span>
          </button>

          {palette.image && (
            <button
              type="button"
              onClick={() => {
                palette.reset();
                setHovered(null);
                setTool(lastWorkTool.current);
              }}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium transition-colors hover:bg-raised"
            >
              New image
            </button>
          )}
        </div>
      </header>

      {!palette.image ? (
        <Landing
          onFile={palette.openFile}
          onUrl={palette.openUrl}
          busy={busy}
          recent={library.images.slice(0, 8)}
          thumbs={thumbs}
          onOpenRecent={openFromLibrary}
          shared={shared}
          onDismissShared={() => {
            setShared([]);
            history.replaceState(null, '', window.location.pathname);
          }}
          notify={notify}
        />
      ) : (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        {/* Narrow screens scroll this whole column; from lg up the panes are
            fixed height and scroll their own contents. Without the mobile
            scroll the image overflows and covers the tool tabs. */}
        <Sidebar tool={tool} onChange={setTool} hasImage />

        <main className="flex min-w-0 flex-col lg:min-h-0 lg:flex-1 lg:flex-row">
          {tool === 'library' && (
            <Library
              images={library.images}
              collections={library.collections}
              space={library.space}
              ready={library.ready}
              available={library.available}
              onOpen={openFromLibrary}
              onRemove={library.remove}
              onAddCollection={library.addCollection}
              onRenameCollection={library.renameCollection}
              onDropCollection={library.dropCollection}
              onToggleIn={library.toggleIn}
              onAddImage={() => setTool(lastWorkTool.current)}
              thumbs={thumbs}
            />
          )}

          {(
            <>
            {tool === 'palette' && (
              <PalettePicker
                image={palette.image}
                picks={picks.picks}
                count={picks.count}
                onStep={picks.step}
                onMove={picks.moveTo}
                dragging={picks.dragging}
                setDragging={picks.setDragging}
                onReset={picks.reset}
                edited={picks.edited}
                onCopy={copy}
                onReorder={picks.reorder}
                zoom={zoom}
                onZoom={setZoom}
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
                  width={palette.image.width}
                  height={palette.image.height}
                  zoom={zoom}
                  onZoom={setZoom}
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
                  onAdd={(x, y) => {
                    const result = palette.addAt(x, y);
                    if (!result) return;
                    if (result.full) {
                      notify(`That is as many colours as the palette holds.`);
                      return;
                    }
                    if (result.duplicate && result.swatch) {
                      setHovered(result.swatch.id);
                      notify(
                        `${rgbToHex(result.swatch.rgb).toUpperCase()} is already in your palette.`,
                      );
                    }
                  }}
                  onRemove={palette.remove}
                  peekAt={palette.peekAt}
                  canPick={palette.canPick}
                  zoom={zoom}
                  onZoom={setZoom}
                />
                <PalettePanel
                  swatches={palette.swatches}
                  count={palette.count}
                  onCount={palette.setCount}
                  total={palette.total}
                  picked={palette.picked}
                  locked={palette.locked}
                  available={palette.available}
                  hovered={hovered}
                  onHover={setHovered}
                  onRemove={palette.remove}
                  onToggleLock={palette.setLocked}
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
                  width={palette.image.width}
                  height={palette.image.height}
                  zoom={zoom}
                  onZoom={setZoom}
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
            </>
          )}
        </main>
      </div>
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
