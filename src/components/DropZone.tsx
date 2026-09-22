import { useEffect, useRef, useState } from 'react';
import { imageFromTransfer } from '../lib/loadImage';

type Props = {
  onFile: (file: File) => void;
  onUrl: (url: string) => void;
  busy: boolean;
};

export default function DropZone({ onFile, onUrl, busy }: Props) {
  const [dragging, setDragging] = useState(false);
  const [url, setUrl] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Paste an image straight from the clipboard, anywhere on the page.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = imageFromTransfer(event.clipboardData?.items ?? null);
      if (file) {
        event.preventDefault();
        onFile(file);
        return;
      }

      const text = event.clipboardData?.getData('text')?.trim();
      if (text && /^https?:\/\//i.test(text)) {
        event.preventDefault();
        onUrl(text);
      }
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onFile, onUrl]);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = imageFromTransfer(e.dataTransfer.items);
          if (file) onFile(file);
        }}
        className={`rounded-2xl border-2 border-dashed p-10 text-center transition-colors sm:p-16 ${
          dragging ? 'border-ink bg-raised' : 'border-line bg-surface'
        }`}
      >
        <p className="text-lg font-medium">Drop an image here</p>
        <p className="font-body mt-2 text-sm text-muted">
          or paste one from your clipboard
        </p>

        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="mt-6 rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-shell transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          Choose a file
        </button>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            // Reset so choosing the same file twice in a row still fires.
            e.target.value = '';
          }}
        />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) onUrl(url);
        }}
        className="flex gap-2"
      >
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="…or paste an image URL"
          aria-label="Image URL"
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm placeholder:text-faint focus:border-muted focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !url.trim()}
          className="rounded-lg border border-line px-4 py-2.5 text-sm font-medium transition-colors hover:bg-raised disabled:opacity-40"
        >
          Load
        </button>
      </form>

      <p className="font-body text-center text-xs text-faint">
        Images are read entirely in your browser. Nothing is uploaded or stored.
      </p>
    </div>
  );
}
