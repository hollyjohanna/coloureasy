/**
 * Getting a palette out of the tool: a PNG sheet, and a JSON file.
 */

import { formatAll, readableTextOn, rgbToHex } from './colour';
import type { Swatch } from './palette';

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * `photo.jpg` -> `photo-palette`.
 *
 * Non-ASCII is stripped rather than preserved: these names end up inside ZIP
 * archives, and older unzip builds still mangle UTF-8 filenames badly enough to
 * fail the extraction.
 */
export function baseName(imageName: string, suffix = 'palette') {
  const stem = imageName.replace(/\.[^./]+$/, '').replace(/[^a-z0-9-_]+/gi, '-');
  return `${stem || suffix}-${suffix}`;
}

/* -------------------------------------------------------------------- PNG */

const SWATCH = 160;
const LABEL = 44;
const PAD = 24;
const COLUMNS = 5;
const DPR = 2;

export async function exportPng(swatches: Swatch[], imageName: string) {
  if (swatches.length === 0) return;

  const cols = Math.min(COLUMNS, swatches.length);
  const rows = Math.ceil(swatches.length / cols);
  const width = PAD * 2 + cols * SWATCH;
  const height = PAD * 2 + rows * (SWATCH + LABEL);

  const canvas = document.createElement('canvas');
  canvas.width = width * DPR;
  canvas.height = height * DPR;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get a 2D context for the PNG export.');
  ctx.scale(DPR, DPR);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  swatches.forEach((swatch, i) => {
    const x = PAD + (i % cols) * SWATCH;
    const y = PAD + Math.floor(i / cols) * (SWATCH + LABEL);
    const hex = rgbToHex(swatch.rgb).toUpperCase();

    ctx.fillStyle = hex;
    ctx.fillRect(x, y, SWATCH, SWATCH);

    // Outline every swatch: white and near-white ones are otherwise invisible
    // against the sheet.
    ctx.strokeStyle = '#d9d9d9';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, SWATCH - 1, SWATCH - 1);

    // Hex inside the swatch, in whichever of black/white stays readable on it.
    ctx.fillStyle = readableTextOn(swatch.rgb);
    ctx.font = '600 15px ui-monospace, "SF Mono", Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(hex, x + SWATCH / 2, y + SWATCH - 16);

    ctx.fillStyle = '#6b6b6b';
    ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
    const meta =
      swatch.source === 'manual'
        ? 'picked'
        : `${(swatch.share * 100).toFixed(1)}%`;
    ctx.fillText(meta, x + SWATCH / 2, y + SWATCH + 20);
  });

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png'),
  );
  if (blob) download(blob, `${baseName(imageName)}.png`);
}

/* ------------------------------------------------------------------- JSON */

export function exportJson(swatches: Swatch[], imageName: string) {
  const payload = {
    source: imageName,
    extractedAt: new Date().toISOString(),
    count: swatches.length,
    colours: swatches.map((swatch) => ({
      ...formatAll(swatch.rgb),
      source: swatch.source,
      share: Number(swatch.share.toFixed(4)),
      position: { x: Number(swatch.x.toFixed(4)), y: Number(swatch.y.toFixed(4)) },
    })),
  };

  download(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    `${baseName(imageName)}.json`,
  );
}
