/// <reference lib="webworker" />

/**
 * Builds a tonal value study: derive the image's own value steps, flatten it to
 * neutral grey, then posterise onto those steps.
 */

import type { Rgb } from '../lib/colour';
import { posterise, type Detail } from '../lib/posterise';
import { toGreyscale, valuePalette } from '../lib/valueStudy';

/** Matches the posterise worker, so the two views line up pixel for pixel. */
const MAX_SIDE = 2400;

export type ValueRequest = {
  id: number;
  bitmap: ImageBitmap;
  steps: number;
  detail: Detail;
};

export type ValueResponse =
  | {
      ok: true;
      id: number;
      palette: Rgb[];
      labels: Uint8Array;
      width: number;
      height: number;
      counts: number[];
    }
  | { ok: false; id: number; error: string };

self.onmessage = (event: MessageEvent<ValueRequest>) => {
  const { id, bitmap, steps, detail } = event.data;

  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not get a 2D context in the worker.');

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const { data } = ctx.getImageData(0, 0, width, height);

    const palette = valuePalette(data, steps);
    const result = posterise(toGreyscale(data), width, height, palette, detail);

    const response: ValueResponse = {
      ok: true,
      id,
      palette,
      labels: result.labels,
      width: result.width,
      height: result.height,
      counts: result.counts,
    };

    self.postMessage(response, [result.labels.buffer as ArrayBuffer]);
  } catch (error) {
    const response: ValueResponse = {
      ok: false,
      id,
      error:
        error instanceof Error ? error.message : 'Could not build a value study.',
    };
    self.postMessage(response);
  } finally {
    bitmap.close();
  }
};
