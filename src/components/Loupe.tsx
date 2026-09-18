import { readableTextOn, rgbToHex, type Rgb } from '../lib/colour';

/** Screen pixels per source pixel inside the glass. */
const PIXEL_SCALE = 8;
const SIZE = 144;

type Props = {
  src: string;
  /** natural image dimensions, so magnification is of real pixels */
  width: number;
  height: number;
  /** sample point, 0-1 */
  x: number;
  y: number;
  rgb: Rgb;
};

/**
 * A magnifier that follows the pointer while picking.
 *
 * The magnified view is a background-image rather than a canvas: the browser
 * does the sampling, there is nothing to keep in sync, and `pixelated` keeps
 * the source pixels crisp instead of blurring the very detail you are trying
 * to aim at.
 */
export default function Loupe({ src, width, height, x, y, rgb }: Props) {
  const hex = rgbToHex(rgb).toUpperCase();
  // Flip below the pointer near the top edge, so the glass never sits
  // off-screen exactly when you need it.
  const below = y < 0.28;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-20"
      style={{
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        transform: `translate(-50%, ${below ? '24px' : `calc(-100% - 24px)`})`,
      }}
    >
      <div
        className="overflow-hidden rounded-full border-2 border-white shadow-[0_4px_16px_rgba(0,0,0,0.45)]"
        style={{ width: SIZE, height: SIZE }}
      >
        <div
          className="h-full w-full"
          style={{
            backgroundImage: `url(${src})`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: `${width * PIXEL_SCALE}px ${height * PIXEL_SCALE}px`,
            backgroundPosition: `${SIZE / 2 - x * width * PIXEL_SCALE}px ${
              SIZE / 2 - y * height * PIXEL_SCALE
            }px`,
            imageRendering: 'pixelated',
          }}
        />
      </div>

      {/* The target: sits over the centre of the glass, matching the 5x5
          neighbourhood that actually gets averaged. */}
      <div
        className="absolute left-1/2 rounded-[2px] border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
        style={{
          top: SIZE / 2,
          width: PIXEL_SCALE * 5,
          height: PIXEL_SCALE * 5,
          transform: 'translate(-50%, -50%)',
        }}
      />

      <div
        className="mx-auto mt-1.5 w-fit rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold shadow-lg"
        style={{ background: hex, color: readableTextOn(rgb) }}
      >
        {hex}
      </div>
    </div>
  );
}
