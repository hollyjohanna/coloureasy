/**
 * Getting the posterised image out: one PNG per colour in a ZIP, and a
 * printable reference sheet.
 */

import { formatAll, readableTextOn, rgbToHex, type Rgb } from './colour';
import { baseName, download } from './export';
import type { Layer } from '../hooks/usePosterise';
import { renderLabels, type PosteriseResult } from './posterise';
import { zip, type ZipEntry } from './zip';

export type LayerMode = 'isolated' | 'cumulative';

function canvasFrom(image: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext('2d')?.putImageData(image, 0, 0);
  return canvas;
}

async function toPng(canvas: HTMLCanvasElement): Promise<Uint8Array<ArrayBuffer>> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png'),
  );
  if (!blob) throw new Error('Could not encode a PNG.');
  return new Uint8Array(await blob.arrayBuffer());
}

/** `01-e2574c` — ASCII only, zero-padded so files sort in painting order. */
const layerName = (position: number, rgb: Rgb, total: number) =>
  `${String(position + 1).padStart(String(total).length, '0')}-${rgbToHex(rgb).slice(1)}`;

/* -------------------------------------------------------------------- ZIP */

export async function exportLayerZip(
  result: PosteriseResult,
  layers: Layer[],
  palette: Rgb[],
  imageName: string,
  mode: LayerMode,
  onProgress?: (done: number, total: number) => void,
) {
  const used = layers.filter((layer) => layer.pixels > 0);
  const { labels, width, height } = result;
  const entries: ZipEntry[] = [];

  // Cumulative layers accumulate everything painted so far, so a viewer
  // stacking them in order sees each successive coat. Isolated layers hold one
  // colour each and can be stacked in any order at all.
  const showing = palette.map(() => false);

  for (const [position, layer] of used.entries()) {
    if (mode === 'isolated') showing.fill(false);
    showing[layer.index] = true;

    const png = await toPng(
      canvasFrom(renderLabels(labels, width, height, palette, showing)),
    );

    entries.push({
      name: `${layerName(position, layer.swatch.rgb, used.length)}.png`,
      data: png,
    });

    onProgress?.(position + 1, used.length + 1);
  }

  // The complete image, for checking a stack against.
  entries.push({
    name: 'flattened.png',
    data: await toPng(
      canvasFrom(renderLabels(labels, width, height, palette, palette.map(() => true))),
    ),
  });

  entries.push({
    name: 'palette.json',
    data: new TextEncoder().encode(
      JSON.stringify(
        {
          source: imageName,
          extractedAt: new Date().toISOString(),
          mode,
          width,
          height,
          layers: used.map((layer, position) => ({
            file: `${layerName(position, layer.swatch.rgb, used.length)}.png`,
            ...formatAll(layer.swatch.rgb),
            coverage: Number(layer.coverage.toFixed(4)),
            pixels: layer.pixels,
          })),
        },
        null,
        2,
      ),
    ),
  });

  entries.push({
    name: 'README.txt',
    data: new TextEncoder().encode(
      mode === 'isolated'
        ? [
            'Isolated layers.',
            '',
            'Each PNG holds one colour and is transparent everywhere else.',
            'No two layers overlap, so stacking all of them in any order',
            'reproduces flattened.png exactly.',
            '',
            'Layers are numbered by coverage, largest area first.',
          ].join('\n')
        : [
            'Cumulative layers.',
            '',
            'Each PNG holds its own colour plus every colour beneath it, so',
            'each one is a complete coat painted over the last.',
            '',
            'Stack them in numerical order — 01 first, then 02 over it, and',
            'so on. The final layer is identical to flattened.png.',
          ].join('\n'),
    ),
  });

  onProgress?.(used.length + 1, used.length + 1);
  download(zip(entries), `${baseName(imageName, 'layers')}.zip`);
}

/* -------------------------------------------------------- reference sheet */

const SHEET_WIDTH = 2480; // A4 at 300dpi
const MARGIN = 80;
const SWATCH = 150;
const GAP = 14;

/**
 * Posterised image on top, numbered swatches below — sized to print on A4 and
 * take to the easel.
 */
export async function exportReferenceSheet(
  result: PosteriseResult,
  layers: Layer[],
  palette: Rgb[],
  imageName: string,
  suffix = 'reference',
) {
  const used = layers.filter((layer) => layer.pixels > 0);
  const { labels, width, height } = result;

  const inner = SHEET_WIDTH - MARGIN * 2;
  const imageHeight = Math.round((height / width) * inner);

  const columns = Math.max(1, Math.floor((inner + GAP) / (SWATCH + GAP)));
  const rows = Math.ceil(used.length / columns);
  const swatchBlock = rows * (SWATCH + 52) + GAP;

  const canvas = document.createElement('canvas');
  canvas.width = SHEET_WIDTH;
  canvas.height = MARGIN * 2 + imageHeight + 70 + swatchBlock;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get a 2D context for the reference sheet.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const flat = canvasFrom(
    renderLabels(labels, width, height, palette, palette.map(() => true)),
  );
  ctx.drawImage(flat, MARGIN, MARGIN, inner, imageHeight);

  let y = MARGIN + imageHeight + 50;

  ctx.fillStyle = '#111111';
  ctx.font = '600 30px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(
    `${imageName} — ${used.length} ${suffix === 'values' ? 'values' : 'colours'}`,
    MARGIN,
    y,
  );

  y += 40;

  used.forEach((layer, i) => {
    const x = MARGIN + (i % columns) * (SWATCH + GAP);
    const top = y + Math.floor(i / columns) * (SWATCH + 52);
    const hex = rgbToHex(layer.swatch.rgb).toUpperCase();

    ctx.fillStyle = hex;
    ctx.fillRect(x, top, SWATCH, SWATCH);

    // Outline every swatch: white and near-white ones are otherwise invisible
    // against the paper, which is exactly the case on most photographs.
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, top + 1, SWATCH - 2, SWATCH - 2);

    // Number inside the swatch, in whichever of black/white stays readable.
    ctx.fillStyle = readableTextOn(layer.swatch.rgb);
    ctx.font = '700 34px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(String(i + 1), x + 12, top + 44);

    ctx.fillStyle = '#111111';
    ctx.font = '500 20px ui-monospace, "SF Mono", Menlo, monospace';
    ctx.fillText(hex, x, top + SWATCH + 26);

    ctx.fillStyle = '#777777';
    ctx.font = '18px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(`${(layer.coverage * 100).toFixed(1)}%`, x, top + SWATCH + 48);
  });

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png'),
  );
  if (blob) download(blob, `${baseName(imageName, suffix)}.png`);
}
