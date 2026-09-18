import { rgbToHex, type Rgb } from '../lib/colour';
import type { ImageRecord } from '../lib/library';
import DropZone from './DropZone';
import SharedPalette from './SharedPalette';

type Props = {
  onFile: (file: File) => void;
  onUrl: (url: string) => void;
  busy: boolean;
  recent: ImageRecord[];
  thumbs: Record<string, string>;
  onOpenRecent: (record: ImageRecord) => void;
  /** a palette someone arrived here via a share link */
  shared: Rgb[];
  onDismissShared: () => void;
  notify: (message: string) => void;
};

const TOOLS = [
  ['Palette', 'Five colours from the image, dragged wherever you want them.'],
  ['Colour Picker', 'Every colour, with hex, RGB, HSL, HSB and CMYK.'],
  ['Value Study', 'Tone alone, colour stripped out — the study before the paint.'],
  ['Layer Extractor', 'The image rebuilt from your palette, split into layers.'],
];

/**
 * What you see before an image exists. The tools are hidden entirely until
 * there's something to use them on — an empty editor with everything greyed out
 * tells a first-time visitor nothing about what this is for.
 */
export default function Landing({
  onFile,
  onUrl,
  busy,
  recent,
  thumbs,
  onOpenRecent,
  shared,
  onDismissShared,
  notify,
}: Props) {
  return (
    <main className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 py-10 sm:py-16">
      <div className="w-full max-w-xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Plan a painting from a photograph
        </h1>
        <p className="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-muted sm:text-base">
          Colour Easy pulls a palette out of any image, shows you its tonal
          structure, and rebuilds the picture using only the colours you choose —
          so you know what to mix before you pick up a brush.
        </p>
      </div>

      <div className="mt-10 w-full">
        <DropZone onFile={onFile} onUrl={onUrl} busy={busy} />
      </div>

      {shared.length > 0 && (
        <div className="mt-10 w-full">
          <SharedPalette
            colours={shared}
            onDismiss={onDismissShared}
            notify={notify}
          />
        </div>
      )}

      {recent.length > 0 && (
        <section className="mt-10 w-full max-w-xl">
          <h2 className="mb-3 text-xs font-medium tracking-wide text-faint uppercase">
            Pick up where you left off
          </h2>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {recent.map((image) => (
              <li key={image.id}>
                <button
                  type="button"
                  onClick={() => onOpenRecent(image)}
                  title={image.name}
                  className="group block w-full overflow-hidden rounded-lg border border-line bg-surface"
                >
                  <span className="checkerboard block aspect-4/3 overflow-hidden">
                    {thumbs[image.id] && (
                      <img
                        src={thumbs[image.id]}
                        alt={image.name}
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                      />
                    )}
                  </span>
                  {image.palette.length > 0 && (
                    <span className="flex h-1.5 w-full">
                      {image.palette.map((rgb, i) => (
                        <span
                          key={i}
                          className="flex-1"
                          style={{ background: rgbToHex(rgb) }}
                        />
                      ))}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-14 w-full max-w-xl">
        <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {TOOLS.map(([name, blurb]) => (
            <li key={name}>
              <h3 className="text-sm font-medium">{name}</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-faint">{blurb}</p>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-12 max-w-md text-center text-xs leading-relaxed text-faint">
        Everything happens in your browser. Your images are never uploaded, and
        the library is stored on this device only.
      </p>
    </main>
  );
}
