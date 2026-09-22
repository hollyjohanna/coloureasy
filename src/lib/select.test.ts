import { describe, expect, it } from 'vitest';
import { hueDistance, oklabToOklch, oklabToRgb, rgbToOklab, type Rgb } from './colour';
import {
  NEUTRAL_CHROMA,
  NEUTRAL_SETTINGS,
  toPixelFilter,
  type PickerSettings,
} from './pickerSettings';
import { quantise, type PaletteNode, type QuantiseInput } from './quantise';
import { filterPixels, POOL_SIZE, selectColours, sortBy } from './select';

/** A one-row "image" made of flat blocks of colour, `n` pixels each. */
function image(blocks: { rgb: Rgb; n: number }[]): QuantiseInput {
  const total = blocks.reduce((sum, b) => sum + b.n, 0);
  const lab = new Float32Array(total * 3);
  const srcIndex = new Uint32Array(total);
  let i = 0;
  for (const { rgb, n } of blocks) {
    const { L, a, b } = rgbToOklab(rgb);
    for (let k = 0; k < n; k++, i++) {
      lab[i * 3] = L;
      lab[i * 3 + 1] = a;
      lab[i * 3 + 2] = b;
      srcIndex[i] = i;
    }
  }
  return { lab, srcIndex, width: total, height: 1 };
}

const lch = (L: number, C: number, h: number): Rgb => {
  const rad = (h * Math.PI) / 180;
  return oklabToRgb({ L, a: C * Math.cos(rad), b: C * Math.sin(rad) });
};

// Twelve hues at four lightnesses plus a run of greys. One mid orange covers
// the most, so it is the dominant hue the harmony anchors on.
const BLOCKS = [
  ...[0.3, 0.5, 0.7, 0.9].flatMap((L) =>
    Array.from({ length: 12 }, (_, i) => ({
      rgb: lch(L, 0.1, i * 30),
      n: i === 2 && L === 0.5 ? 800 : 60 + i * 5,
    })),
  ),
  ...[0.15, 0.4, 0.6, 0.85].map((L) => ({ rgb: lch(L, 0, 0), n: 80 })),
];
const INPUT = image(BLOCKS);
const TOTAL = INPUT.srcIndex.length;
const POOL = quantise(INPUT, POOL_SIZE);

const withSettings = (over: Partial<PickerSettings>) => ({ ...NEUTRAL_SETTINGS, ...over });
const colourOf = (node: PaletteNode) => oklabToOklch(rgbToOklab(node.rgb));
const spread = (values: number[]) => Math.max(...values) - Math.min(...values);

describe('filterPixels', () => {
  it('keeps only pixels inside the lightness range', () => {
    const f = toPixelFilter(withSettings({ lightness: [0, 40] }));
    const out = filterPixels(INPUT, f);
    expect(out.srcIndex.length).toBeGreaterThan(0);
    for (let i = 0; i < out.srcIndex.length; i++) {
      expect(out.lab[i * 3]).toBeLessThanOrEqual(0.4);
    }
  });

  it('keeps only the chosen hue family, and no greys', () => {
    const f = toPixelFilter(withSettings({ focusHue: 240, focusWidth: 20 }));
    const out = filterPixels(INPUT, f);
    expect(out.srcIndex.length).toBeGreaterThan(0);
    for (let i = 0; i < out.srcIndex.length; i++) {
      const { C, h } = oklabToOklch({
        L: out.lab[i * 3],
        a: out.lab[i * 3 + 1],
        b: out.lab[i * 3 + 2],
      });
      expect(C).toBeGreaterThanOrEqual(NEUTRAL_CHROMA);
      expect(hueDistance(h, 240)).toBeLessThanOrEqual(20);
    }
  });

  it('keeps pixels pointing back at their place in the image', () => {
    const f = toPixelFilter(withSettings({ lightness: [80, 100] }));
    const out = filterPixels(INPUT, f);
    for (let i = 0; i < out.srcIndex.length; i++) {
      const src = out.srcIndex[i];
      expect(out.lab[i * 3]).toBe(INPUT.lab[src * 3]);
    }
  });

  it('can leave nothing at all', () => {
    const f = toPixelFilter(withSettings({ chroma: [95, 100] }));
    expect(filterPixels(INPUT, f).srcIndex.length).toBe(0);
  });
});

describe('selectColours', () => {
  it('is a sequence: n colours are the first n of n + 1', () => {
    const settings = withSettings({ contrast: 60, hueVariety: 40 });
    const ten = selectColours(POOL, settings, TOTAL, 10).map((n) => n.id);
    const eleven = selectColours(POOL, settings, TOTAL, 11).map((n) => n.id);
    expect(eleven.slice(0, 10)).toEqual(ten);
  });

  it('never returns the same colour twice', () => {
    const ids = selectColours(POOL, withSettings({ hueVariety: 100 }), TOTAL, 30).map(
      (n) => n.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('spreads lightness wider at high contrast than at low', () => {
    const lightness = (contrast: number) =>
      selectColours(POOL, withSettings({ contrast }), TOTAL, 5).map((n) => colourOf(n).L);
    expect(spread(lightness(100))).toBeGreaterThan(spread(lightness(-100)));
  });

  it('keeps hues related at low variety and apart at high', () => {
    // Mean distance from the first pick, over the chromatic colours chosen.
    const hueSpread = (hueVariety: number) => {
      const picks = selectColours(POOL, withSettings({ hueVariety }), TOTAL, 6)
        .map(colourOf)
        .filter((c) => c.C >= NEUTRAL_CHROMA);
      const d = picks.slice(1).map((c) => hueDistance(c.h, picks[0].h));
      return d.reduce((s, x) => s + x, 0) / d.length;
    };
    expect(hueSpread(100)).toBeGreaterThan(hueSpread(-100));
  });

  it('prefers vivid colours when asked, and muted ones when asked', () => {
    const chroma = (vibrancy: number) => {
      const picks = selectColours(POOL, withSettings({ vibrancy }), TOTAL, 6);
      return picks.reduce((s, n) => s + colourOf(n).C, 0) / picks.length;
    };
    expect(chroma(100)).toBeGreaterThan(chroma(-100));
  });

  it('builds a complementary palette around the dominant hue', () => {
    // Ask for far more than fit the scheme: off-scheme hues must not fill in.
    const picks = selectColours(POOL, withSettings({ harmony: 'complementary' }), TOTAL, 60)
      .map(colourOf)
      .filter((c) => c.C >= NEUTRAL_CHROMA);
    expect(picks.length).toBeGreaterThan(0);
    const dominant = colourOf({ rgb: lch(0.5, 0.1, 60) } as PaletteNode).h;
    for (const c of picks) {
      const off = Math.min(hueDistance(c.h, dominant), hueDistance(c.h, dominant + 180));
      expect(off).toBeLessThanOrEqual(45);
    }
  });

  it('anchors harmony on the hue covering most area, even spread across a gradient', () => {
    // A blue sky in twenty slightly different shades outweighs one flat green
    // patch, though every single blue is smaller than the green.
    const sky = Array.from({ length: 20 }, (_, i) => ({ rgb: lch(0.5 + i * 0.02, 0.1, 250), n: 50 }));
    const scene = image([...sky, { rgb: lch(0.5, 0.1, 140), n: 300 }, { rgb: lch(0.7, 0.1, 70), n: 40 }]);
    const picks = selectColours(
      quantise(scene, POOL_SIZE),
      withSettings({ harmony: 'mono' }),
      scene.srcIndex.length,
      50,
    ).map(colourOf);
    expect(picks.length).toBeGreaterThan(0);
    for (const c of picks) expect(hueDistance(c.h, 250)).toBeLessThanOrEqual(45);
  });

  it('anchors harmony on the colour family when one is set', () => {
    const picks = selectColours(
      POOL,
      withSettings({ harmony: 'mono', focusHue: 210 }),
      TOTAL,
      3,
    ).map(colourOf);
    for (const c of picks) expect(hueDistance(c.h, 210)).toBeLessThanOrEqual(30);
  });

  it('ignores specks below the minimum share', () => {
    const speckled = image([
      { rgb: { r: 200, g: 40, b: 40 }, n: 1000 },
      { rgb: { r: 40, g: 40, b: 200 }, n: 1000 },
      { rgb: { r: 40, g: 200, b: 40 }, n: 2 },
    ]);
    const pool = quantise(speckled, POOL_SIZE);
    const total = speckled.srcIndex.length;
    const withSpecks = selectColours(pool, withSettings({ minShare: 0 }), total, 10);
    const without = selectColours(pool, withSettings({ minShare: 0.5 }), total, 10);
    expect(withSpecks).toHaveLength(3);
    expect(without).toHaveLength(2);
  });

  it('returns nothing from an empty pool', () => {
    const empty = quantise(image([]), POOL_SIZE);
    expect(selectColours(empty, withSettings({ contrast: 50 }), 0, 10)).toEqual([]);
  });
});

describe('sortBy', () => {
  const items = [
    { rgb: lch(0.3, 0.1, 240), share: 0.2 },
    { rgb: lch(0.9, 0, 0), share: 0.5 },
    { rgb: lch(0.6, 0.1, 30), share: 0.3 },
  ];

  it('leaves the natural order alone', () => {
    expect(sortBy(items, 'natural')).toBe(items);
  });

  it('sorts by coverage, largest first', () => {
    expect(sortBy(items, 'coverage').map((i) => i.share)).toEqual([0.5, 0.3, 0.2]);
  });

  it('sorts light to dark', () => {
    expect(sortBy(items, 'lightness')).toEqual([items[1], items[2], items[0]]);
  });

  it('sorts dark to light', () => {
    expect(sortBy(items, 'darkFirst')).toEqual([items[0], items[2], items[1]]);
  });

  it('leaves your-picks-first to the caller', () => {
    expect(sortBy(items, 'picked')).toBe(items);
  });

  it('sorts by hue with greys last', () => {
    expect(sortBy(items, 'hue')).toEqual([items[2], items[0], items[1]]);
  });
});
