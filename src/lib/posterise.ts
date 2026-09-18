/**
 * Rebuilding an image out of nothing but a chosen palette.
 *
 * Three passes, all operating on a *label map* — one byte per pixel holding the
 * index of the palette colour that pixel became. The label map is the single
 * source of truth for the preview, for every layer, and for the export; nothing
 * downstream ever re-reads the original pixels.
 *
 *   1. assign            every pixel -> nearest palette colour, in OKLab
 *   2. modeFilter        kill isolated speckle
 *   3. mergeSmallRegions absorb islands too small to paint
 *
 * Steps 2 and 3 are what separate "posterised" from "paintable". A raw nearest-
 * colour mapping of a photo is full of single-pixel confetti along every edge,
 * and you cannot mix a pot of paint for a pixel.
 */

import { rgbToOklab, type Rgb } from './colour';

/** Reserved label for pixels that were transparent in the source. */
export const TRANSPARENT = 255;

/** Most palette colours we can label; 255 is reserved for transparency. */
export const MAX_LABELS = 255;

export type Detail = 'fine' | 'balanced' | 'bold';

type DetailSettings = {
  /** how many times to run the 3x3 mode filter */
  passes: number;
  /** regions smaller than this fraction of the image get absorbed */
  minAreaFraction: number;
};

export const DETAIL: Record<Detail, DetailSettings> = {
  fine: { passes: 1, minAreaFraction: 0.00001 },
  balanced: { passes: 2, minAreaFraction: 0.00005 },
  bold: { passes: 3, minAreaFraction: 0.0002 },
};

export type PosteriseResult = {
  labels: Uint8Array;
  width: number;
  height: number;
  /** pixels carrying each palette index; same length as the palette */
  counts: number[];
};

/* ------------------------------------------------------------------ assign */

/**
 * Map every pixel to the nearest palette colour in OKLab.
 *
 * The obvious loop is pixels x colours distance checks — 4M x 32 is far too
 * slow. Instead every distinct 24-bit RGB value is resolved once and cached in
 * a flat 16MB table. Photographs reuse the same values constantly, so after a
 * brief warm-up nearly every pixel costs one array read, and unlike a coarser
 * cache keyed on truncated channels the answer stays exact.
 */
export function assign(
  rgba: Uint8ClampedArray,
  palette: Rgb[],
  alphaThreshold = 128,
): Uint8Array {
  const pixels = rgba.length >> 2;
  const labels = new Uint8Array(pixels);

  if (palette.length === 0) {
    labels.fill(TRANSPARENT);
    return labels;
  }

  const lab = palette.map(rgbToOklab);

  // 0 means "not yet resolved"; anything else is paletteIndex + 1.
  const cache = new Uint8Array(1 << 24);

  for (let i = 0; i < pixels; i++) {
    const p = i << 2;

    if (rgba[p + 3] < alphaThreshold) {
      labels[i] = TRANSPARENT;
      continue;
    }

    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];
    const key = (r << 16) | (g << 8) | b;

    const cached = cache[key];
    if (cached !== 0) {
      labels[i] = cached - 1;
      continue;
    }

    const { L, a, b: bb } = rgbToOklab({ r, g, b });

    let best = 0;
    let bestDist = Infinity;
    for (let c = 0; c < lab.length; c++) {
      const dL = lab[c].L - L;
      const dA = lab[c].a - a;
      const dB = lab[c].b - bb;
      const dist = dL * dL + dA * dA + dB * dB;
      if (dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }

    cache[key] = best + 1;
    labels[i] = best;
  }

  return labels;
}

/* -------------------------------------------------------------- modeFilter */

/**
 * Replace each label with whichever label is most common in its 3x3
 * neighbourhood. Ties keep the existing label, so flat areas never jitter.
 *
 * Run repeatedly for a bolder result rather than widening the kernel: it is
 * cheaper per pass and the result is smoother, because a wide kernel rounds
 * corners off in one big jump.
 */
export function modeFilter(
  labels: Uint8Array,
  width: number,
  height: number,
  passes = 1,
): Uint8Array {
  if (passes <= 0 || width < 3 || height < 3) return labels;

  let src = labels;
  const counts = new Int32Array(256);

  for (let pass = 0; pass < passes; pass++) {
    const out = new Uint8Array(src);

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        const current = src[i];

        // Tally the 3x3 block, then read the winner off the same nine labels
        // and zero them again — no allocation, no full 256-entry sweep.
        let best = current;
        let bestCount = 0;

        for (let dy = -1; dy <= 1; dy++) {
          const row = i + dy * width;
          counts[src[row - 1]]++;
          counts[src[row]]++;
          counts[src[row + 1]]++;
        }

        for (let dy = -1; dy <= 1; dy++) {
          const row = i + dy * width;
          for (let dx = -1; dx <= 1; dx++) {
            const label = src[row + dx];
            const n = counts[label];
            // Strictly greater, or equal but already the current label: keeps
            // the existing value on a tie.
            if (n > bestCount || (n === bestCount && label === current)) {
              bestCount = n;
              best = label;
            }
          }
        }

        for (let dy = -1; dy <= 1; dy++) {
          const row = i + dy * width;
          counts[src[row - 1]] = 0;
          counts[src[row]] = 0;
          counts[src[row + 1]] = 0;
        }

        out[i] = best;
      }
    }

    src = out;
  }

  return src;
}

/* -------------------------------------------------------- mergeSmallRegions */

/**
 * Flood-fill each connected run of one label and absorb anything below
 * `minArea` into whichever label borders it most.
 *
 * The mode filter removes speckle but leaves small coherent islands — a
 * highlight in an eye, a few leaves against sky. Those are exactly the things
 * that make a layer unpaintable, so they get folded into their surroundings.
 */
export function mergeSmallRegions(
  labels: Uint8Array,
  width: number,
  height: number,
  minArea: number,
): Uint8Array {
  const total = width * height;
  if (minArea <= 1 || total === 0) return labels;

  const out = new Uint8Array(labels);
  const seen = new Uint8Array(total);
  const stack = new Int32Array(total);
  const region = new Int32Array(total);
  const border = new Int32Array(256);
  const touched: number[] = [];

  for (let start = 0; start < total; start++) {
    if (seen[start]) continue;

    const label = out[start];
    let top = 0;
    let size = 0;

    stack[top++] = start;
    seen[start] = 1;

    while (top > 0) {
      const i = stack[--top];
      region[size++] = i;

      const x = i % width;
      const y = (i / width) | 0;

      // 4-connected: diagonal links would bridge regions that only touch at a
      // corner, which merges shapes a painter would treat as separate.
      // Neighbours are inlined rather than routed through a helper — this is
      // the hot loop of the whole pipeline.
      for (let n = 0; n < 4; n++) {
        let j = -1;
        if (n === 0 && x > 0) j = i - 1;
        else if (n === 1 && x < width - 1) j = i + 1;
        else if (n === 2 && y > 0) j = i - width;
        else if (n === 3 && y < height - 1) j = i + width;
        if (j === -1) continue;

        const other = out[j];
        if (other === label) {
          if (!seen[j]) {
            seen[j] = 1;
            stack[top++] = j;
          }
        } else {
          // Tally how much of our perimeter each neighbouring label owns, so a
          // region gets absorbed by whatever most surrounds it.
          if (border[other] === 0) touched.push(other);
          border[other]++;
        }
      }
    }

    if (size < minArea && touched.length > 0) {
      let winner = touched[0];
      for (const candidate of touched) {
        if (border[candidate] > border[winner]) winner = candidate;
      }
      for (let k = 0; k < size; k++) out[region[k]] = winner;
    }

    for (const seenLabel of touched) border[seenLabel] = 0;
    touched.length = 0;
  }

  return out;
}

/* --------------------------------------------------------------- posterise */

/**
 * Paint a label map back into pixels.
 *
 * `visible` selects which labels are drawn; anything hidden, and anything that
 * was transparent to begin with, comes out transparent. That one flag covers
 * the preview, soloing a layer in the UI, and writing an isolated layer to a
 * PNG — they are all the same operation with a different set switched on.
 */
export function renderLabels(
  labels: Uint8Array,
  width: number,
  height: number,
  palette: Rgb[],
  visible?: readonly boolean[],
): ImageData {
  const rgba = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    if (label === TRANSPARENT) continue;
    if (visible && !visible[label]) continue;

    const colour = palette[label];
    if (!colour) continue;

    const p = i << 2;
    rgba[p] = colour.r;
    rgba[p + 1] = colour.g;
    rgba[p + 2] = colour.b;
    rgba[p + 3] = 255;
  }

  return new ImageData(rgba, width, height);
}

export function posterise(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  palette: Rgb[],
  detail: Detail = 'balanced',
): PosteriseResult {
  const { passes, minAreaFraction } = DETAIL[detail];

  let labels = assign(rgba, palette);
  labels = modeFilter(labels, width, height, passes);

  const minArea = Math.max(4, Math.round(width * height * minAreaFraction));
  labels = mergeSmallRegions(labels, width, height, minArea);

  const counts = new Array<number>(palette.length).fill(0);
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    if (label !== TRANSPARENT) counts[label]++;
  }

  return { labels, width, height, counts };
}
