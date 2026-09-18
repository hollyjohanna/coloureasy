import { useEffect, useState } from 'react';
import type { ImageRecord } from '../lib/library';

/**
 * Object URLs for library thumbnails, revoked whenever the set changes.
 *
 * Lifted out of the Library so the landing page can show the same thumbnails
 * without creating a second set of URLs for the same blobs.
 */
export function useThumbUrls(images: ImageRecord[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const image of images) next[image.id] = URL.createObjectURL(image.thumb);
    setUrls(next);
    return () => {
      for (const url of Object.values(next)) URL.revokeObjectURL(url);
    };
  }, [images]);

  return urls;
}
