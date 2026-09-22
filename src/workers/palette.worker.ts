/// <reference lib="webworker" />

/**
 * Runs the quantiser off the main thread, so a large image never freezes the UI.
 *
 * One worker lives for as long as its image does. `load` samples the image
 * once, keeps the OKLab pixels, and posts back the whole split tree to
 * MAX_COLOURS; changing the colour count afterwards is main-thread work
 * against that tree — see `deriveAtCount`.
 *
 * `pool` re-quantises just the pixels a set of picker filters lets through,
 * reusing the kept pixels so the image is never decoded twice.
 */

import { rgbToOklab } from '../lib/colour';
import type { PixelFilter } from '../lib/pickerSettings';
import { MAX_COLOURS, quantise, type PaletteTree, type QuantiseInput } from '../lib/quantise';
import { filterPixels, POOL_SIZE } from '../lib/select';

/** Longest side of the sampled image. ~65k pixels is plenty for a palette. */
const SAMPLE_SIZE = 256;

export type WorkerRequest =
  | { type: 'load'; bitmap: ImageBitmap }
  | { type: 'pool'; key: string; filter: PixelFilter };

export type WorkerResponse =
  | { type: 'tree'; ok: true; tree: PaletteTree }
  | { type: 'tree'; ok: false; error: string }
  | { type: 'pool'; key: string; tree: PaletteTree };

let pixels: QuantiseInput | null = null;

function buildInput(data: ImageData) {
  const { data: px, width, height } = data;
  const total = width * height;

  const lab = new Float32Array(total * 3);
  const srcIndex = new Uint32Array(total);
  let kept = 0;

  for (let i = 0; i < total; i++) {
    const p = i * 4;
    // Skip anything mostly transparent — a PNG's empty background is not a
    // colour anyone wants in their palette.
    if (px[p + 3] < 128) continue;

    const { L, a, b } = rgbToOklab({ r: px[p], g: px[p + 1], b: px[p + 2] });
    const q = kept * 3;
    lab[q] = L;
    lab[q + 1] = a;
    lab[q + 2] = b;
    srcIndex[kept] = i;
    kept++;
  }

  return {
    lab: lab.subarray(0, kept * 3),
    srcIndex: srcIndex.subarray(0, kept),
    width,
    height,
  };
}

function load(bitmap: ImageBitmap) {
  try {
    const scale = Math.min(1, SAMPLE_SIZE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not get a 2D context in the worker.');

    ctx.drawImage(bitmap, 0, 0, width, height);
    pixels = buildInput(ctx.getImageData(0, 0, width, height));
    // quantise sorts its own index array, never the pixels, so the kept copy
    // stays good for every pool request after this.
    const tree = quantise(pixels, MAX_COLOURS);

    const response: WorkerResponse = { type: 'tree', ok: true, tree };
    self.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      type: 'tree',
      ok: false,
      error: error instanceof Error ? error.message : 'Could not read that image.',
    };
    self.postMessage(response);
  } finally {
    bitmap.close();
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  if (request.type === 'load') {
    load(request.bitmap);
    return;
  }

  if (!pixels) return;
  const tree = quantise(filterPixels(pixels, request.filter), POOL_SIZE);
  const response: WorkerResponse = { type: 'pool', key: request.key, tree };
  self.postMessage(response);
};
