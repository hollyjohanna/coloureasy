/**
 * A library of images and collections, stored entirely in the browser.
 *
 * IndexedDB rather than a server: it holds Blobs, so the pictures themselves
 * live here alongside their metadata, and the app keeps its "nothing is
 * uploaded" promise. The trade is that a library belongs to one browser on one
 * device.
 *
 * The shapes below are deliberately the ones a Postgres schema would use —
 * images, collections, and a list of members — so that adding sync later is
 * additive rather than a rewrite.
 */

import type { Rgb } from './colour';

const DB_NAME = 'colour-extractor';
const DB_VERSION = 1;
const IMAGES = 'images';
const COLLECTIONS = 'collections';

/**
 * Stored images are capped at the size the tools actually use. The posteriser
 * works at 2400px and the sampler at 2000px, so keeping originals would cost
 * quota for detail nothing ever reads.
 */
export const MAX_STORED_SIDE = 2400;

/** Below this, the original file is kept untouched rather than re-encoded. */
const REENCODE_ABOVE_BYTES = 4 * 1024 * 1024;

export const THUMB_SIDE = 480;

/** How many un-collected images to keep before the oldest start dropping off. */
export const MAX_RECENT = 60;

export type ImageRecord = {
  id: string;
  name: string;
  blob: Blob;
  thumb: Blob;
  width: number;
  height: number;
  addedAt: number;
  /** last time this image was opened; drives both ordering and pruning */
  usedAt: number;
  /** a few colours, purely so the library grid can show a palette strip */
  palette: Rgb[];
};

export type Collection = {
  id: string;
  name: string;
  createdAt: number;
  imageIds: string[];
};

/* --------------------------------------------------------------- plumbing */

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IMAGES)) {
        const store = db.createObjectStore(IMAGES, { keyPath: 'id' });
        store.createIndex('usedAt', 'usedAt');
      }
      if (!db.objectStoreNames.contains(COLLECTIONS)) {
        db.createObjectStore(COLLECTIONS, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the library.'));
    // Another tab holding an old version open would block the upgrade forever.
    request.onblocked = () => reject(new Error('The library is open in another tab.'));
  });

  return dbPromise;
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = action(tx.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export const isSupported = () =>
  typeof indexedDB !== 'undefined';

/**
 * Ask the browser not to evict us under storage pressure. Usually granted for
 * a site someone has actually engaged with; nothing breaks if it isn't.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function usage(): Promise<{ used: number; quota: number } | null> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate) return null;
    return { used: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
  } catch {
    return null;
  }
}

const newId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/* ----------------------------------------------------------------- images */

export const putImage = (record: ImageRecord) =>
  run(IMAGES, 'readwrite', (s) => s.put(record)).then(() => record);

export const getImage = (id: string) =>
  run<ImageRecord | undefined>(IMAGES, 'readonly', (s) => s.get(id));

export const listImages = () =>
  run<ImageRecord[]>(IMAGES, 'readonly', (s) => s.getAll()).then((all) =>
    all.sort((a, b) => b.usedAt - a.usedAt),
  );

export const deleteImage = (id: string) =>
  run(IMAGES, 'readwrite', (s) => s.delete(id));

export async function touchImage(id: string) {
  const existing = await getImage(id);
  if (!existing) return;
  await putImage({ ...existing, usedAt: Date.now() });
}

/* ------------------------------------------------------------ collections */

export const listCollections = () =>
  run<Collection[]>(COLLECTIONS, 'readonly', (s) => s.getAll()).then((all) =>
    all.sort((a, b) => a.createdAt - b.createdAt),
  );

export const putCollection = (collection: Collection) =>
  run(COLLECTIONS, 'readwrite', (s) => s.put(collection)).then(() => collection);

export const createCollection = (name: string) =>
  putCollection({
    id: newId(),
    name: name.trim() || 'Untitled',
    createdAt: Date.now(),
    imageIds: [],
  });

export const deleteCollection = (id: string) =>
  run(COLLECTIONS, 'readwrite', (s) => s.delete(id));

/* -------------------------------------------------------------- selection */

/**
 * Which images to drop when the library is over its limit.
 *
 * Anything in a collection is safe — the user put it there deliberately, and
 * silently deleting it would be the worst possible behaviour. Only loose
 * "recent" images age out, oldest first.
 *
 * Pure, so the rule can be tested without a browser.
 */
export function prunable(
  images: { id: string; usedAt: number }[],
  collections: { imageIds: string[] }[],
  max = MAX_RECENT,
): string[] {
  const kept = new Set(collections.flatMap((c) => c.imageIds));
  const loose = images
    .filter((image) => !kept.has(image.id))
    .sort((a, b) => b.usedAt - a.usedAt);

  return loose.slice(max).map((image) => image.id);
}

/* ------------------------------------------------------------- media prep */

async function decode(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not decode that image.'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function render(img: HTMLImageElement, side: number, type: string): Promise<Blob> {
  const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get a 2D context.');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode.'))),
      type,
      0.9,
    );
  });
}

/**
 * PNG keeps transparency, which JPEG would fill with black — so anything that
 * might have an alpha channel stays PNG and everything else goes to JPEG,
 * which is far smaller for photographs.
 */
const encodingFor = (type: string) =>
  type === 'image/png' || type === 'image/webp' || type === 'image/gif'
    ? 'image/png'
    : 'image/jpeg';

export async function buildRecord(
  blob: Blob,
  name: string,
  palette: Rgb[] = [],
): Promise<ImageRecord> {
  const img = await decode(blob);
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  const type = encodingFor(blob.type);

  // Leave small files exactly as they are: re-encoding would only lose quality
  // and, for a PNG screenshot, often make it bigger.
  const stored =
    longest <= MAX_STORED_SIDE && blob.size <= REENCODE_ABOVE_BYTES
      ? blob
      : await render(img, MAX_STORED_SIDE, type);

  return {
    id: newId(),
    name,
    blob: stored,
    thumb: await render(img, THUMB_SIDE, type),
    width: img.naturalWidth,
    height: img.naturalHeight,
    addedAt: Date.now(),
    usedAt: Date.now(),
    palette,
  };
}

/** Delete an image and drop it from every collection that held it. */
export async function forget(id: string) {
  const collections = await listCollections();
  await Promise.all(
    collections
      .filter((c) => c.imageIds.includes(id))
      .map((c) => putCollection({ ...c, imageIds: c.imageIds.filter((x) => x !== id) })),
  );
  await deleteImage(id);
}

export async function prune() {
  const [images, collections] = await Promise.all([listImages(), listCollections()]);
  await Promise.all(prunable(images, collections).map((id) => deleteImage(id)));
}
