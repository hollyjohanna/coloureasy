/**
 * Reading a colour back out of the image when the user clicks it.
 *
 * Averages a small neighbourhood rather than taking the single pixel under the
 * cursor — one stray JPEG artefact shouldn't be able to become your brand
 * colour.
 */

import type { Rgb } from './colour';

/** Side length of the averaged neighbourhood, in sampling-canvas pixels. */
const KERNEL = 5;

/**
 * Cap the sampling canvas rather than using full resolution. A 20MP photo would
 * be ~80MB of ImageData; at 2000px the colour read is indistinguishable and
 * memory stays bounded.
 */
const MAX_SIDE = 2000;

export type Sampler = {
  /** nx, ny are 0-1 relative to the image */
  at: (nx: number, ny: number) => Rgb;
};

export async function createSampler(src: string): Promise<Sampler> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Could not decode the image for sampling.'));
    el.src = src;
  });

  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not get a 2D context for sampling.');
  ctx.drawImage(img, 0, 0, width, height);

  const { data } = ctx.getImageData(0, 0, width, height);

  return {
    at(nx, ny) {
      const cx = Math.min(width - 1, Math.max(0, Math.floor(nx * width)));
      const cy = Math.min(height - 1, Math.max(0, Math.floor(ny * height)));
      const half = KERNEL >> 1;

      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;

      for (let y = cy - half; y <= cy + half; y++) {
        if (y < 0 || y >= height) continue;
        for (let x = cx - half; x <= cx + half; x++) {
          if (x < 0 || x >= width) continue;
          const p = (y * width + x) * 4;
          if (data[p + 3] < 128) continue;
          r += data[p];
          g += data[p + 1];
          b += data[p + 2];
          n++;
        }
      }

      // Everything in the neighbourhood was transparent — fall back to the
      // exact pixel so a click always produces something.
      if (n === 0) {
        const p = (cy * width + cx) * 4;
        return { r: data[p], g: data[p + 1], b: data[p + 2] };
      }

      return {
        r: Math.round(r / n),
        g: Math.round(g / n),
        b: Math.round(b / n),
      };
    },
  };
}
