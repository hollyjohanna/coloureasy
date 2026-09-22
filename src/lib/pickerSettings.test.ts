import { describe, expect, it } from 'vitest';
import {
  filterKey,
  isNeutral,
  MOODS,
  NEUTRAL_SETTINGS,
  parsePresets,
  parseSettings,
  sameSettings,
  toPixelFilter,
} from './pickerSettings';

describe('parseSettings', () => {
  it('falls back to neutral for anything that is not settings', () => {
    expect(parseSettings(null)).toEqual(NEUTRAL_SETTINGS);
    expect(parseSettings('dark')).toEqual(NEUTRAL_SETTINGS);
    expect(parseSettings(42)).toEqual(NEUTRAL_SETTINGS);
  });

  it('round-trips real settings through JSON', () => {
    for (const { settings } of MOODS) {
      expect(parseSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings);
    }
  });

  it('clamps out-of-range numbers', () => {
    const s = parseSettings({ contrast: 500, vibrancy: -900, minShare: 7, focusWidth: 1 });
    expect(s.contrast).toBe(100);
    expect(s.vibrancy).toBe(-100);
    expect(s.minShare).toBe(0.5);
    expect(s.focusWidth).toBe(5);
  });

  it('rejects a backwards or malformed range, one field at a time', () => {
    const s = parseSettings({ lightness: [80, 20], chroma: [10, 60], contrast: 30 });
    expect(s.lightness).toEqual(NEUTRAL_SETTINGS.lightness);
    expect(s.chroma).toEqual([10, 60]);
    expect(s.contrast).toBe(30);
  });

  it('ignores unknown harmonies and sorts', () => {
    const s = parseSettings({ harmony: 'tetradic', sort: 'random' });
    expect(s.harmony).toBe('none');
    expect(s.sort).toBe('natural');
  });

  it('wraps the focus hue onto the wheel', () => {
    expect(parseSettings({ focusHue: 400 }).focusHue).toBe(40);
    expect(parseSettings({ focusHue: -30 }).focusHue).toBe(330);
    expect(parseSettings({ focusHue: 'blue' }).focusHue).toBeNull();
  });
});

describe('parsePresets', () => {
  it('keeps good presets and drops broken ones', () => {
    const presets = parsePresets([
      { id: 'a', name: 'Moody', settings: { lightness: [0, 40] } },
      { id: 'b', name: '   ' },
      { name: 'No id' },
      'nonsense',
    ]);
    expect(presets).toHaveLength(1);
    expect(presets[0].name).toBe('Moody');
    expect(presets[0].settings.lightness).toEqual([0, 40]);
  });

  it('copes with storage holding something else entirely', () => {
    expect(parsePresets({ not: 'an array' })).toEqual([]);
  });
});

describe('isNeutral', () => {
  it('treats the None mood as neutral', () => {
    expect(isNeutral(MOODS.find((m) => m.id === 'none')!.settings)).toBe(true);
  });

  it('ignores sort order, which only changes the display', () => {
    expect(isNeutral({ ...NEUTRAL_SETTINGS, sort: 'hue' })).toBe(true);
  });

  it('notices any change that affects which colours are chosen', () => {
    expect(isNeutral({ ...NEUTRAL_SETTINGS, contrast: 5 })).toBe(false);
    expect(isNeutral({ ...NEUTRAL_SETTINGS, lightness: [0, 95] })).toBe(false);
    expect(isNeutral({ ...NEUTRAL_SETTINGS, focusHue: 0 })).toBe(false);
  });

  it('ignores the family width while there is no family', () => {
    expect(sameSettings({ ...NEUTRAL_SETTINGS, focusWidth: 60 }, NEUTRAL_SETTINGS)).toBe(true);
  });
});

describe('filterKey', () => {
  it('changes with filters but not with shaping', () => {
    const base = filterKey(NEUTRAL_SETTINGS);
    expect(filterKey({ ...NEUTRAL_SETTINGS, contrast: 80, harmony: 'triadic' })).toBe(base);
    expect(filterKey({ ...NEUTRAL_SETTINGS, lightness: [0, 50] })).not.toBe(base);
    expect(filterKey({ ...NEUTRAL_SETTINGS, focusHue: 120 })).not.toBe(base);
  });
});

describe('toPixelFilter', () => {
  it('leaves the top of the saturation range open', () => {
    expect(toPixelFilter(NEUTRAL_SETTINGS).cMax).toBe(Infinity);
    expect(toPixelFilter({ ...NEUTRAL_SETTINGS, chroma: [0, 50] }).cMax).toBeCloseTo(0.125);
  });
});
