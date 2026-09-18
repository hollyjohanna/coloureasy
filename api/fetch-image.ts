/**
 * Fetches a remote image server-side so its pixels can be read from a canvas.
 *
 * This exists only because cross-origin images taint the canvas. The client
 * tries a direct CORS load first and only lands here when that fails.
 *
 * An unguarded image proxy is a real liability — it can be pointed at your own
 * internal network, or used to run someone else's bandwidth through your
 * account. Hence the checks below: scheme, DNS-resolved address, content type,
 * size, time, and rate.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

// Per-instance and therefore best-effort: serverless instances come and go, so
// this trims abuse rather than enforcing a hard quota.
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);

  if (hits.size > 5000) hits.clear();
  return recent.length > RATE_LIMIT;
}

/** Expand an IPv6 address to its eight 16-bit groups, resolving `::`. */
function expandIpv6(address: string): number[] | null {
  let text = address.toLowerCase();

  // A trailing dotted-quad (::ffff:127.0.0.1) becomes two hex groups.
  const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const [a, b, c, d] = dotted[1].split('.').map(Number);
    text = text.slice(0, -dotted[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const [head, tail, extra] = text.split('::');
  if (extra !== undefined) return null;

  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];

  const groups =
    tail === undefined
      ? left
      : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];

  if (groups.length !== 8) return null;

  const parsed = groups.map((g) => parseInt(g || '0', 16));
  return parsed.some(Number.isNaN) ? null : parsed;
}

/** Reject anything that isn't a public, routable address. */
export function isPrivateAddress(address: string): boolean {
  const v = isIP(address);

  if (v === 4) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 || // "this network"
      a === 10 || // private
      a === 127 || // loopback
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, incl. cloud metadata
      (a === 172 && b >= 16 && b <= 31) || // private
      (a === 192 && b === 168) || // private
      a >= 224 // multicast and reserved
    );
  }

  if (v === 6) {
    const g = expandIpv6(address);
    // Unparseable means unverifiable, which means blocked.
    if (!g) return true;

    // :: and ::1
    if (g.slice(0, 7).every((x) => x === 0) && g[7] <= 1) return true;

    // IPv4-mapped (::ffff:a.b.c.d) — re-check the embedded address. URL
    // normalisation rewrites the dotted form to hex, so this has to work on
    // the groups rather than on the original text.
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
      const v4 = [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff].join('.');
      return isPrivateAddress(v4);
    }

    return (
      (g[0] & 0xfe00) === 0xfc00 || // unique local, fc00::/7
      (g[0] & 0xffc0) === 0xfe80 // link-local, fe80::/10
    );
  }

  return true;
}

async function assertPublicHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, '');

  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('That address is not reachable.');
    return;
  }

  // Resolve first, so a public-looking hostname can't point at an internal IP.
  const records = await lookup(host, { all: true, verbatim: true });
  if (records.length === 0) throw new Error('That host could not be resolved.');
  if (records.some((r) => isPrivateAddress(r.address))) {
    throw new Error('That address is not reachable.');
  }
}

const bad = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export const config = { runtime: 'nodejs' };

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') return bad(405, 'Use GET.');

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (rateLimited(ip)) return bad(429, 'Too many requests. Give it a minute.');

  const target = new URL(request.url).searchParams.get('url');
  if (!target) return bad(400, 'No url given.');

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return bad(400, 'That is not a valid URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return bad(400, 'Only http and https URLs are supported.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // Follow redirects by hand so each hop gets the same address check —
    // otherwise a public URL could redirect straight to 169.254.169.254.
    let current = parsed;
    let response: Response | null = null;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicHost(current.hostname);

      response = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: 'image/*' },
      });

      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        current = new URL(location, current);
        continue;
      }
      break;
    }

    if (!response) return bad(502, 'That image could not be fetched.');
    if (response.status >= 300 && response.status < 400) {
      return bad(502, 'That URL redirects too many times.');
    }
    if (!response.ok) {
      return bad(502, `The server returned ${response.status}.`);
    }

    const type = response.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) {
      return bad(415, 'That URL is not an image.');
    }

    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > MAX_BYTES) {
      return bad(413, 'That image is too large.');
    }

    const body = await response.arrayBuffer();
    // Re-check: content-length can lie, or be absent entirely.
    if (body.byteLength > MAX_BYTES) {
      return bad(413, 'That image is too large.');
    }

    return new Response(body, {
      status: 200,
      headers: {
        'content-type': type,
        'content-length': String(body.byteLength),
        'cache-control': 'public, max-age=86400, s-maxage=86400',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return bad(504, 'That image took too long to fetch.');
    }
    return bad(
      502,
      error instanceof Error ? error.message : 'That image could not be fetched.',
    );
  } finally {
    clearTimeout(timer);
  }
}
