import { describe, expect, it } from 'vitest';
import { rgbToOklab, type Rgb } from './colour';
import { toGreyscale, valueOf, valuePalette } from './valueStudy';

function rgbaOf(pixels: Rgb[]): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach((c, i) => {
    rgba[i * 4] = c.r;
    rgba[i * 4 + 1] = c.g;
    rgba[i * 4 + 2] = c.b;
    rgba[i * 4 + 3] = 255;
  });
  return rgba;
}

const repeat = (colour: Rgb, n: number) => Array.from({ length: n }, () => colour);

describe('toGreyscale', () => {
  it('produces neutrals — all three channels equal', () => {
    const grey = toGreyscale(
      rgbaOf([
        { r: 255, g: 0, b: 0 },
        { r: 0, g: 128, b: 255 },
        { r: 30, g: 200, b: 90 },
      ]),
    );

    for (let p = 0; p < grey.length; p += 4) {
      expect(grey[p]).toBe(grey[p + 1]);
      expect(grey[p + 1]).toBe(grey[p + 2]);
    }
  });

  it('keeps black black and white white', () => {
    const grey = toGreyscale(
      rgbaOf([
        { r: 0, g: 0, b: 0 },
        { r: 255, g: 255, b: 255 },
      ]),
    );
    expect(grey[0]).toBe(0);
    expect(grey[4]).toBe(255);
  });

  it('gives equally-light colours the same value, whatever their hue', () => {
    // The whole point of a value study: a saturated colour and a dull one of
    // the same tone must collapse together.
    const a: Rgb = { r: 255, g: 0, b: 0 };
    const target = rgbToOklab(a).L;

    // Build a neutral of the same lightness and check they land together.
    const grey = toGreyscale(rgbaOf([a]));
    expect(rgbToOklab({ r: grey[0], g: grey[1], b: grey[2] }).L).toBeCloseTo(
      target,
      2,
    );
  });

  it('preserves alpha', () => {
    const rgba = rgbaOf([{ r: 255, g: 0, b: 0 }]);
    rgba[3] = 40;
    expect(toGreyscale(rgba)[3]).toBe(40);
  });
});

describe('valuePalette', () => {
  const BLACK = { r: 0, g: 0, b: 0 };
  const MID = { r: 128, g: 128, b: 128 };
  const WHITE = { r: 255, g: 255, b: 255 };

  it('returns the requested number of values', () => {
    const pixels = [
      ...repeat(BLACK, 100),
      ...repeat(MID, 100),
      ...repeat(WHITE, 100),
    ];
    for (const steps of [2, 3]) {
      expect(valuePalette(rgbaOf(pixels), steps)).toHaveLength(steps);
    }
  });

  it('returns neutral greys, not colours', () => {
    const pixels = [
      ...repeat({ r: 200, g: 30, b: 30 }, 100),
      ...repeat({ r: 20, g: 80, b: 160 }, 100),
    ];
    for (const value of valuePalette(rgbaOf(pixels), 2)) {
      expect(value.r).toBe(value.g);
      expect(value.g).toBe(value.b);
    }
  });

  it('orders values darkest first', () => {
    const pixels = [
      ...repeat(BLACK, 60),
      ...repeat(MID, 60),
      ...repeat(WHITE, 60),
    ];
    const values = valuePalette(rgbaOf(pixels), 3);
    expect(values.map((v) => v.r)).toEqual([...values.map((v) => v.r)].sort((a, b) => a - b));
  });

  it('keeps the darkest and lightest values, however rare they are', () => {
    // The failure this guards against: a subject against a large white
    // background. Clustering by population spends every step on the near-
    // whites and returns a darkest value of mid-grey, leaving the linework
    // and shadows nowhere to go.
    const pixels = [
      ...repeat(WHITE, 900),
      ...repeat({ r: 20, g: 20, b: 20 }, 50),
      ...repeat(MID, 50),
    ];
    const values = valuePalette(rgbaOf(pixels), 4);

    expect(values[0].r).toBeLessThan(60);
    expect(values[values.length - 1].r).toBeGreaterThan(220);
  });

  it('separates a three-tone image into its three tones', () => {
    const pixels = [
      ...repeat(BLACK, 100),
      ...repeat(MID, 100),
      ...repeat(WHITE, 100),
    ];
    const values = valuePalette(rgbaOf(pixels), 3).map((v) => v.r);

    expect(values[0]).toBeLessThan(40);
    // Steps are evenly spaced in OKLab, whose lightness is roughly the cube
    // root of luminance — so the perceptual midpoint lands nearer sRGB 99 than
    // the arithmetic 128. That's the correct middle value to paint.
    expect(values[1]).toBeGreaterThan(70);
    expect(values[1]).toBeLessThan(160);
    expect(values[2]).toBeGreaterThan(220);
  });

  it('measures the range off the image, not a fixed 0-100', () => {
    // A high-key image: everything is light. Spacing steps over an assumed
    // full range would hand back darks the image does not contain.
    const pixels = [
      ...repeat({ r: 230, g: 230, b: 230 }, 100),
      ...repeat({ r: 245, g: 245, b: 245 }, 100),
      ...repeat({ r: 255, g: 255, b: 255 }, 100),
    ];
    for (const value of valuePalette(rgbaOf(pixels), 3)) {
      expect(value.r).toBeGreaterThan(200);
    }
  });

  it('collapses hue but not tone', () => {
    // Red and blue of clearly different lightness must stay separate values.
    const pixels = [
      ...repeat({ r: 255, g: 40, b: 40 }, 100),
      ...repeat({ r: 10, g: 10, b: 90 }, 100),
    ];
    const values = valuePalette(rgbaOf(pixels), 2);
    expect(values).toHaveLength(2);
    expect(values[1].r - values[0].r).toBeGreaterThan(40);
  });

  it('copes with a flat image', () => {
    const values = valuePalette(rgbaOf(repeat(MID, 100)), 4);
    expect(values).toHaveLength(1);
  });

  it('copes with an empty image', () => {
    expect(valuePalette(new Uint8ClampedArray(0), 4)).toEqual([]);
  });

  it('ignores transparent pixels', () => {
    const rgba = rgbaOf([...repeat(BLACK, 50), ...repeat(WHITE, 50)]);
    for (let i = 50; i < 100; i++) rgba[i * 4 + 3] = 0;
    // Only the black half counts, so there is just one value to find.
    expect(valuePalette(rgba, 4)).toHaveLength(1);
  });
});

describe('valueOf', () => {
  it('reads 0 for black and 100 for white', () => {
    expect(valueOf({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(valueOf({ r: 255, g: 255, b: 255 })).toBe(100);
  });

  it('increases with lightness', () => {
    const steps = [0, 64, 128, 192, 255].map((v) => valueOf({ r: v, g: v, b: v }));
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
  });
});
