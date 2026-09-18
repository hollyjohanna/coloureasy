/**
 * Palette <-> URL hash.
 *
 * Three raw bytes per colour, base64url'd into the location hash. 64 colours
 * comes to ~256 characters, comfortably inside every browser's URL limit — and
 * it means sharing needs no storage of any kind.
 *
 * The link carries the *palette*, not the image. Whoever opens it sees the
 * colours, not the picture they came from.
 */

import type { Rgb } from './colour';

const PARAM = 'p';

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

function fromBase64Url(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export function encodePalette(colours: Rgb[]): string {
  const bytes = new Uint8Array(colours.length * 3);
  colours.forEach(({ r, g, b }, i) => {
    bytes[i * 3] = r;
    bytes[i * 3 + 1] = g;
    bytes[i * 3 + 2] = b;
  });
  return toBase64Url(bytes);
}

export function decodePalette(encoded: string): Rgb[] {
  const bytes = fromBase64Url(encoded);
  if (!bytes || bytes.length === 0 || bytes.length % 3 !== 0) return [];

  const colours: Rgb[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    colours.push({ r: bytes[i], g: bytes[i + 1], b: bytes[i + 2] });
  }
  return colours;
}

export function shareUrlFor(colours: Rgb[]): string {
  const url = new URL(window.location.href);
  url.hash = `${PARAM}=${encodePalette(colours)}`;
  return url.toString();
}

/** Read a shared palette out of the current URL, if there is one. */
export function paletteFromLocation(): Rgb[] {
  const hash = window.location.hash.replace(/^#/, '');
  const params = new URLSearchParams(hash);
  const encoded = params.get(PARAM);
  return encoded ? decodePalette(encoded) : [];
}
