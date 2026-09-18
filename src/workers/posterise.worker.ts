/// <reference lib="webworker" />

/**
 * Runs the posterise pipeline off the main thread.
 *
 * Unlike the palette worker this one re-runs whenever the palette or the detail
 * setting changes, so it stays alive between messages rather than being spun up
 * per image. The label map comes back as a transferable, so a multi-megabyte
 * result costs nothing to hand over.
 */

import type { Rgb } from '../lib/colour';
import { posterise, type Detail } from '../lib/posterise';

/**
 * Longest side of the posterised result. Enough to print an A3 reference at
 * roughly 200dpi, while keeping a pass over the pixels comfortably fast.
 */
const MAX_SIDE = 2400;

export type PosteriseRequest = {
  /** monotonic id, echoed back so stale results can be discarded */
  id: number;
  bitmap: ImageBitmap;
  palette: Rgb[];
  detail: Detail;
};

export type PosteriseResponse =
  | {
      ok: true;
      id: number;
      labels: Uint8Array;
      width: number;
      height: number;
      counts: number[];
    }
  | { ok: false; id: number; error: string };

self.onmessage = (event: MessageEvent<PosteriseRequest>) => {
  const { id, bitmap, palette, detail } = event.data;

  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not get a 2D context in the worker.');

    // Nearest-neighbour keeps flat areas flat. Smoothing here would invent
    // in-between colours along every edge that the assign pass then has to
    // guess at, which is exactly the speckle we spend two passes removing.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const { data } = ctx.getImageData(0, 0, width, height);
    const result = posterise(data, width, height, palette, detail);

    const response: PosteriseResponse = {
      ok: true,
      id,
      labels: result.labels,
      width: result.width,
      height: result.height,
      counts: result.counts,
    };

    self.postMessage(response, [result.labels.buffer as ArrayBuffer]);
  } catch (error) {
    const response: PosteriseResponse = {
      ok: false,
      id,
      error:
        error instanceof Error ? error.message : 'Could not rebuild that image.',
    };
    self.postMessage(response);
  } finally {
    bitmap.close();
  }
};
