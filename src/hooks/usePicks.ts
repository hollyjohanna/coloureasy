import { useCallback, useEffect, useRef, useState } from 'react';
import type { Rgb } from '../lib/colour';
import type { LoadedImage } from '../lib/loadImage';
import type { Swatch } from '../lib/palette';

export const DEFAULT_PICKS = 5;
export const MIN_PICKS = 2;
export const MAX_PICKS = 8;

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
 * that can be dragged to re-pick.
 *
 * Kept separate from the Colour Picker's palette on purpose: this is the "give
 * me five nice colours" tool, and it shouldn't be dragged around by whatever
 * count the painting tools happen to be using.
 *
 * Because the quantiser's tree is hierarchical, `derive(n)` and `derive(n + 1)`
 * share all but one id — so adding a colour keeps every marker the user has
 * already dragged exactly where they put it.
 */
export function usePicks(
  derive: (n: number) => Swatch[],
  peekAt: (x: number, y: number) => Rgb | null,
  image: LoadedImage | null,
) {
  const [count, setCount] = useState(DEFAULT_PICKS);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);

  // Read inside the regenerate effect without making it a dependency, which
  // would re-run (and discard drags) on every pick change.
  const picksRef = useRef<Pick[]>([]);
  picksRef.current = picks;

  useEffect(() => {
    if (!image) {
      setPicks([]);
      return;
    }

    const base = derive(count);
    if (base.length === 0) return;

    setPicks(
      base.map((swatch) => {
        const existing = picksRef.current.find((p) => p.id === swatch.id);
        // Anything the user moved stays moved.
        return existing?.custom
          ? existing
          : {
              id: swatch.id,
              rgb: swatch.rgb,
              x: swatch.x,
              y: swatch.y,
              custom: false,
            };
      }),
    );
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

  /** Throw away every drag and go back to what the image suggests. */
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

  return {
    count,
    setCount,
    picks,
    moveTo,
    reset,
    dragging,
    setDragging,
    edited: picks.some((p) => p.custom),
  };
}
