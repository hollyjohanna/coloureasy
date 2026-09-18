import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Rgb } from '../lib/colour';
import {
  ImageLoadError,
  loadFromFile,
  loadFromUrl,
  releaseImage,
  type LoadedImage,
} from '../lib/loadImage';
import type { Swatch } from '../lib/palette';
import {
  DEFAULT_COLOURS,
  deriveAtCount,
  maxAvailable,
  type PaletteTree,
} from '../lib/quantise';
import { createSampler, type Sampler } from '../lib/sample';
import type { WorkerResponse } from '../workers/palette.worker';

type Status = 'empty' | 'loading' | 'extracting' | 'ready' | 'error';

export function usePalette() {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [tree, setTree] = useState<PaletteTree | null>(null);
  const [count, setCount] = useState(DEFAULT_COLOURS);
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

  const extracted = useMemo<Swatch[]>(() => {
    if (!tree) return [];
    return deriveAtCount(tree, count).map((node) => ({
      id: `g${node.id}`,
      rgb: node.rgb,
      x: node.x,
      y: node.y,
      source: 'extracted' as const,
      share: tree.totalPixels ? node.count / tree.totalPixels : 0,
    }));
  }, [tree, count]);

  // Manual picks live separately from the derived palette, so moving the slider
  // re-derives the extracted colours without disturbing anything hand-picked.
  const swatches = useMemo(() => [...extracted, ...manual], [extracted, manual]);

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

  const addAt = useCallback((x: number, y: number): Swatch | null => {
    const sampler = samplerRef.current;
    if (!sampler) return null;

    const swatch: Swatch = {
      id: `m${manualSeq.current++}`,
      rgb: sampler.at(x, y),
      x,
      y,
      source: 'manual',
      share: 0,
    };

    setManual((prev) => [...prev, swatch]);
    return swatch;
  }, []);

  const removeManual = useCallback(
    (id: string) => setManual((prev) => prev.filter((s) => s.id !== id)),
    [],
  );

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
    setCount(DEFAULT_COLOURS);
    setStatus('empty');
  }, []);

  return {
    image,
    status,
    error,
    swatches,
    count,
    setCount,
    /** how many colours this image can actually yield, <= MAX_COLOURS */
    available: tree ? maxAvailable(tree) : 0,
    canPick,
    derive,
    openFile,
    openUrl,
    addAt,
    removeManual,
    peekAt,
    reset,
  };
}
