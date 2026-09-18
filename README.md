# Colour Extractor

Drop in an image and pull out its palette. Choose how many colours, see where on
the image each one came from, and click the image to add your own.

Everything runs in the browser. Images are never uploaded and nothing is stored.

## Stack

| | |
|---|---|
| Build | Vite 7 |
| UI | React 19 + TypeScript |
| Styling | Tailwind v4 (`@tailwindcss/vite`) |
| Tests | Vitest |
| Hosting | Vercel — static build plus one serverless function |

No database, no accounts, no third-party API keys.

## Getting started

```bash
nvm use          # Node 22
npm install
npm run dev      # http://localhost:5173
```

| Script | |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | typecheck all three TS projects, then build to `dist/` |
| `npm run preview` | serve the production build |
| `npm test` | run the test suite |

### Working on the URL-paste feature

Pasting an image URL can fall back to a serverless function, which plain `vite`
doesn't serve. Run `vercel dev` alongside it, then point the dev proxy at it:

```bash
vercel dev                 # serves /api on :3000
API_PORT=3000 npm run dev  # override API_PORT if 3000 is taken
```

Uploads, drag-and-drop and clipboard paste all work without this.

## How it works

**Extraction** (`src/lib/quantise.ts`) is recursive splitting in OKLab: take the
bucket of pixels with the most colour error, sort it along its widest axis, and
cut it where the two halves' combined error is lowest. OKLab because euclidean
distance in it roughly matches what the eye sees; lowest-error cuts rather than
median cuts because splitting at the median bisects tight clusters over and over
and hands you visibly duplicate swatches.

It runs **once per image**, in a Web Worker, all the way to 64 colours, and
returns the whole split tree. Reading the palette at any count is then just
replaying the first n−1 splits — so the slider is instant, and it's *stable*:
going 20 → 21 splits one bucket and leaves the other 19 exactly where they were.

**Markers** are the pixel in each bucket closest to that bucket's average colour,
stored as percentages so the overlay stays aligned at any display size.

**Clicking the image** averages a 5×5 neighbourhood rather than one pixel, so a
stray JPEG artefact can't become your brand colour. Hand-picked colours are kept
separate from the extracted ones, so moving the slider never disturbs them.

**Pasted URLs** are loaded directly where the host sends CORS headers. When it
doesn't, the canvas would be tainted and the pixels unreadable, so the bytes come
back through `api/fetch-image.ts` instead. That function is deliberately narrow:
https/http only, DNS-resolved address checked against private ranges on every
redirect hop, `image/*` only, 15MB and 10s caps, and per-IP rate limiting.

## Deployment

Push to `main`. Vercel builds and deploys automatically.

Import the repo once under the `hollyjohannas-projects` team with the **Vite**
preset and `dist` as the output directory. `vercel.json` carries the SPA rewrite,
and `api/fetch-image.ts` is picked up as a serverless function with no extra
config. There are no environment variables to set.

## Tests

```bash
npm test
```

Covers colour-space round trips, quantiser determinism and slider stability, and
the proxy's SSRF guards. The proxy tests never touch the network.
