import { useCallback, useEffect, useRef, useState } from 'react';
import type { Rgb } from '../lib/colour';
import {
  buildRecord,
  createCollection as create,
  deleteCollection as removeCollection,
  forget,
  isSupported,
  listCollections,
  listImages,
  prune,
  putCollection,
  putImage,
  requestPersistence,
  touchImage,
  usage,
  type Collection,
  type ImageRecord,
} from '../lib/library';

export function useLibrary() {
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [ready, setReady] = useState(false);
  const [available] = useState(isSupported);
  const [error, setError] = useState<string | null>(null);
  const [space, setSpace] = useState<{ used: number; quota: number } | null>(null);

  /** Images saved this session, so re-opening one doesn't duplicate it. */
  const savedThisSession = useRef(new Map<string, string>());

  const refresh = useCallback(async () => {
    if (!available) return;
    try {
      const [nextImages, nextCollections] = await Promise.all([
        listImages(),
        listCollections(),
      ]);
      setImages(nextImages);
      setCollections(nextCollections);
      setSpace(await usage());
    } catch {
      setError('Could not read the library.');
    }
  }, [available]);

  useEffect(() => {
    if (!available) {
      setReady(true);
      return;
    }
    // Ask to be exempt from eviction before anything is written, so a library
    // built up over months isn't cleared the first time the disk fills.
    requestPersistence()
      .then(refresh)
      .finally(() => setReady(true));
  }, [available, refresh]);

  /**
   * Remember an image that has just been opened. Called for everything, which
   * is what makes the Recent list a recent list — collections stay explicit.
   */
  const remember = useCallback(
    async (blob: Blob, name: string, palette: Rgb[]): Promise<string | null> => {
      if (!available) return null;

      const key = `${name}:${blob.size}`;
      const seen = savedThisSession.current.get(key);
      if (seen) {
        await touchImage(seen);
        await refresh();
        return seen;
      }

      try {
        const record = await buildRecord(blob, name, palette);
        await putImage(record);
        savedThisSession.current.set(key, record.id);
        await prune();
        await refresh();
        return record.id;
      } catch {
        // A full or blocked database shouldn't stop anyone using the tools.
        setError('Could not save to the library — it may be full.');
        return null;
      }
    },
    [available, refresh],
  );

  /** Attach a palette to an image already saved, once extraction finishes. */
  const describe = useCallback(
    async (id: string, palette: Rgb[]) => {
      try {
        const existing = images.find((i) => i.id === id);
        if (!existing || existing.palette.length > 0) return;
        await putImage({ ...existing, palette });
        await refresh();
      } catch {
        /* cosmetic only — the grid just shows no strip */
      }
    },
    [images, refresh],
  );

  const open = useCallback(
    async (id: string) => {
      await touchImage(id);
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await forget(id);
      await refresh();
    },
    [refresh],
  );

  const renameImage = useCallback(
    async (id: string, name: string) => {
      const existing = images.find((i) => i.id === id);
      if (!existing) return;
      await putImage({ ...existing, name: name.trim() || existing.name });
      await refresh();
    },
    [images, refresh],
  );

  const addCollection = useCallback(
    async (name: string) => {
      const collection = await create(name);
      await refresh();
      return collection;
    },
    [refresh],
  );

  const renameCollection = useCallback(
    async (id: string, name: string) => {
      const existing = collections.find((c) => c.id === id);
      if (!existing) return;
      await putCollection({ ...existing, name: name.trim() || existing.name });
      await refresh();
    },
    [collections, refresh],
  );

  const dropCollection = useCallback(
    async (id: string) => {
      await removeCollection(id);
      await refresh();
    },
    [refresh],
  );

  /** Add or remove in one call — the grid toggles membership. */
  const toggleIn = useCallback(
    async (collectionId: string, imageId: string) => {
      const collection = collections.find((c) => c.id === collectionId);
      if (!collection) return;

      const imageIds = collection.imageIds.includes(imageId)
        ? collection.imageIds.filter((x) => x !== imageId)
        : [...collection.imageIds, imageId];

      await putCollection({ ...collection, imageIds });
      await refresh();
    },
    [collections, refresh],
  );

  return {
    available,
    ready,
    images,
    collections,
    space,
    error,
    clearError: () => setError(null),
    remember,
    describe,
    open,
    remove,
    renameImage,
    addCollection,
    renameCollection,
    dropCollection,
    toggleIn,
  };
}
