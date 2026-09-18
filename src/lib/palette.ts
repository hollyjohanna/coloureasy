import type { Rgb } from './colour';

export type Swatch = {
  /** stable across slider moves: `g<nodeId>` for extracted, `m<n>` for manual */
  id: string;
  rgb: Rgb;
  /** marker position, 0-1 relative to the image */
  x: number;
  y: number;
  source: 'extracted' | 'manual';
  /** kept whatever the count slider does, and refuses to be removed */
  locked?: boolean;
  /** share of sampled pixels this colour represents, 0-1; 0 for manual picks */
  share: number;
};

/**
 * The swatch already holding this exact colour, if any.
 *
 * A palette with the same colour twice is never useful — it is two swatches to
 * mix identically and two markers to chase — so click-to-add points at the
 * existing one rather than adding a second.
 */
export function findSameColour(
  swatches: readonly Swatch[],
  rgb: Rgb,
): Swatch | undefined {
  return swatches.find(
    (s) => s.rgb.r === rgb.r && s.rgb.g === rgb.g && s.rgb.b === rgb.b,
  );
}
