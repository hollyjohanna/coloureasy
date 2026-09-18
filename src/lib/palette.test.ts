import { describe, expect, it } from 'vitest';
import type { Rgb } from './colour';
import { findSameColour, type Swatch } from './palette';

const swatch = (id: string, rgb: Rgb, source: Swatch['source'] = 'extracted'): Swatch => ({
  id,
  rgb,
  x: 0.5,
  y: 0.5,
  source,
  share: 0,
});

const RED = { r: 255, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 255 };

describe('findSameColour', () => {
  const palette = [swatch('a', RED), swatch('b', BLUE, 'manual')];

  it('finds an exact match', () => {
    expect(findSameColour(palette, { ...RED })?.id).toBe('a');
  });

  it('matches regardless of where the swatch came from', () => {
    expect(findSameColour(palette, { ...BLUE })?.id).toBe('b');
  });

  it('returns nothing for a colour that is not there', () => {
    expect(findSameColour(palette, { r: 0, g: 255, b: 0 })).toBeUndefined();
  });

  it('treats a one-channel difference as a different colour', () => {
    // Only exact duplicates are blocked. Two nearly identical colours can be a
    // deliberate choice — a painter may well want both.
    expect(findSameColour(palette, { r: 254, g: 0, b: 0 })).toBeUndefined();
    expect(findSameColour(palette, { r: 255, g: 1, b: 0 })).toBeUndefined();
    expect(findSameColour(palette, { r: 255, g: 0, b: 1 })).toBeUndefined();
  });

  it('copes with an empty palette', () => {
    expect(findSameColour([], RED)).toBeUndefined();
  });

  it('returns the first match when the palette somehow holds two', () => {
    const doubled = [swatch('first', RED), swatch('second', RED)];
    expect(findSameColour(doubled, RED)?.id).toBe('first');
  });
});
