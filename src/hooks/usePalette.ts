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
  filterKey,
  isNeutral,
  toPixelFilter,
  type PickerSettings,
} from '../lib/pickerSettings';
import {
  DEFAULT_COLOURS,
  deriveAtCount,
  MAX_COLOURS,
  maxAvailable,
  MIN_COLOURS,
  type PaletteNode,
  type PaletteTree,
} from '../lib/quantise';
import { createSampler, type Sampler } from '../lib/sample';
import { selectColours, sortBy } from '../lib/select';
import type { WorkerRequest, WorkerResponse } from '../workers/palette.worker';

type Status = 'empty' | 'loading' | 'extracting' | 'ready' | 'error';

/** Filter changes re-quantise in the worker; let a dragged slider settle first. */
const POOL_DEBOUNCE_MS = 150;

/**
 * @param settings how the picker shapes its generated colours. Neutral
 *   settings take the original area-led path exactly; anything else picks from
 *   a filtered pool the worker builds on request.
 */
export function usePalette(settings: PickerSettings) {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [tree, setTree] = useState<PaletteTree | null>(null);
  /** the natural tree re-run over only the pixels the picker's filters allow */
  const [pool, setPool] = useState<{ key: string; tree: PaletteTree; gen: number } | null>(
    null,
  );
  /**
   * How many colours the palette should hold in total, generated and
   * hand-picked together. Picking one by hand therefore grows the number
   * rather than quietly sitting outside it.
   */
  const [target, setTarget] = useState(DEFAULT_COLOURS);
  /**
   * Colours that survive regeneration: picked by hand, or locked out of a
   * generated palette. Both are spent from the same budget as generated ones.
   */
  const [pinned, setPinned] = useState<Swatch[]>([]);
  /** generated colours the user has thrown away, so they don't come straight back */
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
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
  // The pool most recently asked for; an older reply still in flight is stale.
  const poolKeyRef = useRef<string | null>(null);
  // Stamped into pool swatch ids. Node ids restart with every pool, so without
  // it a colour locked from an old pool would claim an unrelated new one's slot.
  const poolGen = useRef(0);

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

    // The worker stays up for as long as this image does: picker filters send
    // it back to the pixels it already holds. A newer image terminates it.
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (seq !== loadSeq.current) return;
      const data = event.data;

      if (data.type === 'pool') {
        if (data.key !== poolKeyRef.current) return;
        setPool({ key: data.key, tree: data.tree, gen: ++poolGen.current });
        // Exclusions against the old pool can never match again; drop them.
        setExcluded((prev) => new Set([...prev].filter((id) => !id.startsWith('p'))));
        return;
      }

      if (data.ok) {
        setTree(data.tree);
        setStatus('ready');
      } else {
        setError(data.error);
        setStatus('error');
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
      }
    };

    worker.onerror = () => {
      if (seq !== loadSeq.current) return;
      setError('Something went wrong while reading the colours.');
      setStatus('error');
    };

    const request: WorkerRequest = { type: 'load', bitmap };
    worker.postMessage(request, [bitmap]);

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
        setPool(null);
        poolKeyRef.current = null;
        setPinned([]);
        setExcluded(new Set());
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

  // Hand-picked colours are spent from the budget, so the generated ones make
  // room for them. Locked ones deliberately are not: a locked colour keeps the
  // slot it already had in the tree, so locking one never disturbs the others.
  const handPicked = useMemo(() => pinned.filter((s) => s.source === 'manual'), [pinned]);
  const locks = useMemo(
    () =>
      new Map(
        pinned.filter((s) => s.source === 'extracted' && s.locked).map((s) => [s.id, s]),
      ),
    [pinned],
  );

  const shaped = !isNeutral(settings);
  const key = filterKey(settings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Ask the worker for a pool whenever the eligible pixels change. The last
  // pool keeps showing until the new one lands, so dragging a slider never
  // blanks the palette.
  useEffect(() => {
    if (!tree || !shaped || pool?.key === key) return;
    const timer = setTimeout(() => {
      poolKeyRef.current = key;
      const request: WorkerRequest = {
        type: 'pool',
        key,
        filter: toPixelFilter(settingsRef.current),
      };
      workerRef.current?.postMessage(request);
    }, POOL_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [tree, shaped, key, pool?.key]);

  /**
   * Every colour the shaped picker would add, best first. Computed once for
   * all counts and sliced, so moving the count never reshuffles.
   */
  const sequence = useMemo(() => {
    if (!tree || !shaped || !pool) return null;
    return selectColours(pool.tree, settings, tree.totalPixels, MAX_COLOURS);
  }, [tree, shaped, pool, settings]);

  const swatches = useMemo<Swatch[]>(() => {
    if (!tree) return handPicked;

    const budget = Math.max(0, target - handPicked.length);

    const derive = (want: number): { id: string; node: PaletteNode }[] => {
      if (want === 0) return [];

      if (sequence && pool) {
        return sequence
          .map((node) => ({ id: `p${pool.gen}.${node.id}`, node }))
          .filter((c) => !excluded.has(c.id))
          .slice(0, want);
      }

      // Removing a colour takes its bucket out of play, so ask the tree for
      // more until enough survive — otherwise the palette would quietly shrink
      // every time something was thrown away.
      const at = (k: number) =>
        deriveAtCount(tree, k)
          .map((node) => ({ id: `g${node.id}`, node }))
          .filter((c) => !excluded.has(c.id));
      let nodes = at(want);
      for (let k = want + 1; nodes.length < want && k <= MAX_COLOURS; k++) {
        const next = at(k);
        if (next.length === nodes.length) break;
        nodes = next;
      }
      return nodes.slice(0, want);
    };

    // A locked colour usually still has its own bucket in the derive, and so
    // costs nothing extra. Slide far enough down and it drops out of the tree
    // while staying in the palette — then it does cost a slot, and the generated
    // share has to shrink to pay for it. That is circular, so settle it by
    // iterating; it converges in a couple of passes.
    let want = budget;
    let nodes = derive(want);
    for (let pass = 0; pass < 4; pass++) {
      const inTree = nodes.filter((c) => locks.has(c.id)).length;
      const next = Math.max(0, budget - (locks.size - inTree));
      if (next === want) break;
      want = next;
      nodes = derive(want);
    }

    const shown = nodes.map(({ id, node }): Swatch => {
      // A locked colour shows in the position it already occupied, from the
      // copy taken when it was locked rather than from the live tree.
      const held = locks.get(id);
      if (held) return held;
      return {
        id,
        rgb: node.rgb,
        x: node.x,
        y: node.y,
        source: 'extracted' as const,
        // Share of the whole image, even for a colour from a filtered pool.
        share: tree.totalPixels ? node.count / tree.totalPixels : 0,
      };
    });

    const present = new Set(shown.map((s) => s.id));
    const stranded = [...locks.values()].filter((s) => !present.has(s.id));

    const all = [...shown, ...stranded, ...handPicked];
    if (settings.sort === 'natural') return all;
    if (settings.sort === 'picked') {
      // Hand-picked in the order they were added, then locked, then the rest.
      const mine = new Set([...handPicked, ...all.filter((s) => s.locked)]);
      return [
        ...handPicked,
        ...all.filter((s) => s.locked && s.source !== 'manual'),
        ...all.filter((s) => !mine.has(s)),
      ];
    }
    // A real sort covers everything, hand-picked colours included — "dark to
    // light" with the picks stuck at the bottom regardless would be a lie.
    return sortBy(all, settings.sort);
  }, [tree, target, excluded, locks, handPicked, sequence, pool, settings.sort]);

  // Read by addAt's duplicate check, which must see the current palette without
  // being rebuilt every time that palette changes.
  const swatchesRef = useRef<Swatch[]>([]);
  swatchesRef.current = swatches;
  const pinnedRef = useRef<Swatch[]>([]);
  pinnedRef.current = pinned;

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
      if (pinnedRef.current.length >= MAX_COLOURS) {
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

      setPinned((prev) => [...prev, swatch]);
      // Grow the palette to fit, unless it is already as big as it goes — at
      // which point the new colour takes a generated one's place.
      setTarget((t) => Math.min(MAX_COLOURS, t + 1));
      return { swatch, duplicate: false, full: false };
    },
    [],
  );

  const setCount = useCallback((n: number) => {
    const current = pinnedRef.current;
    const lockedCount = current.filter((s) => s.locked).length;
    // Locked colours set the floor: the slider cannot push below them.
    const floor = Math.max(MIN_COLOURS, lockedCount);
    const next = Math.min(MAX_COLOURS, Math.max(floor, Math.round(n)));
    setTarget(next);
    // Sliding down eats the generated colours first, because `generatedCount`
    // shrinks on its own. Only once they have run out does this reach the
    // pinned ones — unlocked, most recent first.
    const picks = current.filter((s) => s.source === 'manual');
    if (picks.length > next) {
      // Most recent first, and never a locked one.
      const drop = new Set(
        picks
          .slice()
          .reverse()
          .filter((s) => !s.locked)
          .slice(0, picks.length - next)
          .map((s) => s.id),
      );
      setPinned(current.filter((s) => !drop.has(s.id)));
    }
  }, []);

  /**
   * Take a colour out of the palette.
   *
   * A generated colour has to be remembered as excluded, or the tree would
   * simply hand it back on the next render. Locked colours refuse.
   */
  const remove = useCallback((id: string) => {
    const pinnedNow = pinnedRef.current;
    const held = pinnedNow.find((s) => s.id === id);
    if (held?.locked) return;

    if (held) {
      setPinned(pinnedNow.filter((s) => s.id !== id));
    } else {
      setExcluded((prev) => new Set(prev).add(id));
    }

    // Removing shrinks the palette, mirroring the way adding grew it —
    // otherwise another colour would slide into the gap and the count could
    // only ever go up.
    setTarget((t) => Math.max(MIN_COLOURS, t - 1));
  }, []);

  /**
   * Pin a colour so the slider and the remove button leave it alone.
   *
   * Locking a generated colour copies it out of the tree, because the whole
   * point is that it survives a palette the tree would otherwise re-derive.
   */
  const setLocked = useCallback((id: string, locked: boolean) => {
    const existing = pinnedRef.current.find((s) => s.id === id);

    if (existing) {
      // A hand-picked colour is pinned whether it is locked or not. An
      // extracted one is only pinned *because* it was locked, so unlocking
      // gives it back to the tree rather than leaving it stuck in place.
      if (!locked && existing.source === 'extracted') {
        setPinned((prev) => prev.filter((s) => s.id !== id));
      } else {
        setPinned((prev) => prev.map((s) => (s.id === id ? { ...s, locked } : s)));
      }
      return;
    }

    if (!locked) return;
    const swatch = swatchesRef.current.find((s) => s.id === id);
    if (!swatch) return;
    setPinned((prev) => [...prev, { ...swatch, locked: true }]);
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
    setPool(null);
    poolKeyRef.current = null;
    setPinned([]);
    setExcluded(new Set());
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
    /** how many were added by clicking the image */
    picked: handPicked.length,
    /** how many refuse to be removed or slid away */
    locked: swatches.filter((s) => s.locked).length,
    /** how many distinct colours this image can yield, <= MAX_COLOURS */
    available: sequence ? sequence.length : tree ? maxAvailable(tree) : 0,
    /** true while the picker settings are steering which colours are chosen */
    shaped,
    /** true while a settings change is still being worked out in the worker */
    pooling: Boolean(tree && shaped && pool?.key !== key),
    canPick,
    derive,
    openFile,
    openUrl,
    openBlob,
    addAt,
    remove,
    setLocked,
    peekAt,
    reset,
  };
}
