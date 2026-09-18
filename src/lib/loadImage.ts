/**
 * Getting an image into the page from a file, a paste, or a URL.
 *
 * The URL path is the awkward one. Reading pixels from a cross-origin image
 * *taints* the canvas and `getImageData` throws — a browser security rule with
 * no client-side workaround. So we try a direct CORS load first (works for
 * Unsplash, S3 and anything else that sets the headers), and only fall back to
 * the `/api/fetch-image` proxy when that fails.
 */

export type LoadedImage = {
  /** object URL for display; revoke with `releaseImage` */
  src: string;
  width: number;
  height: number;
  name: string;
  /** true when the bytes came via the serverless proxy rather than directly */
  proxied: boolean;
};

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export class ImageLoadError extends Error {}

async function fromBlob(blob: Blob, name: string, proxied: boolean): Promise<LoadedImage> {
  if (!blob.type.startsWith('image/')) {
    throw new ImageLoadError(`That file is a ${blob.type || 'unknown type'}, not an image.`);
  }
  if (blob.size > MAX_FILE_BYTES) {
    throw new ImageLoadError('That image is over 25MB. Try a smaller version.');
  }

  const src = URL.createObjectURL(blob);

  try {
    const { width, height } = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new ImageLoadError('That image could not be decoded.'));
      img.src = src;
    });

    if (width === 0 || height === 0) {
      throw new ImageLoadError('That image has no pixels in it.');
    }

    return { src, width, height, name, proxied };
  } catch (error) {
    URL.revokeObjectURL(src);
    throw error;
  }
}

export function loadFromFile(file: File): Promise<LoadedImage> {
  return fromBlob(file, file.name, false);
}

function filenameFromUrl(url: string): string {
  try {
    const { pathname, hostname } = new URL(url);
    const last = pathname.split('/').filter(Boolean).pop();

    // Only trust the last segment when it actually looks like a filename.
    // Plenty of image URLs end in something meaningless — picsum's
    // /seed/x/800/600 would otherwise export as "600-palette.png".
    if (last && /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(last)) {
      return decodeURIComponent(last);
    }
    return hostname || 'image';
  } catch {
    return 'image';
  }
}

// Without these, a host that accepts the connection and then never answers
// leaves the tool spinning with no error and no way back.
const DIRECT_TIMEOUT_MS = 8_000;
const PROXY_TIMEOUT_MS = 20_000;

/** Fetch directly, which only succeeds if the host sends CORS headers. */
async function fetchDirect(url: string): Promise<Blob> {
  const response = await fetch(url, {
    mode: 'cors',
    signal: AbortSignal.timeout(DIRECT_TIMEOUT_MS),
  });
  if (!response.ok) throw new ImageLoadError(`The server returned ${response.status}.`);
  return response.blob();
}

async function fetchProxied(url: string): Promise<Blob> {
  const response = await fetch(`/api/fetch-image?url=${encodeURIComponent(url)}`, {
    signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await response
      .json()
      .then((body: { error?: string }) => body.error)
      .catch(() => null);
    throw new ImageLoadError(detail ?? `Could not fetch that image (${response.status}).`);
  }

  return response.blob();
}

export async function loadFromUrl(input: string): Promise<LoadedImage> {
  const url = input.trim();

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ImageLoadError('That does not look like a URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ImageLoadError('Only http and https URLs are supported.');
  }

  const name = filenameFromUrl(url);

  // Fast path: no serverless invocation at all when the host plays nicely.
  try {
    return await fromBlob(await fetchDirect(url), name, false);
  } catch {
    // Fall through — almost always CORS, which the proxy exists to solve.
  }

  try {
    return await fromBlob(await fetchProxied(url), name, true);
  } catch (error) {
    if (error instanceof ImageLoadError) throw error;
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new ImageLoadError('That image took too long to load.');
    }
    throw new ImageLoadError('Could not reach that image.');
  }
}

/** Pull the first image out of a clipboard or drag-and-drop payload. */
export function imageFromTransfer(items: DataTransferItemList | null): File | null {
  if (!items) return null;
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

export const releaseImage = (image: LoadedImage | null) => {
  if (image) URL.revokeObjectURL(image.src);
};
