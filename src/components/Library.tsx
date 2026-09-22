import { useEffect, useMemo, useState } from 'react';
import { rgbToHex } from '../lib/colour';
import { ConfirmDialog, PromptDialog } from './Dialog';
import type { Collection, ImageRecord } from '../lib/library';

type DialogState =
  | { type: 'newCollection' }
  | { type: 'renamePhoto'; id: string; name: string }
  | { type: 'renameCollection'; id: string; name: string }
  | { type: 'deleteCollection'; id: string; name: string };

type Props = {
  images: ImageRecord[];
  collections: Collection[];
  space: { used: number; quota: number } | null;
  ready: boolean;
  available: boolean;
  onOpen: (record: ImageRecord) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onAddCollection: (name: string) => void;
  onRenameCollection: (id: string, name: string) => void;
  onDropCollection: (id: string) => void;
  onToggleIn: (collectionId: string, imageId: string) => void;
  onAddImage: () => void;
  thumbs: Record<string, string>;
};

const RECENT = 'recent';

const formatSize = (bytes: number) =>
  bytes > 1e9
    ? `${(bytes / 1e9).toFixed(1)}GB`
    : `${Math.round(bytes / 1e6)}MB`;

export default function Library({
  images,
  collections,
  space,
  ready,
  available,
  onOpen,
  onRemove,
  onRename,
  onAddCollection,
  onRenameCollection,
  onDropCollection,
  onToggleIn,
  onAddImage,
  thumbs,
}: Props) {
  const [active, setActive] = useState<string>(RECENT);
  const [filing, setFiling] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);

  // A collection can be deleted while it's the one being viewed.
  useEffect(() => {
    if (active !== RECENT && !collections.some((c) => c.id === active)) {
      setActive(RECENT);
    }
  }, [collections, active]);

  const shown = useMemo(() => {
    if (active === RECENT) return images;
    const collection = collections.find((c) => c.id === active);
    if (!collection) return [];
    // Keep the collection's own order rather than recency.
    return collection.imageIds
      .map((id) => images.find((image) => image.id === id))
      .filter((image): image is ImageRecord => Boolean(image));
  }, [active, images, collections]);

  if (!available) {
    return (
      <div className="grid flex-1 place-items-center p-8 text-center">
        <p className="max-w-sm text-sm text-muted">
          This browser doesn’t allow local storage, so the library is
          unavailable. Everything else works as normal.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
      <div className="shrink-0 border-b border-line p-3 lg:w-56 lg:border-b-0 lg:border-r">
        <div className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          <CollectionTab
            label="Recent"
            count={images.length}
            active={active === RECENT}
            onSelect={() => setActive(RECENT)}
          />
          {collections.map((collection) => (
            <CollectionTab
              key={collection.id}
              label={collection.name}
              count={collection.imageIds.length}
              active={active === collection.id}
              onSelect={() => setActive(collection.id)}
              onRename={() =>
                setDialog({ type: 'renameCollection', id: collection.id, name: collection.name })
              }
              onDelete={() =>
                setDialog({ type: 'deleteCollection', id: collection.id, name: collection.name })
              }
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => setDialog({ type: 'newCollection' })}
          className="mt-2 w-full rounded-lg border border-dashed border-line px-3 py-2 text-xs text-muted transition-colors hover:bg-surface hover:text-ink"
        >
          + New collection
        </button>

        {space && (
          <p className="mt-3 hidden text-[11px] leading-relaxed text-faint lg:block">
            {formatSize(space.used)} used. Stored in this browser only — it
            won’t follow you to another device.
          </p>
        )}
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {!ready ? (
          <p className="text-sm text-faint">Opening the library…</p>
        ) : shown.length === 0 ? (
          <div className="grid h-full place-items-center py-16 text-center">
            <div>
              <p className="text-sm text-muted">
                {active === RECENT
                  ? 'Nothing here yet. Images you open are kept automatically.'
                  : 'This collection is empty. Open Recent and file something into it.'}
              </p>
              {active === RECENT && (
                <button
                  type="button"
                  onClick={onAddImage}
                  className="mt-4 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-shell transition-opacity hover:opacity-90"
                >
                  Add an image
                </button>
              )}
            </div>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {shown.map((image) => (
              <li
                key={image.id}
                className="group overflow-hidden rounded-xl border border-line bg-surface"
              >
                <button
                  type="button"
                  onClick={() => onOpen(image)}
                  className="block w-full"
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
                    <span className="flex h-3 w-full">
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

                <div className="flex items-center gap-1 px-2.5 py-2">
                  <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
                    {image.name}
                  </span>

                  <button
                    type="button"
                    onClick={() =>
                      setDialog({ type: 'renamePhoto', id: image.id, name: image.name })
                    }
                    aria-label={`Rename ${image.name}`}
                    title="Rename"
                    className="shrink-0 rounded px-1.5 py-0.5 text-xs text-faint transition-colors hover:bg-raised hover:text-ink"
                  >
                    ✎
                  </button>

                  {collections.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setFiling(filing === image.id ? null : image.id)}
                      aria-label="Add to a collection"
                      title="Add to a collection"
                      className="shrink-0 rounded px-1.5 py-0.5 text-xs text-faint transition-colors hover:bg-raised hover:text-ink"
                    >
                      ⊞
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onRemove(image.id)}
                    aria-label={`Remove ${image.name} from the library`}
                    title="Remove from the library"
                    className="shrink-0 rounded px-1.5 py-0.5 text-xs text-faint transition-colors hover:bg-raised hover:text-ink"
                  >
                    ×
                  </button>
                </div>

                {filing === image.id && (
                  <ul className="border-t border-line px-2 py-1.5">
                    {collections.map((collection) => {
                      const has = collection.imageIds.includes(image.id);
                      return (
                        <li key={collection.id}>
                          <button
                            type="button"
                            onClick={() => onToggleIn(collection.id, image.id)}
                            className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[11px] text-muted transition-colors hover:bg-raised hover:text-ink"
                          >
                            <span aria-hidden>{has ? '☑' : '☐'}</span>
                            <span className="truncate">{collection.name}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {dialog?.type === 'newCollection' && (
        <PromptDialog
          title="Name this collection"
          confirmLabel="Create"
          onConfirm={(name) => {
            onAddCollection(name);
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.type === 'renamePhoto' && (
        <PromptDialog
          title="Rename this photo"
          defaultValue={dialog.name}
          onConfirm={(name) => {
            onRename(dialog.id, name);
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.type === 'renameCollection' && (
        <PromptDialog
          title="Rename this collection"
          defaultValue={dialog.name}
          onConfirm={(name) => {
            onRenameCollection(dialog.id, name);
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.type === 'deleteCollection' && (
        <ConfirmDialog
          title={`Delete “${dialog.name}”?`}
          message="The images stay in Recent — only the collection goes."
          onConfirm={() => {
            onDropCollection(dialog.id);
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function CollectionTab({
  label,
  count,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  label: string;
  count: number;
  active: boolean;
  onSelect: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={`flex shrink-0 items-center gap-1 rounded-lg transition-colors lg:w-full ${
        active ? 'bg-raised' : 'hover:bg-surface'
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        className={`min-w-0 flex-1 px-3 py-2 text-left text-xs font-medium ${
          active ? 'text-ink' : 'text-muted'
        }`}
      >
        <span className="truncate">{label}</span>
        <span className="ml-1.5 text-faint">{count}</span>
      </button>

      {onRename && onDelete && active && (
        <span className="flex shrink-0 pr-1.5">
          <button
            type="button"
            onClick={onRename}
            aria-label={`Rename ${label}`}
            className="rounded px-1 text-[11px] text-faint hover:text-ink"
          >
            ✎
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${label}`}
            className="rounded px-1 text-[11px] text-faint hover:text-ink"
          >
            ×
          </button>
        </span>
      )}
    </div>
  );
}
