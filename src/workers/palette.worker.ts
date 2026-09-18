/// <reference lib="webworker" />

/**
 * Runs the quantiser off the main thread, so a large image never freezes the UI.
 *
 * This runs *once per image*, all the way to MAX_COLOURS, and posts back the
 * whole split tree. Changing the colour count afterwards is main-thread work
 * against that tree — see `deriveAtCount`.
 */

import { rgbToOklab } from '../lib/colour';
import { MAX_COLOURS, quantise, type PaletteTree } from '../lib/quantise';

/** Longest side of the sampled image. ~65k pixels is plenty for a palette. */
const SAMPLE_SIZE = 256;

export type WorkerRequest = { bitmap: ImageBitmap };

export type WorkerResponse =
  | { ok: true; tree: PaletteTree }
  | { ok: false; error: string };

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

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { bitmap } = event.data;

  try {
    const scale = Math.min(1, SAMPLE_SIZE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not get a 2D context in the worker.');

    ctx.drawImage(bitmap, 0, 0, width, height);
    const tree = quantise(buildInput(ctx.getImageData(0, 0, width, height)), MAX_COLOURS);

    const response: WorkerResponse = { ok: true, tree };
    self.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not read that image.',
    };
    self.postMessage(response);
  } finally {
    bitmap.close();
  }
};
