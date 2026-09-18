import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Rgb } from '../lib/colour';
import {
  ImageLoadError,
  loadFromBlob,
  loadFromFile,
  loadFromUrl,
  releaseImage,
  type LoadedImage,
} from '../lib/loadImage';
import { findSameColour, type Swatch } from '../lib/palette';
import {
  DEFAULT_COLOURS,
  deriveAtCount,
  MAX_COLOURS,
  maxAvailable,
  MIN_COLOURS,
  type PaletteTree,
} from '../lib/quantise';
import { createSampler, type Sampler } from '../lib/sample';
import type { WorkerResponse } from '../workers/palette.worker';

type Status = 'empty' | 'loading' | 'extracting' | 'ready' | 'error';

export function usePalette() {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [tree, setTree] = useState<PaletteTree | null>(null);
  /**
   * How many colours the palette should hold in total, generated and
   * hand-picked together. Picking one by hand therefore grows the number
   * rather than quietly sitting outside it.
   */
  const [target, setTarget] = useState(DEFAULT_COLOURS);
  const [manual, setManual] = useState<Swatch[]>([]);
  const [status, setStatus] = useState<Status>('empty');
  const [error, setError] = useState<string | null>(null);
  // Mirrors samplerRef so the UI can re-render once click-to-add becomes live.
  const [canPick, setCanPick] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const samplerRef = useRef<Sampler | null>(null);
  const imageRef = useRef<LoadedImage | null>(null);
  const manualSeq = useRef(0);
  // Guards against a slow first image resolving after a second one was dropped.
  const loadSeq = useRef(0);

  imageRef.current = image;

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      releaseImage(imageRef.current);
    },
    [],
  );

  const extract = useCallback(async (next: LoadedImage, seq: number) => {
    setStatus('extracting');

    const bitmap = await createImageBitmap(
      await fetch(next.src).then((r) => r.blob()),
    );

    workerRef.current?.terminate();
    const worker = new Worker(new URL('../workers/palette.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (seq !== loadSeq.current) return;
      if (event.data.ok) {
        setTree(event.data.tree);
        setStatus('ready');
      } else {
        setError(event.data.error);
        setStatus('error');
      }
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };

    worker.onerror = () => {
      if (seq !== loadSeq.current) return;
      setError('Something went wrong while reading the colours.');
      setStatus('error');
    };

    worker.postMessage({ bitmap }, [bitmap]);

    // Kick off the full-resolution sampler in parallel; click-to-add needs it,
    // but the palette shouldn't wait on it.
    createSampler(next.src)
      .then((sampler) => {
        if (seq !== loadSeq.current) return;
        samplerRef.current = sampler;
        setCanPick(true);
      })
      .catch(() => {
        /* click-to-add stays unavailable; extraction is unaffected */
      });
  }, []);

  const accept = useCallback(
    async (load: () => Promise<LoadedImage>) => {
      const seq = ++loadSeq.current;
      setStatus('loading');
      setError(null);

      try {
        const next = await load();
        if (seq !== loadSeq.current) {
          releaseImage(next);
          return;
        }

        releaseImage(imageRef.current);
        samplerRef.current = null;
        setCanPick(false);
        setImage(next);
        setTree(null);
        setManual([]);
        manualSeq.current = 0;

        await extract(next, seq);
      } catch (err) {
        if (seq !== loadSeq.current) return;
        setError(
          err instanceof ImageLoadError
            ? err.message
            : 'That image could not be loaded.',
        );
        setStatus('error');
      }
    },
    [extract],
  );

  const openFile = useCallback((file: File) => accept(() => loadFromFile(file)), [accept]);
  const openUrl = useCallback((url: string) => accept(() => loadFromUrl(url)), [accept]);
  const openBlob = useCallback(
    (blob: Blob, name: string) => accept(() => loadFromBlob(blob, name)),
    [accept],
  );

  // Hand-picked colours are spent from the same budget, so the generated ones
  // make room for them instead of the total creeping past what was asked for.
  const generatedCount = Math.max(0, target - manual.length);

  const extracted = useMemo<Swatch[]>(() => {
    if (!tree || generatedCount === 0) return [];
    return deriveAtCount(tree, generatedCount).map((node) => ({
      id: `g${node.id}`,
      rgb: node.rgb,
      x: node.x,
      y: node.y,
      source: 'extracted' as const,
      share: tree.totalPixels ? node.count / tree.totalPixels : 0,
    }));
  }, [tree, generatedCount]);

  // Manual picks live separately from the derived palette, so moving the slider
  // re-derives the extracted colours without disturbing anything hand-picked.
  const swatches = useMemo(() => [...extracted, ...manual], [extracted, manual]);

  // Read by addAt's duplicate check, which must see the current palette without
  // being rebuilt every time that palette changes.
  const swatchesRef = useRef<Swatch[]>([]);
  swatchesRef.current = swatches;
  const manualRef = useRef<Swatch[]>([]);
  manualRef.current = manual;

  /**
   * Read the palette at an arbitrary count without disturbing this hook's own
   * `count`. Lets a second tool show five colours while the picker shows
   * twenty, off the same tree — and because the tree is hierarchical, the ids
   * stay stable as that count changes.
   */
  const derive = useCallback(
    (n: number): Swatch[] => {
      if (!tree) return [];
      return deriveAtCount(tree, n).map((node) => ({
        id: `g${node.id}`,
        rgb: node.rgb,
        x: node.x,
        y: node.y,
        source: 'extracted' as const,
        share: tree.totalPixels ? node.count / tree.totalPixels : 0,
      }));
    },
    [tree],
  );

  /**
   * Result of a click on the image: either a new swatch, or the one that was
   * already holding that exact colour.
   */
  const addAt = useCallback(
    (
      x: number,
      y: number,
    ): { swatch: Swatch | null; duplicate: boolean; full?: boolean } | null => {
      const sampler = samplerRef.current;
      if (!sampler) return null;

      const rgb = sampler.at(x, y);

      // A palette with the same colour twice is never what anyone wants — it
      // is two swatches to mix identically, and two markers to chase. Point at
      // the existing one instead of adding another.
      const existing = findSameColour(swatchesRef.current, rgb);
      if (existing) return { swatch: existing, duplicate: true };

      // At the ceiling there is nothing left to spend, and every remaining
      // slot is already hand-picked.
      if (manualRef.current.length >= MAX_COLOURS) {
        return { swatch: null, duplicate: false, full: true };
      }

      const swatch: Swatch = {
        id: `m${manualSeq.current++}`,
        rgb,
        x,
        y,
        source: 'manual',
        share: 0,
      };

      setManual((prev) => [...prev, swatch]);
      // Grow the palette to fit, unless it is already as big as it goes — at
      // which point the new colour takes a generated one's place.
      setTarget((t) => Math.min(MAX_COLOURS, t + 1));
      return { swatch, duplicate: false, full: false };
    },
    [],
  );

  const setCount = useCallback((n: number) => {
    const next = Math.min(MAX_COLOURS, Math.max(MIN_COLOURS, Math.round(n)));
    setTarget(next);
    // Sliding down eats the generated colours first, because `generatedCount`
    // shrinks on its own. Only when they have run out does this bite into the
    // hand-picked ones, most recent first.
    setManual((prev) => (prev.length > next ? prev.slice(0, next) : prev));
  }, []);

  const removeManual = useCallback((id: string) => {
    setManual((prev) => {
      const next = prev.filter((s) => s.id !== id);
      // Taking a colour out shrinks the palette, mirroring the way adding one
      // grew it — otherwise a generated colour would silently slide into the
      // gap and the count would never come back down.
      if (next.length !== prev.length) {
        setTarget((t) => Math.max(MIN_COLOURS, t - 1));
      }
      return next;
    });
  }, []);

  const peekAt = useCallback(
    (x: number, y: number): Rgb | null => samplerRef.current?.at(x, y) ?? null,
    [],
  );

  const reset = useCallback(() => {
    loadSeq.current++;
    workerRef.current?.terminate();
    workerRef.current = null;
    releaseImage(imageRef.current);
    samplerRef.current = null;
    setCanPick(false);
    setImage(null);
    setTree(null);
    setManual([]);
    setError(null);
    setTarget(DEFAULT_COLOURS);
    setStatus('empty');
  }, []);

  return {
    image,
    status,
    error,
    swatches,
    /** what the slider is set to */
    count: target,
    setCount,
    /** how many colours are actually in the palette right now */
    total: swatches.length,
    /** how many of those were placed by hand */
    picked: manual.length,
    /** how many distinct colours this image can yield, <= MAX_COLOURS */
    available: tree ? maxAvailable(tree) : 0,
    canPick,
    derive,
    openFile,
    openUrl,
    openBlob,
    addAt,
    removeManual,
    peekAt,
    reset,
  };
}
