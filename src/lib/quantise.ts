/**
 * Recursive colour quantisation: repeatedly take the worst bucket and cut it in
 * two. Median cut in shape, with two changes that matter a lot in practice.
 *
 * Three decisions worth knowing about:
 *
 * 1. Everything happens in OKLab rather than RGB. RGB distance doesn't match
 *    what the eye sees, so RGB median cut over-represents greens and smears
 *    near-neutrals together. OKLab distance roughly does match, so buckets land
 *    where a person would put them.
 *
 * 2. Buckets are cut where the children's combined error is lowest, not at the
 *    median pixel — see `bestSplit`. Textbook median cut bisects tight clusters
 *    over and over and returns visibly duplicate swatches; this doesn't.
 *
 * 3. `quantise` always runs to MAX_COLOURS and returns the whole split *tree*,
 *    not a flat palette. The process is hierarchical, so the palette at any
 *    n <= MAX_COLOURS is just "replay the first n-1 splits" — see
 *    `deriveAtCount`. That makes the count slider instant, and it makes the
 *    palette stable: going 20 -> 21 splits one bucket and leaves the other 19
 *    exactly as they were, instead of reshuffling everything.
 */

import { oklabToRgb, type Oklab, type Rgb } from './colour';

export const MAX_COLOURS = 64;
export const DEFAULT_COLOURS = 20;
export const MIN_COLOURS = 2;

/**
 * A bucket whose colours are this close together (RMS distance from its own
 * mean, in OKLab) is treated as a single colour and never split again.
 *
 * Without this gate, total squared error alone keeps cutting the *largest*
 * region long after it has stopped being interesting, because SSE scales with
 * pixel count: a big smooth sky with a whisper of sensor noise outscores a
 * small, genuinely distinct accent colour. You end up spending six palette
 * slots on six indistinguishable blues.
 *
 * ~0.01 in OKLab sits just under a just-noticeable difference, so anything
 * rejected here is a distinction nobody could see anyway.
 */
const MIN_SPREAD = 0.01;

export type PaletteNode = {
  id: number;
  /** -1 when this node was never split */
  childA: number;
  childB: number;
  rgb: Rgb;
  /** how many sampled pixels fell in this bucket */
  count: number;
  /** representative pixel, normalised 0-1 relative to the image */
  x: number;
  y: number;
};

export type PaletteTree = {
  nodes: PaletteNode[];
  /** node ids in the order they were split */
  splitOrder: number[];
  totalPixels: number;
};

export type QuantiseInput = {
  /** OKLab triples, 3 floats per sampled pixel */
  lab: Float32Array;
  /** index into the downsampled image (y * width + x) for each sampled pixel */
  srcIndex: Uint32Array;
  width: number;
  height: number;
};

type Range = {
  id: number;
  start: number;
  /** exclusive */
  end: number;
  /** cached at creation — the pixel set in a range never changes afterwards */
  sse: number;
  spread: number;
  axis: number;
};

/** Mean, sum of squared error, and widest axis for one index range. */
function analyse(lab: Float32Array, order: Uint32Array, start: number, end: number) {
  const n = end - start;
  let sL = 0;
  let sA = 0;
  let sB = 0;

  for (let i = start; i < end; i++) {
    const p = order[i] * 3;
    sL += lab[p];
    sA += lab[p + 1];
    sB += lab[p + 2];
  }

  const mean: Oklab = { L: sL / n, a: sA / n, b: sB / n };

  let vL = 0;
  let vA = 0;
  let vB = 0;

  for (let i = start; i < end; i++) {
    const p = order[i] * 3;
    const dL = lab[p] - mean.L;
    const dA = lab[p + 1] - mean.a;
    const dB = lab[p + 2] - mean.b;
    vL += dL * dL;
    vA += dA * dA;
    vB += dB * dB;
  }

  // Total squared error ranks which bucket to cut next; RMS spread decides
  // whether it is worth cutting at all (see MIN_SPREAD).
  const sse = vL + vA + vB;
  const spread = Math.sqrt(sse / n);
  const axis = vL >= vA && vL >= vB ? 0 : vA >= vB ? 1 : 2;

  return { mean, sse, spread, axis };
}

/**
 * Given a bucket already sorted along `axis`, find the cut that minimises the
 * two children's combined squared error.
 *
 * Textbook median cut splits at the median *position*, which is why it behaves
 * badly on clustered data: a bucket of 40 reds and 3 blues gets cut straight
 * through the middle of the reds, producing two near-identical red swatches and
 * dragging the blues along for another round. Cutting where the error is lowest
 * puts the boundary in the gap between the clusters instead, which is where a
 * person would put it.
 *
 * Prefix sums make this one linear pass rather than a quadratic search.
 */
function bestSplit(
  lab: Float32Array,
  order: Uint32Array,
  start: number,
  end: number,
): number {
  const n = end - start;

  // Running sums and sums-of-squares, so any prefix's SSE is O(1) to evaluate.
  const sum = new Float64Array((n + 1) * 3);
  const sqs = new Float64Array((n + 1) * 3);

  for (let i = 0; i < n; i++) {
    const p = order[start + i] * 3;
    for (let c = 0; c < 3; c++) {
      const v = lab[p + c];
      sum[(i + 1) * 3 + c] = sum[i * 3 + c] + v;
      sqs[(i + 1) * 3 + c] = sqs[i * 3 + c] + v * v;
    }
  }

  // SSE of items [0, k) = Σx² − (Σx)²/k, summed over the three channels.
  const sse = (from: number, to: number) => {
    const k = to - from;
    if (k <= 0) return 0;
    let total = 0;
    for (let c = 0; c < 3; c++) {
      const s = sum[to * 3 + c] - sum[from * 3 + c];
      const q = sqs[to * 3 + c] - sqs[from * 3 + c];
      total += q - (s * s) / k;
    }
    return total;
  };

  let bestAt = n >> 1;
  let bestCost = Infinity;

  for (let k = 1; k < n; k++) {
    const cost = sse(0, k) + sse(k, n);
    if (cost < bestCost) {
      bestCost = cost;
      bestAt = k;
    }
  }

  return start + bestAt;
}

/** The sampled pixel closest to `mean`, as normalised image coordinates. */
function representative(
  input: QuantiseInput,
  order: Uint32Array,
  start: number,
  end: number,
  mean: Oklab,
) {
  const { lab, srcIndex, width, height } = input;
  let best = order[start];
  let bestDist = Infinity;

  for (let i = start; i < end; i++) {
    const idx = order[i];
    const p = idx * 3;
    const dL = lab[p] - mean.L;
    const dA = lab[p + 1] - mean.a;
    const dB = lab[p + 2] - mean.b;
    const dist = dL * dL + dA * dA + dB * dB;
    if (dist < bestDist) {
      bestDist = dist;
      best = idx;
    }
  }

  const src = srcIndex[best];
  return {
    // centre of the sampled pixel, so markers sit in the middle of it
    x: ((src % width) + 0.5) / width,
    y: (Math.floor(src / width) + 0.5) / height,
  };
}

export function quantise(input: QuantiseInput, maxColours = MAX_COLOURS): PaletteTree {
  const { lab } = input;
  const pixelCount = input.srcIndex.length;

  const nodes: PaletteNode[] = [];
  const splitOrder: number[] = [];

  if (pixelCount === 0) {
    return { nodes, splitOrder, totalPixels: 0 };
  }

  // Median cut partitions this index array in place; a bucket is a [start, end)
  // slice of it, which is why splits never need to copy pixel data around.
  const order = new Uint32Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) order[i] = i;

  const makeNode = (start: number, end: number): Range => {
    const { mean, sse, spread, axis } = analyse(lab, order, start, end);
    const { x, y } = representative(input, order, start, end, mean);
    const id = nodes.length;
    nodes.push({
      id,
      childA: -1,
      childB: -1,
      rgb: oklabToRgb(mean),
      count: end - start,
      x,
      y,
    });
    return { id, start, end, sse, spread, axis };
  };

  const leaves: Range[] = [makeNode(0, pixelCount)];

  while (leaves.length < maxColours) {
    // Pick the leaf with the highest squared error that can still be split.
    let at = -1;
    let bestSse = 0;

    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i];
      if (leaf.end - leaf.start < 2) continue;
      // Already a single colour to the eye — splitting it would just produce
      // two swatches nobody can tell apart.
      if (leaf.spread < MIN_SPREAD) continue;
      if (leaf.sse > bestSse) {
        bestSse = leaf.sse;
        at = i;
      }
    }

    // Nothing left worth splitting — the image has fewer distinct colours than
    // asked for, which is a fine place to stop.
    if (at === -1 || bestSse <= 0) break;

    const target = leaves[at];

    // Sort the bucket's slice along its widest axis, then cut where the error
    // is lowest. TypedArray sort is specified as stable, so this is
    // deterministic: the same image always yields the same palette.
    const slice = order.subarray(target.start, target.end);
    slice.sort((p, q) => lab[p * 3 + target.axis] - lab[q * 3 + target.axis]);

    const cut = bestSplit(lab, order, target.start, target.end);

    const a = makeNode(target.start, cut);
    const b = makeNode(cut, target.end);

    nodes[target.id].childA = a.id;
    nodes[target.id].childB = b.id;
    splitOrder.push(target.id);

    // Replace the parent in place so leaf order stays positionally stable:
    // every other swatch keeps its slot in the palette when the slider moves.
    leaves.splice(at, 1, a, b);
  }

  return { nodes, splitOrder, totalPixels: pixelCount };
}

/**
 * Read the palette at a given colour count by replaying the first n-1 splits.
 * Synchronous and sub-millisecond — this is what the slider calls.
 */
export function deriveAtCount(tree: PaletteTree, n: number): PaletteNode[] {
  if (tree.nodes.length === 0) return [];

  const leaves: number[] = [0];
  const steps = Math.min(Math.max(n, 1) - 1, tree.splitOrder.length);

  for (let i = 0; i < steps; i++) {
    const id = tree.splitOrder[i];
    const at = leaves.indexOf(id);
    if (at === -1) continue;
    const node = tree.nodes[id];
    leaves.splice(at, 1, node.childA, node.childB);
  }

  return leaves.map((id) => tree.nodes[id]);
}

/** How many distinct colours this image can actually yield. */
export const maxAvailable = (tree: PaletteTree) => tree.splitOrder.length + 1;
