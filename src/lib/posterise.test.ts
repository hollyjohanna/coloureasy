import { describe, expect, it } from 'vitest';
import type { Rgb } from './colour';
import {
  assign,
  mergeSmallRegions,
  modeFilter,
  posterise,
  TRANSPARENT,
} from './posterise';

const RED = { r: 255, g: 0, b: 0 };
const GREEN = { r: 0, g: 200, b: 0 };
const BLUE = { r: 0, g: 0, b: 255 };
const WHITE = { r: 255, g: 255, b: 255 };

/** Build an RGBA buffer from a grid of colours. */
function rgbaFrom(grid: (Rgb | null)[][]): {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
} {
  const height = grid.length;
  const width = grid[0].length;
  const rgba = new Uint8ClampedArray(width * height * 4);

  grid.forEach((row, y) =>
    row.forEach((c, x) => {
      const p = (y * width + x) * 4;
      // null means a transparent pixel.
      rgba[p] = c?.r ?? 0;
      rgba[p + 1] = c?.g ?? 0;
      rgba[p + 2] = c?.b ?? 0;
      rgba[p + 3] = c ? 255 : 0;
    }),
  );

  return { rgba, width, height };
}

/** Shorthand: a `fill`ed grid with individual cells overridden. */
function grid(w: number, h: number, fill: Rgb | null) {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => fill));
}

describe('assign', () => {
  it('maps exact palette colours to their own index', () => {
    const { rgba } = rgbaFrom([[RED, GREEN, BLUE]]);
    expect([...assign(rgba, [RED, GREEN, BLUE])]).toEqual([0, 1, 2]);
  });

  it('maps an off-palette colour to its nearest neighbour', () => {
    // A slightly dark red is still obviously red.
    const { rgba } = rgbaFrom([[{ r: 230, g: 20, b: 15 }]]);
    expect(assign(rgba, [RED, GREEN, BLUE])[0]).toBe(0);
  });

  it('judges nearness perceptually, not by RGB distance', () => {
    // RGB-wise this is equidistant-ish, but perceptually it reads as green.
    const { rgba } = rgbaFrom([[{ r: 60, g: 170, b: 60 }]]);
    expect(assign(rgba, [RED, GREEN, BLUE])[0]).toBe(1);
  });

  it('marks transparent pixels rather than colouring them', () => {
    const { rgba } = rgbaFrom([[RED, null, BLUE]]);
    expect([...assign(rgba, [RED, GREEN, BLUE])]).toEqual([0, TRANSPARENT, 2]);
  });

  it('is consistent — the same colour always gets the same label', () => {
    const { rgba } = rgbaFrom([
      [RED, BLUE, RED],
      [BLUE, RED, BLUE],
    ]);
    const labels = assign(rgba, [RED, GREEN, BLUE]);
    expect([...labels]).toEqual([0, 2, 0, 2, 0, 2]);
  });

  it('handles an empty palette without throwing', () => {
    const { rgba } = rgbaFrom([[RED]]);
    expect([...assign(rgba, [])]).toEqual([TRANSPARENT]);
  });
});

describe('modeFilter', () => {
  it('absorbs a lone speck into the field around it', () => {
    const g = grid(5, 5, RED);
    g[2][2] = BLUE;
    const { rgba, width, height } = rgbaFrom(g);

    const before = assign(rgba, [RED, BLUE]);
    expect(before[2 * 5 + 2]).toBe(1);

    const after = modeFilter(before, width, height, 1);
    expect(after[2 * 5 + 2]).toBe(0);
  });

  it('leaves a genuine region alone', () => {
    // Left half red, right half blue: the boundary is real and must survive.
    const g = grid(8, 8, RED);
    for (let y = 0; y < 8; y++) for (let x = 4; x < 8; x++) g[y][x] = BLUE;
    const { rgba, width, height } = rgbaFrom(g);

    const after = modeFilter(assign(rgba, [RED, BLUE]), width, height, 2);

    expect(after[4 * 8 + 1]).toBe(0);
    expect(after[4 * 8 + 6]).toBe(1);
  });

  it('does not touch the border ring', () => {
    const g = grid(5, 5, RED);
    g[0][0] = BLUE;
    const { rgba, width, height } = rgbaFrom(g);
    const after = modeFilter(assign(rgba, [RED, BLUE]), width, height, 1);
    expect(after[0]).toBe(1);
  });

  it('is a no-op for zero passes', () => {
    const g = grid(5, 5, RED);
    g[2][2] = BLUE;
    const { rgba, width, height } = rgbaFrom(g);
    const before = assign(rgba, [RED, BLUE]);
    expect([...modeFilter(before, width, height, 0)]).toEqual([...before]);
  });
});

describe('mergeSmallRegions', () => {
  it('absorbs an island into the label that surrounds it', () => {
    const g = grid(10, 10, RED);
    // A 2x2 blue island — coherent, so the mode filter would keep it.
    for (const [y, x] of [
      [4, 4],
      [4, 5],
      [5, 4],
      [5, 5],
    ]) {
      g[y][x] = BLUE;
    }
    const { rgba, width, height } = rgbaFrom(g);

    const labels = assign(rgba, [RED, BLUE]);
    expect(labels[4 * 10 + 4]).toBe(1);

    const merged = mergeSmallRegions(labels, width, height, 10);
    expect(merged[4 * 10 + 4]).toBe(0);
    expect([...merged].every((l) => l === 0)).toBe(true);
  });

  it('keeps a region at or above the minimum', () => {
    const g = grid(10, 10, RED);
    for (let y = 2; y < 8; y++) for (let x = 2; x < 8; x++) g[y][x] = BLUE;
    const { rgba, width, height } = rgbaFrom(g);

    const merged = mergeSmallRegions(assign(rgba, [RED, BLUE]), width, height, 10);
    expect(merged[5 * 10 + 5]).toBe(1);
  });

  it('picks the label that owns most of the perimeter', () => {
    // A single green pixel with three red neighbours and one blue.
    const g = grid(5, 5, RED);
    g[2][2] = GREEN;
    g[2][3] = BLUE;
    g[1][3] = BLUE;
    g[3][3] = BLUE;
    const { rgba, width, height } = rgbaFrom(g);

    const merged = mergeSmallRegions(assign(rgba, [RED, GREEN, BLUE]), width, height, 2);
    expect(merged[2 * 5 + 2]).toBe(0);
  });

  it('leaves a single-colour image untouched', () => {
    const { rgba, width, height } = rgbaFrom(grid(6, 6, RED));
    const merged = mergeSmallRegions(assign(rgba, [RED, BLUE]), width, height, 100);
    expect([...merged].every((l) => l === 0)).toBe(true);
  });

  it('treats corner-touching regions as separate', () => {
    // Two blue pixels meeting only at a corner are two regions of 1, not one
    // of 2 — so a minimum of 2 must absorb both.
    const g = grid(6, 6, RED);
    g[2][2] = BLUE;
    g[3][3] = BLUE;
    const { rgba, width, height } = rgbaFrom(g);

    const merged = mergeSmallRegions(assign(rgba, [RED, BLUE]), width, height, 2);
    expect(merged[2 * 6 + 2]).toBe(0);
    expect(merged[3 * 6 + 3]).toBe(0);
  });
});

describe('posterise', () => {
  const palette = [RED, GREEN, BLUE, WHITE];

  it('uses only palette colours and accounts for every pixel', () => {
    const g = grid(40, 40, RED);
    for (let y = 0; y < 40; y++) for (let x = 20; x < 40; x++) g[y][x] = BLUE;
    const { rgba, width, height } = rgbaFrom(g);

    const result = posterise(rgba, width, height, palette, 'balanced');

    expect([...result.labels].every((l) => l < palette.length)).toBe(true);
    expect(result.counts.reduce((a, b) => a + b, 0)).toBe(40 * 40);
    expect(result.counts[0]).toBe(800);
    expect(result.counts[2]).toBe(800);
  });

  it('excludes transparent pixels from the counts', () => {
    const g = grid(20, 20, RED);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 10; x++) g[y][x] = null;
    const { rgba, width, height } = rgbaFrom(g);

    const result = posterise(rgba, width, height, palette, 'fine');
    expect(result.counts.reduce((a, b) => a + b, 0)).toBe(200);
  });

  it('gives progressively simpler output as detail drops', () => {
    // Pseudo-random noise over a red field: bolder settings must leave fewer
    // separate specks behind.
    let seed = 99;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const g = grid(60, 60, RED);
    for (let y = 0; y < 60; y++) {
      for (let x = 0; x < 60; x++) {
        if (rand() < 0.12) g[y][x] = BLUE;
      }
    }
    const { rgba, width, height } = rgbaFrom(g);

    const speckles = (detail: 'fine' | 'balanced' | 'bold') =>
      posterise(rgba, width, height, palette, detail).counts[2];

    expect(speckles('fine')).toBeGreaterThanOrEqual(speckles('balanced'));
    expect(speckles('balanced')).toBeGreaterThanOrEqual(speckles('bold'));
    expect(speckles('bold')).toBe(0);
  });

  it('survives a 1x1 image', () => {
    const { rgba, width, height } = rgbaFrom([[RED]]);
    const result = posterise(rgba, width, height, palette, 'bold');
    expect(result.labels).toHaveLength(1);
    expect(result.counts[0]).toBe(1);
  });

  it('is deterministic', () => {
    const g = grid(30, 30, RED);
    g[10][10] = BLUE;
    g[20][20] = GREEN;
    const { rgba, width, height } = rgbaFrom(g);

    const a = posterise(rgba, width, height, palette, 'balanced');
    const b = posterise(rgba, width, height, palette, 'balanced');
    expect([...a.labels]).toEqual([...b.labels]);
  });
});
