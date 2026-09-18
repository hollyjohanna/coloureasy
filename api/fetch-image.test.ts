import { describe, expect, it } from 'vitest';
import handler, { isPrivateAddress } from './fetch-image';

/**
 * These cover the guards that reject *before* any outbound request is made, so
 * the suite never touches the network. They are the security-critical paths:
 * an image proxy that can be pointed at an internal address is a way into the
 * private network it runs in.
 */

const call = (url: string, init?: RequestInit) =>
  handler(new Request(`https://example.test/api/fetch-image?url=${encodeURIComponent(url)}`, init));

const body = async (res: Response) => (await res.json()) as { error?: string };

describe('request shape', () => {
  it('rejects anything but GET', async () => {
    const res = await call('https://example.com/a.png', { method: 'POST' });
    expect(res.status).toBe(405);
  });

  it('rejects a missing url', async () => {
    const res = await handler(new Request('https://example.test/api/fetch-image'));
    expect(res.status).toBe(400);
    expect((await body(res)).error).toMatch(/no url/i);
  });

  it('rejects a malformed url', async () => {
    const res = await call('not a url');
    expect(res.status).toBe(400);
  });
});

describe('scheme guard', () => {
  for (const url of [
    'file:///etc/passwd',
    'ftp://example.com/a.png',
    'gopher://example.com/',
    'data:image/png;base64,iVBORw0KGgo=',
  ]) {
    it(`rejects ${url.split(':')[0]}:`, async () => {
      const res = await call(url);
      expect(res.status).toBe(400);
      expect((await body(res)).error).toMatch(/http and https/i);
    });
  }
});

describe('SSRF guard', () => {
  const blocked = [
    ['loopback by IP', 'http://127.0.0.1:3000/a.png'],
    ['loopback by name', 'http://localhost:3000/a.png'],
    ['IPv6 loopback', 'http://[::1]:3000/a.png'],
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['private 10.x', 'http://10.0.0.5/a.png'],
    ['private 192.168.x', 'http://192.168.1.1/a.png'],
    ['private 172.16-31.x', 'http://172.20.0.1/a.png'],
    ['carrier-grade NAT', 'http://100.64.0.1/a.png'],
    ['this-network 0.x', 'http://0.0.0.0/a.png'],
    ['multicast', 'http://239.255.255.250/a.png'],
    ['IPv6 unique-local', 'http://[fd00::1]/a.png'],
    ['IPv6 link-local', 'http://[fe80::1]/a.png'],
    ['IPv4-mapped loopback', 'http://[::ffff:127.0.0.1]/a.png'],
  ] as const;

  for (const [name, url] of blocked) {
    it(`blocks ${name}`, async () => {
      const res = await call(url);
      expect(res.status).toBe(502);
      expect((await body(res)).error).toMatch(/not reachable|could not be resolved/i);
    });
  }

  // Asserted directly rather than through the handler, so no test reaches the
  // network — the handler tests above all short-circuit before fetching.
  it('recognises private addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '192.168.0.1',
      '172.16.0.1',
      '172.31.255.255',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      // The form WHATWG URL parsing actually produces for the line above.
      '::ffff:7f00:1',
      '::ffff:c0a8:1',
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it('lets public addresses through', () => {
    for (const address of [
      '8.8.8.8',
      '1.1.1.1',
      '151.101.1.140',
      '172.15.0.1', // just outside the private 172.16-31 range
      '172.32.0.1', // just outside the other end
      '100.63.0.1', // just outside carrier-grade NAT
      '100.128.0.1',
      '169.253.0.1', // just outside link-local
      '2606:4700::1111',
      '::ffff:8.8.8.8',
    ]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });
});
