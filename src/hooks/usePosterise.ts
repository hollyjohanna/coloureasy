import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LoadedImage } from '../lib/loadImage';
import type { Swatch } from '../lib/palette';
import type { Detail, PosteriseResult } from '../lib/posterise';
import type {
  PosteriseRequest,
  PosteriseResponse,
} from '../workers/posterise.worker';

/**
 * Dragging the colour slider would otherwise queue a full-resolution posterise
 * per tick. The previous result stays on screen while this settles.
 */
const DEBOUNCE_MS = 250;

export type Layer = {
  /** index into the palette, which is also the label in the map */
  index: number;
  swatch: Swatch;
  pixels: number;
  /** 0-1 of the visible image */
  coverage: number;
};

export function usePosterise(
  image: LoadedImage | null,
  swatches: Swatch[],
  enabled: boolean,
) {
  const [detail, setDetail] = useState<Detail>('balanced');
  const [result, setResult] = useState<PosteriseResult | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<number>>(new Set());

  const workerRef = useRef<Worker | null>(null);
  const seq = useRef(0);

  // The palette is the only part of a swatch the worker needs, and comparing
  // the colours by value stops identical palettes from re-triggering work.
  const paletteKey = swatches.map((s) => `${s.rgb.r},${s.rgb.g},${s.rgb.b}`).join('|');

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  // Hidden layers are indexes into a palette that may have just changed size,
  // so drop any that no longer exist rather than leaving dangling entries.
  useEffect(() => {
    setHidden((prev) => {
      const next = new Set([...prev].filter((i) => i < swatches.length));
      return next.size === prev.size ? prev : next;
    });
  }, [swatches.length]);

  useEffect(() => {
    if (!enabled || !image || swatches.length === 0) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      const id = ++seq.current;
      setWorking(true);
      setError(null);

      try {
        const bitmap = await createImageBitmap(
          await fetch(image.src).then((r) => r.blob()),
        );
        if (cancelled) {
          bitmap.close();
          return;
        }

        if (!workerRef.current) {
          workerRef.current = new Worker(
            new URL('../workers/posterise.worker.ts', import.meta.url),
            { type: 'module' },
          );
        }
        const worker = workerRef.current;

        worker.onmessage = (event: MessageEvent<PosteriseResponse>) => {
          // A slower earlier run must never overwrite a newer result.
          if (event.data.id !== seq.current) return;

          if (event.data.ok) {
            const { labels, width, height, counts } = event.data;
            setResult({ labels, width, height, counts });
          } else {
            setError(event.data.error);
          }
          setWorking(false);
        };

        worker.onerror = () => {
          if (cancelled) return;
          setError('Something went wrong while rebuilding the image.');
          setWorking(false);
        };

        const request: PosteriseRequest = {
          id,
          bitmap,
          palette: swatches.map((s) => s.rgb),
          detail,
        };
        worker.postMessage(request, [bitmap]);
      } catch {
        if (!cancelled) {
          setError('Could not read that image.');
          setWorking(false);
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // paletteKey stands in for the swatch colours by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, image, paletteKey, detail, swatches.length]);

  // Drop a stale result when the image goes away, so the old posterised
  // preview can't flash up under a new one.
  useEffect(() => {
    if (!image) {
      setResult(null);
      setHidden(new Set());
    }
  }, [image]);

  const layers = useMemo<Layer[]>(() => {
    if (!result) return [];
    const visiblePixels = result.counts.reduce((a, b) => a + b, 0) || 1;

    return swatches
      .map((swatch, index) => ({
        index,
        swatch,
        pixels: result.counts[index] ?? 0,
        coverage: (result.counts[index] ?? 0) / visiblePixels,
      }))
      // Largest area first, so the base coat is the dominant colour. Colours
      // that ended up unused still list, at the bottom, so it's clear they
      // contributed nothing.
      .sort((a, b) => b.pixels - a.pixels);
  }, [result, swatches]);

  /** Indexed by palette position, for `renderLabels`. */
  const visible = useMemo(
    () => swatches.map((_, i) => !hidden.has(i)),
    [swatches, hidden],
  );

  const toggle = useCallback((index: number) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const solo = useCallback(
    (index: number) => {
      setHidden((prev) => {
        const isAlreadySolo = prev.size === swatches.length - 1 && !prev.has(index);
        if (isAlreadySolo) return new Set();
        return new Set(swatches.map((_, i) => i).filter((i) => i !== index));
      });
    },
    [swatches],
  );

  const showAll = useCallback(() => setHidden(new Set()), []);

  return {
    result,
    layers,
    visible,
    hidden,
    working,
    error,
    detail,
    setDetail,
    toggle,
    solo,
    showAll,
    allVisible: hidden.size === 0,
  };
}
