import { useCallback, useEffect, useRef, useState } from 'react';
import type { Rgb } from '../lib/colour';
import type { LoadedImage } from '../lib/loadImage';
import type { Swatch } from '../lib/palette';

export const DEFAULT_PICKS = 5;
export const MIN_PICKS = 2;
export const MAX_PICKS = 10;

export type Pick = {
  /** the tree node id it came from, so identity survives a count change */
  id: string;
  rgb: Rgb;
  x: number;
  y: number;
  /** true once the marker has been dragged off its suggested spot */
  custom: boolean;
};

/**
 * A small, shareable palette pulled from the image, with a marker per colour
 * that can be dragged to re-pick, and bars that can be dragged to reorder.
 *
 * Kept separate from the Colour Picker's palette on purpose: this is the "give
 * me five nice colours" tool, and it shouldn't be dragged around by whatever
 * count the painting tools happen to be using.
 *
 * The array order is the user's order. Changing the count keeps it, along with
 * any colour that has been moved by hand — which is why this merges into the
 * existing list rather than rebuilding it.
 */
export function usePicks(
  derive: (n: number) => Swatch[],
  peekAt: (x: number, y: number) => Rgb | null,
  image: LoadedImage | null,
) {
  const [count, setCount] = useState(DEFAULT_PICKS);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);

  // Node ids are positions in a tree, so a different image can reuse them.
  // Without this, picks from the last picture would survive into the next one.
  const lastImage = useRef<LoadedImage | null>(null);

  useEffect(() => {
    if (!image) {
      lastImage.current = null;
      setPicks([]);
      return;
    }

    const base = derive(count);
    if (base.length === 0) return;

    const fresh = lastImage.current !== image;
    lastImage.current = image;

    setPicks((prev) => {
      const previous = fresh ? [] : prev;
      const suggested = new Map(base.map((s) => [s.id, s]));
      const before = new Set(previous.map((p) => p.id));

      const fill = (s: Swatch): Pick => ({
        id: s.id,
        rgb: s.rgb,
        x: s.x,
        y: s.y,
        custom: false,
      });

      const incoming = base.filter((s) => !before.has(s.id));
      let next = 0;
      const result: Pick[] = [];

      // Asking for one more colour splits a bucket, so one colour leaves and
      // two arrive. Dropping the newcomers into the gap the old one left keeps
      // the strip visually steady — appending them would shuffle the eye to
      // the end every time the count changed.
      for (const p of previous) {
        const s = suggested.get(p.id);
        if (s) {
          result.push(p.custom ? p : { ...p, rgb: s.rgb, x: s.x, y: s.y });
        } else if (next < incoming.length) {
          result.push(fill(incoming[next++]));
        }
      }

      while (next < incoming.length) result.push(fill(incoming[next++]));

      return result;
    });
  }, [derive, count, image]);

  const moveTo = useCallback(
    (id: string, x: number, y: number) => {
      const rgb = peekAt(x, y);
      if (!rgb) return;
      setPicks((prev) =>
        prev.map((p) => (p.id === id ? { ...p, rgb, x, y, custom: true } : p)),
      );
    },
    [peekAt],
  );

  /** Move a colour to a new position in the strip. */
  const reorder = useCallback((from: number, to: number) => {
    setPicks((prev) => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  /** Throw away every drag and go back to what the image suggests, in its order. */
  const reset = useCallback(() => {
    setPicks(
      derive(count).map((swatch) => ({
        id: swatch.id,
        rgb: swatch.rgb,
        x: swatch.x,
        y: swatch.y,
        custom: false,
      })),
    );
  }, [derive, count]);

  const step = useCallback(
    (delta: number) =>
      setCount((n) => Math.min(MAX_PICKS, Math.max(MIN_PICKS, n + delta))),
    [],
  );

  return {
    count,
    setCount,
    step,
    picks,
    moveTo,
    reorder,
    reset,
    dragging,
    setDragging,
    edited: picks.some((p) => p.custom),
  };
}
