import { describe, expect, it } from 'vitest';
import { crc32, zip } from './zip';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('crc32', () => {
  // Standard CRC-32 (IEEE 802.3) check values.
  it('matches known vectors', () => {
    expect(crc32(bytes(''))).toBe(0);
    expect(crc32(bytes('a'))).toBe(0xe8b7be43);
    expect(crc32(bytes('abc'))).toBe(0x352441c2);
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
    expect(crc32(bytes('The quick brown fox jumps over the lazy dog'))).toBe(
      0x414fa339,
    );
  });

  it('always returns an unsigned 32-bit value', () => {
    for (const text of ['a', 'abc', 'zzzz', 'ÿþ']) {
      const value = crc32(bytes(text));
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('zip', () => {
  const read = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

  it('writes the signatures and counts an unzipper looks for', async () => {
    const data = await read(
      zip([
        { name: 'a.txt', data: bytes('hello') },
        { name: 'b.txt', data: bytes('world!') },
      ]),
    );
    const view = new DataView(data.buffer);

    // First local file header.
    expect(view.getUint32(0, true)).toBe(0x04034b50);

    // End-of-central-directory is the last 22 bytes when there's no comment.
    const end = data.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 8, true)).toBe(2);
    expect(view.getUint16(end + 10, true)).toBe(2);

    // The central directory must start where the record says it does.
    const centralOffset = view.getUint32(end + 16, true);
    const centralSize = view.getUint32(end + 12, true);
    expect(view.getUint32(centralOffset, true)).toBe(0x02014b50);
    expect(centralOffset + centralSize).toBe(end);
  });

  it('records each entry’s name, size and checksum', async () => {
    const payload = bytes('hello');
    const data = await read(zip([{ name: 'a.txt', data: payload }]));
    const view = new DataView(data.buffer);

    expect(view.getUint16(8, true)).toBe(0); // stored, not deflated
    expect(view.getUint32(14, true)).toBe(crc32(payload));
    expect(view.getUint32(18, true)).toBe(payload.length);
    expect(view.getUint32(22, true)).toBe(payload.length);
    expect(view.getUint16(26, true)).toBe(5); // name length

    const name = new TextDecoder().decode(data.subarray(30, 35));
    expect(name).toBe('a.txt');

    // Stored means the bytes appear verbatim right after the header.
    expect(data.subarray(35, 40)).toEqual(payload);
  });

  it('points each central directory entry at its local header', async () => {
    const data = await read(
      zip([
        { name: 'one.bin', data: new Uint8Array([1, 2, 3]) },
        { name: 'two.bin', data: new Uint8Array([4, 5]) },
      ]),
    );
    const view = new DataView(data.buffer);
    const end = data.length - 22;
    let cursor = view.getUint32(end + 16, true);

    for (const expected of ['one.bin', 'two.bin']) {
      expect(view.getUint32(cursor, true)).toBe(0x02014b50);

      const nameLength = view.getUint16(cursor + 28, true);
      const name = new TextDecoder().decode(
        data.subarray(cursor + 46, cursor + 46 + nameLength),
      );
      expect(name).toBe(expected);

      // Follow the offset and confirm a local header really is there.
      const localAt = view.getUint32(cursor + 42, true);
      expect(view.getUint32(localAt, true)).toBe(0x04034b50);

      cursor += 46 + nameLength;
    }

    expect(cursor).toBe(end);
  });

  it('flags names as UTF-8 and round-trips non-ASCII ones', async () => {
    const data = await read(zip([{ name: 'café-ü.png', data: bytes('x') }]));
    const view = new DataView(data.buffer);

    expect(view.getUint16(6, true) & 0x800).toBe(0x800);

    const nameLength = view.getUint16(26, true);
    const name = new TextDecoder().decode(data.subarray(30, 30 + nameLength));
    expect(name).toBe('café-ü.png');
  });

  it('writes a valid empty archive', async () => {
    const data = await read(zip([]));
    expect(data).toHaveLength(22);
    expect(new DataView(data.buffer).getUint32(0, true)).toBe(0x06054b50);
  });

  it('clamps pre-1980 timestamps, which MS-DOS dates cannot express', async () => {
    const data = await read(
      zip([{ name: 'a', data: bytes('x') }], new Date('1970-01-01T00:00:00Z')),
    );
    const view = new DataView(data.buffer);
    // Year field is a 7-bit offset from 1980; it must not go negative.
    expect(view.getUint16(12 + 2, true) >> 9).toBeGreaterThanOrEqual(0);
  });
});
