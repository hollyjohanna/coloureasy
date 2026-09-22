/**
 * How the Colour Picker chooses its colours.
 *
 * Two kinds of setting, and the split matters for speed:
 *
 * - **Filters** decide which pixels are eligible at all. Changing one means
 *   re-quantising the surviving pixels in the worker, so "only darks" at forty
 *   colours gives forty distinct darks rather than the three darks the
 *   whole-image palette happened to contain.
 * - **Shaping** decides which of the eligible colours win. That runs on the
 *   main thread against the worker's result and is instant — see `select.ts`.
 *
 * `NEUTRAL_SETTINGS` is the picker as it has always behaved: area decides.
 */

export type Harmony =
  | 'none'
  | 'complementary'
  | 'split'
  | 'analogous'
  | 'triadic'
  | 'mono';

export type SortOrder =
  | 'natural'
  | 'picked'
  | 'coverage'
  | 'lightness'
  | 'darkFirst'
  | 'hue';

export type PickerSettings = {
  version: 1;
  /* ---- filters ---- */
  /** OKLab lightness, 0-100, inclusive */
  lightness: [number, number];
  /** chroma as a percentage of CHROMA_FULL, 0-100 */
  chroma: [number, number];
  /** keep only this family of hues, in OKLCh degrees; null for every hue */
  focusHue: number | null;
  /** half-width of the focus, degrees either side */
  focusWidth: number;
  /* ---- shaping, each -100..100 with 0 as no preference ---- */
  /** colours smaller than this share of the image (percent) are ignored */
  minShare: number;
  /** negative keeps lightness close together, positive spreads it wide */
  contrast: number;
  /** negative keeps hues related, positive pushes them apart */
  hueVariety: number;
  /** negative prefers muted colours, positive vivid ones */
  vibrancy: number;
  /** negative favours colours that cover a lot of the image, positive rare accents */
  accents: number;
  harmony: Harmony;
  sort: SortOrder;
};

/**
 * OKLCh chroma treated as "fully saturated" on the slider. sRGB tops out
 * around 0.32 in blue, but photographs rarely pass 0.25, and a scale that puts
 * every real colour in the bottom two thirds is a scale nobody can use.
 */
export const CHROMA_FULL = 0.25;

/** Below this chroma a colour is grey to the eye, and its hue is noise. */
export const NEUTRAL_CHROMA = 0.03;

export const MAX_MIN_SHARE = 0.5;

export const NEUTRAL_SETTINGS: PickerSettings = {
  version: 1,
  lightness: [0, 100],
  chroma: [0, 100],
  focusHue: null,
  focusWidth: 30,
  minShare: 0,
  contrast: 0,
  hueVariety: 0,
  vibrancy: 0,
  accents: 0,
  harmony: 'none',
  sort: 'natural',
};

export type MoodId =
  | 'none'
  | 'balanced'
  | 'bright'
  | 'colourful'
  | 'muted'
  | 'light'
  | 'dark'
  | 'deep';

const mood = (over: Partial<PickerSettings>): PickerSettings => ({
  ...NEUTRAL_SETTINGS,
  ...over,
});

export const MOODS: { id: MoodId; label: string; settings: PickerSettings }[] = [
  { id: 'none', label: 'None', settings: NEUTRAL_SETTINGS },
  {
    // An even spread: some dark, some light, a mix of hues, and no single big
    // area allowed to hog the palette — without pushing to any extreme.
    id: 'balanced',
    label: 'Balanced',
    settings: mood({ contrast: 40, hueVariety: 40, accents: 20, minShare: 0.05 }),
  },
  {
    id: 'bright',
    label: 'Bright',
    settings: mood({ lightness: [60, 100], chroma: [25, 100], vibrancy: 60 }),
  },
  {
    id: 'colourful',
    label: 'Colourful',
    settings: mood({ chroma: [20, 100], hueVariety: 80, vibrancy: 50 }),
  },
  {
    id: 'muted',
    label: 'Muted',
    settings: mood({ chroma: [0, 40], contrast: -40, vibrancy: -40 }),
  },
  {
    id: 'light',
    label: 'Light',
    settings: mood({ lightness: [70, 100], vibrancy: -20 }),
  },
  { id: 'dark', label: 'Dark', settings: mood({ lightness: [0, 40] }) },
  {
    id: 'deep',
    label: 'Deep',
    settings: mood({ lightness: [15, 55], chroma: [20, 100], vibrancy: 60 }),
  },
];

export const HARMONIES: { id: Harmony; label: string; offsets: number[] }[] = [
  { id: 'none', label: 'None', offsets: [] },
  { id: 'complementary', label: 'Complementary', offsets: [0, 180] },
  { id: 'split', label: 'Split complementary', offsets: [0, 150, 210] },
  { id: 'analogous', label: 'Analogous', offsets: [-30, 0, 30] },
  { id: 'triadic', label: 'Triadic', offsets: [0, 120, 240] },
  { id: 'mono', label: 'Monochromatic', offsets: [0] },
];

export const SORT_ORDERS: { id: SortOrder; label: string }[] = [
  // The order the picker chose them in: with a mood set, the best fit first.
  { id: 'natural', label: 'Best first' },
  // Hand-picked, then locked, then the rest in the picker's order.
  { id: 'picked', label: 'Your picks first' },
  { id: 'coverage', label: 'Largest area first' },
  { id: 'lightness', label: 'Light to dark' },
  { id: 'darkFirst', label: 'Dark to light' },
  { id: 'hue', label: 'Hue' },
];

/** Settings that pick exactly what the unshaped picker would. Sort is display only. */
export function isNeutral(s: PickerSettings): boolean {
  return sameSettings(s, NEUTRAL_SETTINGS);
}

/** Equal in everything that changes which colours are chosen — sort aside. */
export function sameSettings(a: PickerSettings, b: PickerSettings): boolean {
  return (
    a.lightness[0] === b.lightness[0] &&
    a.lightness[1] === b.lightness[1] &&
    a.chroma[0] === b.chroma[0] &&
    a.chroma[1] === b.chroma[1] &&
    a.focusHue === b.focusHue &&
    // the width means nothing without a focus to be the width of
    (a.focusHue === null || a.focusWidth === b.focusWidth) &&
    a.minShare === b.minShare &&
    a.contrast === b.contrast &&
    a.hueVariety === b.hueVariety &&
    a.vibrancy === b.vibrancy &&
    a.accents === b.accents &&
    a.harmony === b.harmony
  );
}

/** What the worker needs to decide whether a pixel is eligible, in OKLCh units. */
export type PixelFilter = {
  lMin: number;
  lMax: number;
  cMin: number;
  /** Infinity when the slider is at the top, so nothing vivid is cut off */
  cMax: number;
  hue: number | null;
  hueWidth: number;
};

export function toPixelFilter(s: PickerSettings): PixelFilter {
  return {
    lMin: s.lightness[0] / 100,
    lMax: s.lightness[1] / 100,
    cMin: (s.chroma[0] / 100) * CHROMA_FULL,
    cMax: s.chroma[1] >= 100 ? Infinity : (s.chroma[1] / 100) * CHROMA_FULL,
    hue: s.focusHue,
    hueWidth: s.focusWidth,
  };
}

/** Changes only when the eligible pixels do — the cue to re-quantise. */
export const filterKey = (s: PickerSettings) =>
  [s.lightness, s.chroma, s.focusHue, s.focusHue === null ? '' : s.focusWidth].join('|');

/* ------------------------------------------------------------- parsing */

const num = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

const pair = (v: unknown, fallback: [number, number]): [number, number] => {
  if (!Array.isArray(v) || v.length !== 2) return fallback;
  const lo = num(v[0], fallback[0], 0, 100);
  const hi = num(v[1], fallback[1], 0, 100);
  return lo <= hi ? [lo, hi] : fallback;
};

const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  options.includes(v as T) ? (v as T) : fallback;

/**
 * Read settings back from storage, trusting nothing. Anything missing, out of
 * range or from a future version falls back to neutral, field by field, so one
 * bad value never costs someone their whole saved setup.
 */
export function parseSettings(raw: unknown): PickerSettings {
  if (!raw || typeof raw !== 'object') return NEUTRAL_SETTINGS;
  const r = raw as Record<string, unknown>;
  const n = NEUTRAL_SETTINGS;
  return {
    version: 1,
    lightness: pair(r.lightness, n.lightness),
    chroma: pair(r.chroma, n.chroma),
    focusHue:
      typeof r.focusHue === 'number' && Number.isFinite(r.focusHue)
        ? ((r.focusHue % 360) + 360) % 360
        : null,
    focusWidth: num(r.focusWidth, n.focusWidth, 5, 90),
    minShare: num(r.minShare, n.minShare, 0, MAX_MIN_SHARE),
    contrast: num(r.contrast, n.contrast, -100, 100),
    hueVariety: num(r.hueVariety, n.hueVariety, -100, 100),
    vibrancy: num(r.vibrancy, n.vibrancy, -100, 100),
    accents: num(r.accents, n.accents, -100, 100),
    harmony: oneOf(r.harmony, HARMONIES.map((h) => h.id), n.harmony),
    sort: oneOf(r.sort, SORT_ORDERS.map((o) => o.id), n.sort),
  };
}

export type Preset = { id: string; name: string; settings: PickerSettings };

export function parsePresets(raw: unknown): Preset[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p) => {
    if (!p || typeof p !== 'object') return [];
    const { id, name, settings } = p as Record<string, unknown>;
    if (typeof id !== 'string' || typeof name !== 'string' || !name.trim()) return [];
    return [{ id, name: name.trim().slice(0, 40), settings: parseSettings(settings) }];
  });
}

/* ------------------------------------------------------------- storage */

const DEFAULT_KEY = 'coloureasy:picker-default';
const PRESETS_KEY = 'coloureasy:picker-presets';

// Private browsing can refuse storage outright; the settings still work for
// the session, they just won't be there next time.
function read(key: string): unknown {
  try {
    const text = localStorage.getItem(key);
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* see read() */
  }
}

export const loadDefault = (): PickerSettings => parseSettings(read(DEFAULT_KEY));
export const saveDefault = (s: PickerSettings) => write(DEFAULT_KEY, s);
export const loadPresets = (): Preset[] => parsePresets(read(PRESETS_KEY));
export const savePresets = (presets: Preset[]) => write(PRESETS_KEY, presets);
