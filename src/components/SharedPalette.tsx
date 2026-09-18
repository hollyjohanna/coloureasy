import { formatAll, readableTextOn, rgbToHex, type Rgb } from '../lib/colour';

type Props = {
  colours: Rgb[];
  onDismiss: () => void;
  notify: (message: string) => void;
};

/**
 * Shown when someone opens a shared link. The link carries the colours only, so
 * there's no image and no markers — just the palette, with the option to drop
 * in an image and start a new one.
 */
export default function SharedPalette({ colours, onDismiss, notify }: Props) {
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify(`Copied — ${value}`);
    } catch {
      notify('Your browser blocked the clipboard.');
    }
  };

  return (
    <section className="mx-auto w-full max-w-xl px-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-medium">
          Shared palette
          <span className="ml-2 text-xs font-normal text-faint">
            {colours.length} colours
          </span>
        </h2>
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs text-muted transition-colors hover:text-ink"
        >
          Dismiss
        </button>
      </div>

      <ul className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
        {colours.map((rgb, i) => {
          const hex = rgbToHex(rgb);
          return (
            <li key={`${hex}-${i}`}>
              <button
                type="button"
                onClick={() => copy(formatAll(rgb).hex)}
                title={`Copy ${formatAll(rgb).hex}`}
                className="flex aspect-square w-full items-end justify-center rounded-md pb-1.5 font-mono text-[9px] transition-transform hover:scale-105"
                style={{ background: hex, color: readableTextOn(rgb) }}
              >
                {formatAll(rgb).hex}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
