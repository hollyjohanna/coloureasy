import { describe, expect, it } from 'vitest';
import {
  formatAll,
  hexToRgb,
  oklabToRgb,
  readableTextOn,
  rgbToCmyk,
  rgbToHex,
  rgbToHsl,
  rgbToHsv,
  rgbToOklab,
} from './colour';

const SAMPLES = [
  { name: 'black', rgb: { r: 0, g: 0, b: 0 }, hex: '#000000' },
  { name: 'white', rgb: { r: 255, g: 255, b: 255 }, hex: '#ffffff' },
  { name: 'red', rgb: { r: 255, g: 0, b: 0 }, hex: '#ff0000' },
  { name: 'green', rgb: { r: 0, g: 255, b: 0 }, hex: '#00ff00' },
  { name: 'blue', rgb: { r: 0, g: 0, b: 255 }, hex: '#0000ff' },
  { name: 'mid grey', rgb: { r: 128, g: 128, b: 128 }, hex: '#808080' },
  { name: 'burgundy', rgb: { r: 106, g: 27, b: 45 }, hex: '#6a1b2d' },
  { name: 'cream', rgb: { r: 245, g: 240, b: 225 }, hex: '#f5f0e1' },
];

describe('hex', () => {
  for (const { name, rgb, hex } of SAMPLES) {
    it(`round-trips ${name}`, () => {
      expect(rgbToHex(rgb)).toBe(hex);
      expect(hexToRgb(hex)).toEqual(rgb);
    });
  }

  it('expands 3-digit shorthand', () => {
    expect(hexToRgb('#f0a')).toEqual({ r: 255, g: 0, b: 170 });
  });

  it('tolerates a missing hash and stray whitespace', () => {
    expect(hexToRgb('  6A1B2D ')).toEqual({ r: 106, g: 27, b: 45 });
  });

  it('rejects nonsense', () => {
    expect(hexToRgb('#12345')).toBeNull();
    expect(hexToRgb('nope')).toBeNull();
    expect(hexToRgb('')).toBeNull();
  });

  it('clamps out-of-range channels rather than emitting bad hex', () => {
    expect(rgbToHex({ r: 300, g: -20, b: 128 })).toBe('#ff0080');
  });
});

describe('OKLab', () => {
  for (const { name, rgb } of SAMPLES) {
    it(`round-trips ${name} losslessly`, () => {
      expect(oklabToRgb(rgbToOklab(rgb))).toEqual(rgb);
    });
  }

  it('round-trips the whole grey ramp losslessly', () => {
    for (let v = 0; v <= 255; v++) {
      const rgb = { r: v, g: v, b: v };
      expect(oklabToRgb(rgbToOklab(rgb))).toEqual(rgb);
    }
  });

  it('puts black at L=0 and white at L=1', () => {
    expect(rgbToOklab({ r: 0, g: 0, b: 0 }).L).toBeCloseTo(0, 5);
    expect(rgbToOklab({ r: 255, g: 255, b: 255 }).L).toBeCloseTo(1, 5);
  });

  it('gives neutrals near-zero chroma', () => {
    const grey = rgbToOklab({ r: 128, g: 128, b: 128 });
    expect(Math.abs(grey.a)).toBeLessThan(1e-6);
    expect(Math.abs(grey.b)).toBeLessThan(1e-6);
  });
});

describe('HSL / HSV / CMYK', () => {
  it('reads pure red correctly in every space', () => {
    const red = { r: 255, g: 0, b: 0 };
    expect(rgbToHsl(red)).toEqual({ h: 0, s: 100, l: 50 });
    expect(rgbToHsv(red)).toEqual({ h: 0, s: 100, v: 100 });
    expect(rgbToCmyk(red)).toEqual({ c: 0, m: 100, y: 100, k: 0 });
  });

  it('reads the primaries at the right hue angles', () => {
    expect(rgbToHsl({ r: 0, g: 255, b: 0 }).h).toBe(120);
    expect(rgbToHsl({ r: 0, g: 0, b: 255 }).h).toBe(240);
    expect(rgbToHsl({ r: 255, g: 255, b: 0 }).h).toBe(60);
  });

  it('treats neutrals as unsaturated with hue 0', () => {
    for (const v of [0, 128, 255]) {
      expect(rgbToHsl({ r: v, g: v, b: v }).s).toBe(0);
      expect(rgbToHsv({ r: v, g: v, b: v }).s).toBe(0);
      expect(rgbToHsl({ r: v, g: v, b: v }).h).toBe(0);
    }
  });

  it('handles the CMYK black special case without dividing by zero', () => {
    expect(rgbToCmyk({ r: 0, g: 0, b: 0 })).toEqual({ c: 0, m: 0, y: 0, k: 100 });
  });

  it('gives white zero ink', () => {
    expect(rgbToCmyk({ r: 255, g: 255, b: 255 })).toEqual({
      c: 0,
      m: 0,
      y: 0,
      k: 0,
    });
  });
});

describe('formatAll', () => {
  it('emits every format as a paste-ready string', () => {
    expect(formatAll({ r: 106, g: 27, b: 45 })).toEqual({
      hex: '#6A1B2D',
      rgb: 'rgb(106, 27, 45)',
      hsl: 'hsl(346, 59%, 26%)',
      hsv: 'hsv(346, 75%, 42%)',
      cmyk: 'cmyk(0%, 75%, 58%, 58%)',
    });
  });
});

describe('readableTextOn', () => {
  it('picks black on light and white on dark', () => {
    expect(readableTextOn({ r: 255, g: 255, b: 255 })).toBe('#000000');
    expect(readableTextOn({ r: 245, g: 240, b: 225 })).toBe('#000000');
    expect(readableTextOn({ r: 0, g: 0, b: 0 })).toBe('#ffffff');
    expect(readableTextOn({ r: 106, g: 27, b: 45 })).toBe('#ffffff');
  });
});
