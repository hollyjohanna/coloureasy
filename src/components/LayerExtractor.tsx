import { useEffect, useRef } from 'react';
import Stage from './Stage';
import type { Rgb } from '../lib/colour';
import type { PosteriseResult } from '../lib/posterise';
import { renderLabels } from '../lib/posterise';

type Props = {
  result: PosteriseResult | null;
  palette: Rgb[];
  visible: readonly boolean[];
  working: boolean;
  /** show the original underneath, for comparison */
  compareSrc: string;
  compare: boolean;
  width: number;
  height: number;
  zoom: number;
  onZoom: (zoom: number) => void;
};

export default function LayerExtractor({
  result,
  palette,
  visible,
  working,
  compareSrc,
  compare,
  width,
  height,
  zoom,
  onZoom,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !result) return;

    canvas.width = result.width;
    canvas.height = result.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, result.width, result.height);
    ctx.putImageData(
      renderLabels(result.labels, result.width, result.height, palette, visible),
      0,
      0,
    );
  }, [result, palette, visible]);

  return (
    <Stage width={width} height={height} zoom={zoom} onZoom={onZoom}>
      {/* The original sits underneath so hiding layers reveals it, which is
          how you check a layer's shapes against the reference. */}
      <img
        src={compareSrc}
        alt=""
        aria-hidden
        draggable={false}
        className={`block h-full w-full select-none transition-opacity ${
          compare ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full transition-opacity ${
          result ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {working && (
        <div className="absolute inset-0 grid place-items-center bg-shell/50">
          <span className="rounded-full bg-raised px-3 py-1.5 text-xs text-muted">
            Rebuilding…
          </span>
        </div>
      )}
    </Stage>
  );
}
