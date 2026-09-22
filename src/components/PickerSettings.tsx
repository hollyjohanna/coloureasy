import { useEffect, useState } from 'react';
import {
  HARMONIES,
  MAX_MIN_SHARE,
  MOODS,
  sameSettings,
  type Harmony,
  type MoodId,
  type PickerSettings as Settings,
  type Preset,
} from '../lib/pickerSettings';
import RangeSlider from './RangeSlider';

type Props = {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onMood: (id: MoodId) => void;
  presets: Preset[];
  onPreset: (id: string) => void;
  onDeletePreset: (id: string) => void;
  onSavePreset: (name: string) => void;
  savedDefault: Settings;
  onSaveDefault: () => void;
  onResetDefault: () => void;
  /** waiting for a click on the image to set the colour family */
  picking: boolean;
  onPicking: (picking: boolean) => void;
  /** the worker is still rebuilding for the latest filters */
  pooling: boolean;
  /** Fine-tune is showing — inline below lg, as a side column above */
  open: boolean;
  onOpen: (open: boolean) => void;
};

/**
 * Moods up front for a one-click change of character, with every underlying
 * control behind "Fine-tune" for anyone who wants to steer it precisely. On
 * wide screens Fine-tune opens as its own column (FineTunePanel) so the colour
 * list keeps its height.
 */
export default function PickerSettings({
  settings,
  onChange,
  onMood,
  presets,
  onPreset,
  onDeletePreset,
  onSavePreset,
  savedDefault,
  onSaveDefault,
  onResetDefault,
  picking,
  onPicking,
  pooling,
  open,
  onOpen,
}: Props) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onPicking(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picking, onPicking]);

  const activeMood = MOODS.find((m) => sameSettings(m.settings, settings))?.id;
  const activePreset = presets.find(
    (p) => sameSettings(p.settings, settings) && p.settings.sort === settings.sort,
  )?.id;
  const custom = !activeMood && !activePreset;
  const isDefault = sameSettings(settings, savedDefault) && settings.sort === savedDefault.sort;

  const submitPreset = () => {
    if (!name.trim()) return;
    onSavePreset(name);
    setName('');
    setNaming(false);
  };

  return (
    <div className="border-b border-line px-5 py-4">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">Mood</span>
        {pooling && <span className="text-xs text-faint">Updating…</span>}
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {MOODS.map((m) => (
          <Chip key={m.id} active={activeMood === m.id} onClick={() => onMood(m.id)}>
            {m.label}
          </Chip>
        ))}
        {presets.map((p) => (
          <span key={p.id} className="group relative inline-flex">
            <Chip active={activePreset === p.id} onClick={() => onPreset(p.id)}>
              {p.name}
            </Chip>
            <button
              type="button"
              onClick={() => onDeletePreset(p.id)}
              aria-label={`Delete preset ${p.name}`}
              title="Delete preset"
              className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full border border-line bg-surface text-[10px] leading-none text-muted hover:text-ink group-focus-within:flex group-hover:flex"
            >
              ×
            </button>
          </span>
        ))}
        {custom && <Chip active>Custom</Chip>}
      </div>

      <button
        type="button"
        onClick={() => onOpen(!open)}
        aria-expanded={open}
        className="mt-3 flex items-center gap-1.5 text-xs font-medium text-muted transition-colors hover:text-ink"
      >
        <span aria-hidden className={`inline-block transition-transform ${open ? 'rotate-90 lg:rotate-0' : 'lg:rotate-180'}`}>
          ▸
        </span>
        Fine-tune
      </button>

      {open && (
        <div className="mt-3 lg:hidden">
          <FineTune settings={settings} onChange={onChange} picking={picking} onPicking={onPicking} />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {naming ? (
          <form
            className="flex min-w-0 flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submitPreset();
            }}
          >
            <input
              autoFocus
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setNaming(false);
                }
              }}
              placeholder="Preset name"
              aria-label="Preset name"
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs outline-none focus:border-muted"
            />
            <SmallButton type="submit" disabled={!name.trim()}>
              Save
            </SmallButton>
            <SmallButton onClick={() => setNaming(false)}>Cancel</SmallButton>
          </form>
        ) : (
          <>
            <SmallButton
              onClick={onSaveDefault}
              disabled={isDefault}
              title="Every new image starts with these settings"
            >
              {isDefault ? 'Your default' : 'Save as default'}
            </SmallButton>
            <SmallButton onClick={() => setNaming(true)}>Save preset…</SmallButton>
            <SmallButton
              onClick={onResetDefault}
              disabled={isDefault}
              title="Go back to your saved default"
            >
              Reset
            </SmallButton>
          </>
        )}
      </div>
    </div>
  );
}

type FineTuneProps = {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  picking: boolean;
  onPicking: (picking: boolean) => void;
};

/** Every underlying control. Shown inline on narrow screens, in its own column on wide ones. */
export function FineTune({ settings, onChange, picking, onPicking }: FineTuneProps) {
  return (
    <div className="space-y-5">
      <Group title="Only include">
        <Field label="Lightness" value={range(settings.lightness)}>
          <RangeSlider
            label="lightness"
            value={settings.lightness}
            onChange={(lightness) => onChange({ lightness })}
          />
          <Ends left="Dark" right="Light" />
        </Field>

        <Field label="Saturation" value={range(settings.chroma)}>
          <RangeSlider
            label="saturation"
            value={settings.chroma}
            onChange={(chroma) => onChange({ chroma })}
          />
          <Ends left="Grey" right="Vivid" />
        </Field>

        <Field
          label="Colour family"
          value={settings.focusHue === null ? 'Any' : `${Math.round(settings.focusHue)}°`}
        >
          <div className="flex items-center gap-2">
            {settings.focusHue === null ? (
              <button
                type="button"
                onClick={() => onChange({ focusHue: 30 })}
                className="rounded-lg border border-line px-2.5 py-1 text-xs transition-colors hover:bg-raised"
              >
                Choose a hue
              </button>
            ) : (
              <>
                <span
                  aria-hidden
                  className="h-4 w-4 shrink-0 rounded-full border border-line"
                  style={{ background: `oklch(0.72 0.14 ${settings.focusHue})` }}
                />
                <input
                  type="range"
                  aria-label="Colour family hue"
                  min={0}
                  max={359}
                  value={Math.round(settings.focusHue)}
                  onChange={(e) => onChange({ focusHue: Number(e.target.value) })}
                  className="hue-range min-w-0 flex-1"
                />
              </>
            )}
            <button
              type="button"
              onClick={() => onPicking(!picking)}
              aria-pressed={picking}
              className={`rounded-lg border border-line px-2.5 py-1 text-xs transition-colors ${
                picking ? 'bg-ink text-shell' : 'hover:bg-raised'
              }`}
            >
              From image
            </button>
            {settings.focusHue !== null && (
              <button
                type="button"
                onClick={() => onChange({ focusHue: null })}
                className="text-xs text-muted hover:text-ink"
              >
                Clear
              </button>
            )}
          </div>
          {picking && (
            <p className="font-body mt-1.5 text-xs text-faint">
              Click a colour in the image. Esc to cancel.
            </p>
          )}
          {settings.focusHue !== null && (
            <div className="mt-2.5">
              <Slider
                label="Family width"
                display={`±${settings.focusWidth}°`}
                min={5}
                max={90}
                step={5}
                value={settings.focusWidth}
                onChange={(focusWidth) => onChange({ focusWidth })}
                reset={30}
                left="Narrow"
                right="Broad"
              />
            </div>
          )}
        </Field>

        <Slider
          label="Ignore specks"
          display={settings.minShare === 0 ? 'Off' : `< ${settings.minShare}%`}
          min={0}
          max={MAX_MIN_SHARE}
          step={0.05}
          value={settings.minShare}
          onChange={(minShare) => onChange({ minShare: Math.round(minShare * 100) / 100 })}
          reset={0}
          left="Keep all"
          right="Only areas"
        />
      </Group>

      <Group title="Choose colours that are">
        <Bipolar
          label="Contrast"
          value={settings.contrast}
          onChange={(contrast) => onChange({ contrast })}
          left="Close in tone"
          right="Light & dark"
        />
        <Bipolar
          label="Hue variety"
          value={settings.hueVariety}
          onChange={(hueVariety) => onChange({ hueVariety })}
          left="Related"
          right="Far apart"
        />
        <Bipolar
          label="Vibrancy"
          value={settings.vibrancy}
          onChange={(vibrancy) => onChange({ vibrancy })}
          left="Muted"
          right="Vivid"
        />
        <Bipolar
          label="Coverage"
          value={settings.accents}
          onChange={(accents) => onChange({ accents })}
          left="Dominant"
          right="Accents"
        />

        <Select
          label="Harmony"
          value={settings.harmony}
          options={HARMONIES}
          onChange={(harmony) => onChange({ harmony: harmony as Harmony })}
        />
        {settings.harmony !== 'none' && (
          <p className="font-body -mt-2 text-xs text-faint">
            Built around {settings.focusHue === null ? "the image's main hue" : 'the colour family'}.
          </p>
        )}
      </Group>

    </div>
  );
}

/** Fine-tune as a column of its own between the image and the colour list, from `lg` up. */
export function FineTunePanel({ onClose, ...props }: FineTuneProps & { onClose: () => void }) {
  return (
    <aside className="hidden shrink-0 flex-col border-l border-line bg-shell lg:flex lg:w-[300px]">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <span className="text-sm font-medium">Fine-tune</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close fine-tune"
          title="Close"
          className="rounded-md px-1.5 text-muted transition-colors hover:bg-raised hover:text-ink"
        >
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <FineTune {...props} />
      </div>
    </aside>
  );
}

const OPEN_KEY = 'coloureasy:picker-tune-open';

/** Whether Fine-tune is showing, remembered between visits as a convenience. */
export function useFineTuneOpen() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, open ? '1' : '0');
    } catch {
      /* just a convenience */
    }
  }, [open]);

  return [open, setOpen] as const;
}

const range = ([lo, hi]: [number, number]) =>
  lo === 0 && hi === 100 ? 'All' : `${lo}–${hi}`;

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const className = `rounded-full border px-2.5 py-1 text-xs transition-colors ${
    active ? 'border-ink bg-ink text-shell' : 'border-line text-muted hover:bg-raised hover:text-ink'
  }`;
  // "Custom" is a status, not something to press.
  if (!onClick) return <span className={className}>{children}</span>;
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={className}>
      {children}
    </button>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="mb-3 text-[11px] font-medium uppercase tracking-wide text-faint">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Field({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-medium">{label}</span>
        <span className="font-mono text-xs tabular-nums text-muted">{value}</span>
      </div>
      {children}
    </div>
  );
}

function Ends({ left, right }: { left: string; right: string }) {
  return (
    <div className="mt-1 flex justify-between font-body text-[11px] text-faint">
      <span>{left}</span>
      <span>{right}</span>
    </div>
  );
}

function Slider({
  label,
  display,
  value,
  onChange,
  min,
  max,
  step,
  reset,
  left,
  right,
}: {
  label: string;
  display: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  /** double-clicking the slider snaps back to this */
  reset: number;
  left: string;
  right: string;
}) {
  return (
    <Field label={label} value={display}>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(reset)}
        className="w-full"
      />
      <Ends left={left} right={right} />
    </Field>
  );
}

/** A -100..100 preference where the middle means "no preference". */
function Bipolar({
  label,
  value,
  onChange,
  left,
  right,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  left: string;
  right: string;
}) {
  return (
    <Slider
      label={label}
      display={value === 0 ? 'Any' : value < 0 ? `${left} ${-value}` : `${right} ${value}`}
      min={-100}
      max={100}
      step={5}
      value={value}
      onChange={onChange}
      reset={0}
      left={left}
      right={right}
    />
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { id: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-xs font-medium">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-line bg-surface px-2 py-1 text-xs"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SmallButton({
  onClick,
  disabled,
  title,
  type = 'button',
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  type?: 'button' | 'submit';
  children: React.ReactNode;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium transition-colors hover:bg-raised disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
