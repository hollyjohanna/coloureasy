/**
 * Reducing an image to a handful of tonal values.
 *
 * This is the study a painter does before touching colour: if the values are
 * wrong the painting fails however well the colours are mixed, so you check the
 * structure first in three or four greys.
 *
 * Values are spaced *evenly* across the range of lightness the image actually
 * contains — deliberately not the population-based clustering the colour
 * quantiser uses.
 *
 * Clustering by population is right for colour and wrong for tone. On a subject
 * against a white background, more than half the pixels are the lightest value,
 * so a clustering pass spends every step separating near-whites and hands back
 * a darkest value of mid-grey, leaving dark linework and shadow with nowhere to
 * sit. A painter needs the whole range represented, which is also why a real
 * value scale is evenly stepped.
 *
 * Measuring the range off the image rather than assuming 0-100 keeps that
 * honest for high-key and low-contrast photographs, and taking it between
 * percentiles stops one stray pixel stretching the whole scale.
 *
 * Convert the image to neutral grey afterwards and the ordinary posterise
 * pipeline applies unchanged.
 */

import { oklabToRgb, rgbToOklab, type Rgb } from './colour';

export const DEFAULT_VALUES = 4;
export const MIN_VALUES = 2;
export const MAX_VALUES = 9;

/** Enough samples to describe a tonal distribution without scanning millions. */
const TARGET_SAMPLES = 60_000;

/** Lightness resolution of the histogram used to find the range. */
const BINS = 1000;

/**
 * Ignore the extreme half-percent at each end. A single blown highlight or one
 * black pixel of dust would otherwise stretch the scale and squash every real
 * value into the middle of it.
 */
const CLIP = 0.005;

/**
 * Replace every pixel with the neutral grey of the same perceived lightness.
 *
 * Doing this *before* assigning means nearest-colour in full OKLab reduces to
 * nearest-in-lightness, so a saturated red and a dull red of the same tone land
 * on the same value — which is the entire point of a value study.
 */
export function toGreyscale(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);

  for (let p = 0; p < rgba.length; p += 4) {
    const { L } = rgbToOklab({ r: rgba[p], g: rgba[p + 1], b: rgba[p + 2] });
    const { r } = oklabToRgb({ L, a: 0, b: 0 });
    out[p] = r;
    out[p + 1] = r;
    out[p + 2] = r;
    out[p + 3] = rgba[p + 3];
  }

  return out;
}

/**
 * Derive `steps` tonal values from the image, darkest first.
 *
 * Returns neutral greys, so they can be handed straight to `posterise` as a
 * palette.
 */
export function valuePalette(
  rgba: Uint8ClampedArray,
  steps: number,
  alphaThreshold = 128,
): Rgb[] {
  const pixels = rgba.length >> 2;
  if (pixels === 0 || steps < 1) return [];

  const stride = Math.max(1, Math.floor(pixels / TARGET_SAMPLES));
  const histogram = new Uint32Array(BINS);
  let counted = 0;

  for (let i = 0; i < pixels; i += stride) {
    const p = i << 2;
    if (rgba[p + 3] < alphaThreshold) continue;

    const { L } = rgbToOklab({ r: rgba[p], g: rgba[p + 1], b: rgba[p + 2] });
    const bin = Math.min(BINS - 1, Math.max(0, Math.round(L * (BINS - 1))));
    histogram[bin]++;
    counted++;
  }

  if (counted === 0) return [];

  /** Lightness below which `fraction` of the sampled pixels fall. */
  const percentile = (fraction: number) => {
    const target = counted * fraction;
    let seen = 0;
    for (let bin = 0; bin < BINS; bin++) {
      seen += histogram[bin];
      if (seen >= target) return bin / (BINS - 1);
    }
    return 1;
  };

  const low = percentile(CLIP);
  const high = percentile(1 - CLIP);

  const grey = (L: number) => oklabToRgb({ L, a: 0, b: 0 });

  // A flat or near-flat image has no range to divide: one value describes it.
  if (high - low < 1 / BINS) return [grey((low + high) / 2)];
  if (steps === 1) return [grey((low + high) / 2)];

  const values: Rgb[] = [];
  for (let i = 0; i < steps; i++) {
    const value = grey(low + ((high - low) * i) / (steps - 1));
    // Narrow ranges can round neighbouring steps onto the same 8-bit grey;
    // returning duplicates would show as duplicate layers.
    if (!values.some((v) => v.r === value.r)) values.push(value);
  }

  return values;
}

/** 0-100, how light this value sits. Used to label the value scale. */
export const valueOf = (rgb: Rgb) =>
  Math.round(rgbToOklab(rgb).L * 100);
