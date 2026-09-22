/**
 * Shaped colour selection: choose n colours from a pool by what the person
 * asked for, rather than purely by how much of the image each covers.
 *
 * The pool is a quantise tree run to POOL_SIZE over only the eligible pixels
 * (see `filterPixels`). Selection is greedy maximal-marginal-relevance: each
 * step takes the candidate with the best
 *
 *     base score  +  diversity × distance to the nearest colour already chosen
 *
 * where the base score carries coverage, vibrancy, harmony and the "stay close"
 * halves of contrast and hue variety, and the distance carries the "spread
 * out" halves.
 *
 * Greedy picking produces a *sequence*, so the palette at n is always the first
 * n picks. That keeps the property the count slider relies on: one more colour
 * adds one colour, and never reshuffles the rest.
 */

import { hueDistance, oklabToOklch, rgbToOklab, type Oklch } from './colour';
import {
  CHROMA_FULL,
  HARMONIES,
  NEUTRAL_CHROMA,
  type PickerSettings,
  type PixelFilter,
  type SortOrder,
} from './pickerSettings';
import { deriveAtCount, type PaletteNode, type PaletteTree, type QuantiseInput } from './quantise';

/**
 * Leaves in a filtered pool. More than the palette can hold so there is real
 * choice once the shaping starts turning candidates down; the quantiser's own
 * spread gate stops earlier on images without that much to give.
 */
export const POOL_SIZE = 256;

/** Copy out only the pixels that pass the filter, ready to quantise again. */
export function filterPixels(input: QuantiseInput, f: PixelFilter): QuantiseInput {
  const { lab, srcIndex } = input;
  const total = srcIndex.length;
  const outLab = new Float32Array(total * 3);
  const outIdx = new Uint32Array(total);
  let kept = 0;

  for (let i = 0; i < total; i++) {
    const p = i * 3;
    const L = lab[p];
    if (L < f.lMin || L > f.lMax) continue;

    const a = lab[p + 1];
    const b = lab[p + 2];
    const C = Math.sqrt(a * a + b * b);
    if (C < f.cMin || C > f.cMax) continue;

    if (f.hue !== null) {
      // A grey has no hue to be in the family, however close its noise lands.
      if (C < NEUTRAL_CHROMA) continue;
      const h = (Math.atan2(b, a) * 180) / Math.PI;
      if (hueDistance(h < 0 ? h + 360 : h, f.hue) > f.hueWidth) continue;
    }

    outLab[kept * 3] = L;
    outLab[kept * 3 + 1] = a;
    outLab[kept * 3 + 2] = b;
    outIdx[kept] = srcIndex[i];
    kept++;
  }

  return {
    lab: outLab.subarray(0, kept * 3),
    srcIndex: outIdx.subarray(0, kept),
    width: input.width,
    height: input.height,
  };
}

type Candidate = {
  node: PaletteNode;
  L: number;
  a: number;
  b: number;
  C: number;
  h: number;
  /** share of the whole image, 0-1 */
  share: number;
  chromatic: boolean;
};

/** Harmony fit falls off as a Gaussian of this many degrees from a target hue. */
const HARMONY_SPREAD = 25;
/** Among on-scheme hues, the ones closest to a target come first. */
const HARMONY_WEIGHT = 1.5;
/** A grey sits with any scheme, but shouldn't beat a colour that fits it. */
const NEUTRAL_FIT = 0.3;
/**
 * Further than this from every target hue and a colour is off-scheme and out.
 * Letting them back in as filler once the scheme runs dry turns
 * "complementary" into "everything" at any sizeable count.
 */
const HARMONY_LIMIT = 45;

/**
 * The hue that covers the most of the image, summed over a 30° window.
 *
 * Not simply the biggest single candidate: a gradient sky is spread over many
 * small leaves and would lose to one flat patch of something else, though it
 * is plainly the picture's main colour.
 */
function dominantHue(candidates: Candidate[]): number {
  const BINS = 36;
  const bins = new Float64Array(BINS);
  for (const c of candidates) {
    if (c.chromatic) bins[Math.floor(c.h / (360 / BINS)) % BINS] += c.share;
  }

  let best = -1;
  let bestSum = 0;
  for (let i = 0; i < BINS; i++) {
    const sum = bins[(i + BINS - 1) % BINS] + bins[i] + bins[(i + 1) % BINS];
    if (sum > bestSum) {
      bestSum = sum;
      best = i;
    }
  }
  if (best === -1) return 0;

  // Refine to the share-weighted mean hue inside the winning window, averaged
  // as vectors so a window straddling 0°/360° doesn't average to 180°.
  const centre = (best + 0.5) * (360 / BINS);
  let x = 0;
  let y = 0;
  for (const c of candidates) {
    if (!c.chromatic || hueDistance(c.h, centre) > 15) continue;
    const rad = (c.h * Math.PI) / 180;
    x += c.share * Math.cos(rad);
    y += c.share * Math.sin(rad);
  }
  const h = (Math.atan2(y, x) * 180) / Math.PI;
  return h < 0 ? h + 360 : h;
}

/**
 * The palette's colours in the order they should be added.
 *
 * @param totalPixels the whole image's sampled pixel count, so `minShare` and
 *   coverage mean share of the picture rather than of the filtered pool
 */
export function selectColours(
  pool: PaletteTree,
  settings: PickerSettings,
  totalPixels: number,
  n: number,
): PaletteNode[] {
  if (pool.nodes.length === 0 || n <= 0) return [];

  const total = totalPixels || pool.totalPixels || 1;
  const minShare = settings.minShare / 100;

  const candidates: Candidate[] = deriveAtCount(pool, POOL_SIZE)
    .map((node) => {
      const { L, a, b } = rgbToOklab(node.rgb);
      const { C, h } = oklabToOklch({ L, a, b });
      return { node, L, a, b, C, h, share: node.count / total, chromatic: C >= NEUTRAL_CHROMA };
    })
    .filter((c) => c.share >= minShare);

  if (candidates.length === 0) return [];

  const contrast = settings.contrast / 100;
  const hueVariety = settings.hueVariety / 100;
  const vibrancy = settings.vibrancy / 100;
  const accents = settings.accents / 100;

  // Anchors: where "the image's own" lightness and hue sit, weighted by area.
  // Low contrast and low hue variety both mean "stay near these".
  let wSum = 0;
  let lSum = 0;
  for (const c of candidates) {
    wSum += c.share;
    lSum += c.share * c.L;
  }
  const anchorL = wSum > 0 ? lSum / wSum : 0.5;

  const anchorHue = settings.focusHue ?? dominantHue(candidates);

  const targets =
    HARMONIES.find((h) => h.id === settings.harmony)?.offsets.map((o) => anchorHue + o) ?? [];

  // Coverage on a log scale, normalised across the pool: area matters, but a
  // colour covering 30% shouldn't be worth three hundred times one covering 0.1%.
  const logs = candidates.map((c) => Math.log(c.share + 1e-6));
  const logMin = Math.min(...logs);
  const logSpan = Math.max(...logs) - logMin || 1;

  const base = candidates.map((c, i) => {
    const prominence = (logs[i] - logMin) / logSpan;
    let score =
      // Dominance is the default lean — without it, noise-sized leaves
      // compete with real regions — and the accents slider trades it away.
      ((1 - accents) / 2) * prominence + Math.max(accents, 0) * (1 - prominence) * 0.5;

    score += vibrancy * (Math.min(1, c.C / CHROMA_FULL) - 0.5);

    if (contrast < 0) score += contrast * Math.abs(c.L - anchorL) * 2;
    if (hueVariety < 0 && c.chromatic) {
      score += hueVariety * (hueDistance(c.h, anchorHue) / 180) * 1.5;
    }

    if (targets.length > 0) {
      const fit = c.chromatic
        ? Math.max(
            ...targets.map((t) => Math.exp(-((hueDistance(c.h, t) / HARMONY_SPREAD) ** 2))),
          )
        : NEUTRAL_FIT;
      score += HARMONY_WEIGHT * fit;
    }

    return score;
  });

  // Spreading lightness weights the L axis; spreading hue weights a and b.
  const kL = 1 + 4 * Math.max(contrast, 0);
  const kAB = 2 + 8 * Math.max(hueVariety, 0);
  const diversity = 1 + 2 * (Math.max(contrast, 0) + Math.max(hueVariety, 0));

  const dist = (p: Candidate, q: Candidate) => {
    const dL = p.L - q.L;
    const da = p.a - q.a;
    const db = p.b - q.b;
    return Math.sqrt(kL * dL * dL + kAB * (da * da + db * db));
  };

  // Distance from each candidate to its nearest chosen colour, updated as each
  // pick lands — n·N rather than n²·N.
  const nearest = new Float64Array(candidates.length).fill(Infinity);
  // Off-scheme colours start out as though already taken.
  const taken = new Uint8Array(candidates.length);
  if (targets.length > 0) {
    candidates.forEach((c, i) => {
      if (c.chromatic && Math.min(...targets.map((t) => hueDistance(c.h, t))) > HARMONY_LIMIT) {
        taken[i] = 1;
      }
    });
  }
  const out: PaletteNode[] = [];

  while (out.length < n) {
    let at = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < candidates.length; i++) {
      if (taken[i]) continue;
      // Nothing chosen yet means nothing to be distant from: the first pick
      // is the best colour on its own merits.
      const spread = out.length === 0 ? 0 : diversity * nearest[i];
      const score = base[i] + spread;
      if (score > bestScore) {
        bestScore = score;
        at = i;
      }
    }

    if (at === -1) break;
    taken[at] = 1;
    out.push(candidates[at].node);

    for (let i = 0; i < candidates.length; i++) {
      if (taken[i]) continue;
      const d = dist(candidates[i], candidates[at]);
      if (d < nearest[i]) nearest[i] = d;
    }
  }

  return out;
}

/**
 * Reorder for display. 'natural' keeps whatever order the picker chose, and so
 * does 'picked' — putting the person's own colours first is the caller's job,
 * since only it knows which those are.
 */
export function sortBy<T extends { rgb: { r: number; g: number; b: number }; share: number }>(
  items: T[],
  order: SortOrder,
): T[] {
  if (order === 'natural' || order === 'picked') return items;
  if (order === 'coverage') return [...items].sort((p, q) => q.share - p.share);

  const lch = new Map<T, Oklch>(items.map((s) => [s, oklabToOklch(rgbToOklab(s.rgb))]));
  if (order === 'lightness') {
    return [...items].sort((p, q) => lch.get(q)!.L - lch.get(p)!.L);
  }
  if (order === 'darkFirst') {
    return [...items].sort((p, q) => lch.get(p)!.L - lch.get(q)!.L);
  }
  // Hue order, with greys gathered at the end from light to dark — a grey's
  // hue angle is noise, and scattering them through the wheel looks broken.
  return [...items].sort((p, q) => {
    const a = lch.get(p)!;
    const b = lch.get(q)!;
    const ga = a.C < NEUTRAL_CHROMA;
    const gb = b.C < NEUTRAL_CHROMA;
    if (ga !== gb) return ga ? 1 : -1;
    return ga ? b.L - a.L : a.h - b.h;
  });
}
