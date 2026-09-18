import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Rgb } from '../lib/colour';
import type { LoadedImage } from '../lib/loadImage';
import type { Detail, PosteriseResult } from '../lib/posterise';
import { DEFAULT_VALUES } from '../lib/valueStudy';
import type { Layer } from './usePosterise';
import type { ValueRequest, ValueResponse } from '../workers/value.worker';

const DEBOUNCE_MS = 200;

export function useValueStudy(image: LoadedImage | null, enabled: boolean) {
  const [steps, setSteps] = useState(DEFAULT_VALUES);
  const [detail, setDetail] = useState<Detail>('balanced');
  const [palette, setPalette] = useState<Rgb[]>([]);
  const [result, setResult] = useState<PosteriseResult | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<number>>(new Set());

  const workerRef = useRef<Worker | null>(null);
  const seq = useRef(0);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!image) {
      setResult(null);
      setPalette([]);
      setHidden(new Set());
    }
  }, [image]);

  useEffect(() => {
    if (!enabled || !image) return;

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
            new URL('../workers/value.worker.ts', import.meta.url),
            { type: 'module' },
          );
        }
        const worker = workerRef.current;

        worker.onmessage = (event: MessageEvent<ValueResponse>) => {
          if (event.data.id !== seq.current) return;

          if (event.data.ok) {
            const { labels, width, height, counts } = event.data;
            setPalette(event.data.palette);
            setResult({ labels, width, height, counts });
            // Steps can shrink between runs; drop anything hidden that's gone.
            setHidden((prev) => new Set([...prev].filter((i) => i < counts.length)));
          } else {
            setError(event.data.error);
          }
          setWorking(false);
        };

        worker.onerror = () => {
          if (cancelled) return;
          setError('Something went wrong while building the value study.');
          setWorking(false);
        };

        const request: ValueRequest = { id, bitmap, steps, detail };
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
  }, [enabled, image, steps, detail]);

  // Shaped like the posterise layers so the same export path and list UI work.
  const layers = useMemo<Layer[]>(() => {
    if (!result) return [];
    const total = result.counts.reduce((a, b) => a + b, 0) || 1;

    return palette.map((rgb, index) => ({
      index,
      swatch: {
        id: `v${index}`,
        rgb,
        x: 0,
        y: 0,
        source: 'extracted' as const,
        share: (result.counts[index] ?? 0) / total,
      },
      pixels: result.counts[index] ?? 0,
      coverage: (result.counts[index] ?? 0) / total,
    }));
    // Kept in tonal order, darkest first — that's how you'd block a study in.
  }, [result, palette]);

  const visible = useMemo(
    () => palette.map((_, i) => !hidden.has(i)),
    [palette, hidden],
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
        const alreadySolo = prev.size === palette.length - 1 && !prev.has(index);
        if (alreadySolo) return new Set();
        return new Set(palette.map((_, i) => i).filter((i) => i !== index));
      });
    },
    [palette],
  );

  const showAll = useCallback(() => setHidden(new Set()), []);

  return {
    steps,
    setSteps,
    detail,
    setDetail,
    palette,
    result,
    layers,
    visible,
    hidden,
    working,
    error,
    toggle,
    solo,
    showAll,
    allVisible: hidden.size === 0,
  };
}
