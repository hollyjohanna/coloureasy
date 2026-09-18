import { useCallback, useEffect, useState } from 'react';
import DropZone from './components/DropZone';
import ImageStage from './components/ImageStage';
import PalettePanel from './components/PalettePanel';
import SharedPalette from './components/SharedPalette';
import { usePalette } from './hooks/usePalette';
import type { Rgb } from './lib/colour';
import { paletteFromLocation } from './lib/shareUrl';

export default function App() {
  const palette = usePalette();
  const [hovered, setHovered] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [shared, setShared] = useState<Rgb[]>(() => paletteFromLocation());

  const notify = useCallback((message: string) => setToast(message), []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  const busy = palette.status === 'loading' || palette.status === 'extracting';

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-5 py-3">
        <div>
          <h1 className="text-sm font-semibold tracking-tight">
            Colour Extractor
          </h1>
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

      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {palette.image ? (
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
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-10 py-10">
            <DropZone
              onFile={palette.openFile}
              onUrl={palette.openUrl}
              busy={busy}
            />
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
          </div>
        )}
      </main>

      {busy && (
        <div className="pointer-events-none fixed inset-x-0 top-0 h-0.5 overflow-hidden bg-line">
          <div className="h-full w-1/3 animate-[slide_1.1s_ease-in-out_infinite] bg-ink" />
        </div>
      )}

      {palette.error && (
        <div
          role="alert"
          className="fixed bottom-5 left-1/2 max-w-[90vw] -translate-x-1/2 rounded-lg border border-line bg-raised px-4 py-2.5 text-sm shadow-xl"
        >
          {palette.error}
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
