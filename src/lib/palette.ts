import type { Rgb } from './colour';

export type Swatch = {
  /** stable across slider moves: `g<nodeId>` for extracted, `m<n>` for manual */
  id: string;
  rgb: Rgb;
  /** marker position, 0-1 relative to the image */
  x: number;
  y: number;
  source: 'extracted' | 'manual';
  /** share of sampled pixels this colour represents, 0-1; 0 for manual picks */
  share: number;
};
