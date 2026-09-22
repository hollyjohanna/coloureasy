type Props = {
  /** labels each handle for screen readers, e.g. "lightness" */
  label: string;
  value: [number, number];
  onChange: (value: [number, number]) => void;
  min?: number;
  max?: number;
  step?: number;
  /** the handles can't close tighter than this */
  gap?: number;
};

/** Thumb width in the global range styling; the fill has to inset by half of it. */
const THUMB = 16;

/**
 * Two range inputs laid over one track. Each keeps its own keyboard behaviour
 * and accessible name, which a hand-rolled pointer slider would have to
 * reinvent.
 */
export default function RangeSlider({
  label,
  value: [lo, hi],
  onChange,
  min = 0,
  max = 100,
  step = 1,
  gap = 5,
}: Props) {
  const pct = (v: number) => ((v - min) / (max - min)) * 100;
  // Thumbs travel THUMB px less than the track is wide, starting half a thumb in.
  const at = (v: number) => `calc(${pct(v)}% + ${THUMB / 2 - (pct(v) / 100) * THUMB}px)`;

  // When both handles are pushed to the top the upper one sits on the lower
  // and would be the only one grabbable — bring the lower one forward so the
  // range can be opened back up.
  const loOnTop = lo > (min + max) / 2 && hi - lo <= gap;

  return (
    <div className="dual-range relative h-4">
      <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-line" />
      <div
        className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted"
        style={{ left: at(lo), width: `calc(${at(hi)} - ${at(lo)})` }}
      />
      <input
        type="range"
        aria-label={`Minimum ${label}`}
        min={min}
        max={max}
        step={step}
        value={lo}
        onChange={(e) => onChange([Math.min(Number(e.target.value), hi - gap), hi])}
        style={{ zIndex: loOnTop ? 2 : 1 }}
      />
      <input
        type="range"
        aria-label={`Maximum ${label}`}
        min={min}
        max={max}
        step={step}
        value={hi}
        onChange={(e) => onChange([lo, Math.max(Number(e.target.value), lo + gap)])}
        style={{ zIndex: 1 }}
      />
    </div>
  );
}
