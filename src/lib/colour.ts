/**
 * Colour space conversions. Pure functions, no dependencies.
 *
 * sRGB channels are 0-255 integers everywhere in this file; the 0-1 linear-light
 * form only exists inside the OKLab conversions.
 */

export type Rgb = { r: number; g: number; b: number };
export type Oklab = { L: number; a: number; b: number };
export type Hsl = { h: number; s: number; l: number };
export type Hsv = { h: number; s: number; v: number };
export type Cmyk = { c: number; m: number; y: number; k: number };

// The `+ 0` normalises -0 to 0. Math.round(-1e-9) is -0, which would otherwise
// travel all the way out into an exported JSON palette as `-0`.
const clamp = (n: number, min: number, max: number) =>
  (n < min ? min : n > max ? max : n) + 0;

const round = (n: number, dp = 0) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f + 0;
};

/* ------------------------------------------------------------------ hex */

export function rgbToHex({ r, g, b }: Rgb): string {
  const h = (n: number) =>
    clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function hexToRgb(hex: string): Rgb | null {
  let s = hex.trim().replace(/^#/, '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

/* ---------------------------------------------------------------- OKLab */

// sRGB transfer function, 0-1 in both directions.
const srgbToLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

const linearToSrgb = (c: number) =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;

/**
 * Björn Ottosson's OKLab. Perceptually uniform enough that euclidean distance
 * in it roughly matches "how different do these look", which is exactly what
 * the quantiser needs when it decides where to split a bucket.
 */
export function rgbToOklab({ r, g, b }: Rgb): Oklab {
  const lr = srgbToLinear(r / 255);
  const lg = srgbToLinear(g / 255);
  const lb = srgbToLinear(b / 255);

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

export function oklabToRgb({ L, a, b }: Oklab): Rgb {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return {
    r: clamp(Math.round(linearToSrgb(lr) * 255), 0, 255),
    g: clamp(Math.round(linearToSrgb(lg) * 255), 0, 255),
    b: clamp(Math.round(linearToSrgb(lb) * 255), 0, 255),
  };
}

export type Oklch = { L: number; C: number; h: number };

/**
 * OKLab in polar form: chroma is how far from grey, hue an angle in degrees
 * (0-360). Hue is meaningless for near-greys — check C before trusting it.
 */
export function oklabToOklch({ L, a, b }: Oklab): Oklch {
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return { L, C: Math.sqrt(a * a + b * b), h: h < 0 ? h + 360 : h };
}

/** Shortest way round the colour wheel between two hues, 0-180 degrees. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/* ------------------------------------------------------------ HSL / HSV */

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;

  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
        break;
      case gn:
        h = ((bn - rn) / d + 2) * 60;
        break;
      default:
        h = ((rn - gn) / d + 4) * 60;
    }
  }

  return { h: round(h), s: round(s * 100), l: round(l * 100) };
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    switch (max) {
      case rn:
        h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
        break;
      case gn:
        h = ((bn - rn) / d + 2) * 60;
        break;
      default:
        h = ((rn - gn) / d + 4) * 60;
    }
  }

  return {
    h: round(h),
    s: round((max === 0 ? 0 : d / max) * 100),
    v: round(max * 100),
  };
}

/**
 * Naive device CMYK — no ICC profile, same as the default readout in Figma and
 * Photoshop's sRGB mode. Fine for screen work; not a substitute for a real
 * print conversion.
 */
export function rgbToCmyk({ r, g, b }: Rgb): Cmyk {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const k = 1 - Math.max(rn, gn, bn);

  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };

  return {
    c: round(((1 - rn - k) / (1 - k)) * 100),
    m: round(((1 - gn - k) / (1 - k)) * 100),
    y: round(((1 - bn - k) / (1 - k)) * 100),
    k: round(k * 100),
  };
}

/* ------------------------------------------------------- formatted text */

export type ColourFormats = {
  hex: string;
  rgb: string;
  hsl: string;
  hsv: string;
  cmyk: string;
};

export function formatAll(rgb: Rgb): ColourFormats {
  const hsl = rgbToHsl(rgb);
  const hsv = rgbToHsv(rgb);
  const cmyk = rgbToCmyk(rgb);
  return {
    hex: rgbToHex(rgb).toUpperCase(),
    rgb: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
    hsl: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`,
    hsv: `hsv(${hsv.h}, ${hsv.s}%, ${hsv.v}%)`,
    cmyk: `cmyk(${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%)`,
  };
}

/* -------------------------------------------------------------- utility */

/**
 * WCAG relative luminance, used to decide whether label text on a swatch
 * should be black or white.
 */
export function luminance({ r, g, b }: Rgb): number {
  const lr = srgbToLinear(r / 255);
  const lg = srgbToLinear(g / 255);
  const lb = srgbToLinear(b / 255);
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

export const readableTextOn = (rgb: Rgb): '#000000' | '#ffffff' =>
  luminance(rgb) > 0.4 ? '#000000' : '#ffffff';
