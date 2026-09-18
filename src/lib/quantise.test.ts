import { describe, expect, it } from 'vitest';
import { rgbToHex, rgbToOklab, type Rgb } from './colour';
import {
  deriveAtCount,
  maxAvailable,
  quantise,
  type QuantiseInput,
} from './quantise';

/** Build a QuantiseInput from a flat list of pixels laid out left-to-right. */
function makeInput(pixels: Rgb[], width = pixels.length): QuantiseInput {
  const lab = new Float32Array(pixels.length * 3);
  const srcIndex = new Uint32Array(pixels.length);

  pixels.forEach((rgb, i) => {
    const { L, a, b } = rgbToOklab(rgb);
    lab[i * 3] = L;
    lab[i * 3 + 1] = a;
    lab[i * 3 + 2] = b;
    srcIndex[i] = i;
  });

  return { lab, srcIndex, width, height: Math.ceil(pixels.length / width) };
}

/** A repeatable pseudo-random image — no Math.random, so tests stay deterministic. */
function syntheticImage(count: number): Rgb[] {
  let seed = 12345;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  return Array.from({ length: count }, () => ({
    r: Math.floor(next() * 256),
    g: Math.floor(next() * 256),
    b: Math.floor(next() * 256),
  }));
}

const RED = { r: 255, g: 0, b: 0 };
const GREEN = { r: 0, g: 200, b: 0 };
const BLUE = { r: 0, g: 0, b: 255 };
const YELLOW = { r: 255, g: 220, b: 0 };

describe('quantise', () => {
  it('recovers exactly the four colours in a four-colour image', () => {
    const pixels = [RED, GREEN, BLUE, YELLOW].flatMap((c) =>
      Array.from({ length: 25 }, () => c),
    );
    const tree = quantise(makeInput(pixels, 10));
    const palette = deriveAtCount(tree, 4);

    expect(palette).toHaveLength(4);
    expect(new Set(palette.map((n) => rgbToHex(n.rgb)))).toEqual(
      new Set([RED, GREEN, BLUE, YELLOW].map(rgbToHex)),
    );
  });

  it('stops early rather than inventing colours that are not there', () => {
    const pixels = [RED, GREEN, BLUE, YELLOW].flatMap((c) =>
      Array.from({ length: 25 }, () => c),
    );
    const tree = quantise(makeInput(pixels, 10));

    expect(maxAvailable(tree)).toBe(4);
    // Asking for 64 from a 4-colour image still gives 4.
    expect(deriveAtCount(tree, 64)).toHaveLength(4);
  });

  it('handles a single flat colour', () => {
    const pixels = Array.from({ length: 100 }, () => RED);
    const tree = quantise(makeInput(pixels, 10));

    expect(deriveAtCount(tree, 20)).toHaveLength(1);
    expect(rgbToHex(deriveAtCount(tree, 20)[0].rgb)).toBe(rgbToHex(RED));
  });

  it('handles a single pixel', () => {
    const tree = quantise(makeInput([RED], 1));
    expect(deriveAtCount(tree, 20)).toHaveLength(1);
  });

  it('handles an empty image without throwing', () => {
    const tree = quantise(makeInput([], 1));
    expect(deriveAtCount(tree, 20)).toEqual([]);
  });

  it('does not spend slots on colours nobody could tell apart', () => {
    // A large, *nearly* flat region (think a smooth sky with a little sensor
    // noise) plus three small distinct accents. Ranking splits by total squared
    // error alone would keep halving the big region — it has the most pixels —
    // and return a palette of near-identical blues while dropping the accents.
    let seed = 7;
    const jitter = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed / 0x7fffffff) * 2 - 1;
    };

    const pixels: Rgb[] = [];
    for (let i = 0; i < 3000; i++) {
      pixels.push({
        r: Math.round(74 + jitter()),
        g: Math.round(144 + jitter()),
        b: Math.round(217 + jitter()),
      });
    }
    for (const accent of [RED, GREEN, YELLOW]) {
      for (let i = 0; i < 40; i++) pixels.push(accent);
    }

    const palette = deriveAtCount(quantise(makeInput(pixels, 100)), 20);
    const hexes = palette.map((n) => rgbToHex(n.rgb));

    expect(new Set(hexes).size).toBe(hexes.length);
    // The accents must survive rather than being crowded out by the big region.
    for (const accent of [RED, GREEN, YELLOW]) {
      expect(hexes).toContain(rgbToHex(accent));
    }
  });

  it('is deterministic — the same input twice gives identical output', () => {
    const pixels = syntheticImage(2000);
    const a = quantise(makeInput(pixels, 50));
    const b = quantise(makeInput(pixels, 50));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('accounts for every pixel exactly once across the palette', () => {
    const pixels = syntheticImage(2000);
    const tree = quantise(makeInput(pixels, 50));

    for (const n of [2, 7, 20, 64]) {
      const total = deriveAtCount(tree, n).reduce((sum, x) => sum + x.count, 0);
      expect(total).toBe(2000);
    }
  });
});

describe('deriveAtCount', () => {
  const pixels = syntheticImage(4000);
  const tree = quantise(makeInput(pixels, 80));

  it('returns the requested number of colours', () => {
    for (const n of [2, 5, 20, 33, 64]) {
      expect(deriveAtCount(tree, n)).toHaveLength(n);
    }
  });

  it('is stable — n and n+1 differ by exactly one split', () => {
    // This is what makes the slider feel like a dial rather than a dice roll:
    // nudging it must not reshuffle the colours the user was already looking at.
    for (let n = 2; n < 64; n++) {
      const before = deriveAtCount(tree, n).map((x) => x.id);
      const after = deriveAtCount(tree, n + 1).map((x) => x.id);

      const dropped = before.filter((id) => !after.includes(id));
      const added = after.filter((id) => !before.includes(id));

      expect(dropped).toHaveLength(1);
      expect(added).toHaveLength(2);

      // And the survivors keep their relative order, so swatches don't jump slots.
      const survivors = before.filter((id) => after.includes(id));
      expect(after.filter((id) => survivors.includes(id))).toEqual(survivors);
    }
  });

  it('keeps 19 of 20 colours identical when going 20 -> 21', () => {
    const at20 = deriveAtCount(tree, 20);
    const at21 = deriveAtCount(tree, 21);
    const shared = at20.filter((x) => at21.some((y) => y.id === x.id));
    expect(shared).toHaveLength(19);
  });

  it('clamps counts below the minimum to a single colour', () => {
    expect(deriveAtCount(tree, 1)).toHaveLength(1);
    expect(deriveAtCount(tree, 0)).toHaveLength(1);
  });

  it('gives every colour a marker position inside the image', () => {
    for (const node of deriveAtCount(tree, 20)) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(1);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThanOrEqual(1);
    }
  });
});
