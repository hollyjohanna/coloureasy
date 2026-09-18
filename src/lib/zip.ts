/**
 * A minimal ZIP writer — stored (uncompressed) entries only.
 *
 * Everything we put in an archive is a PNG, which is already DEFLATE-compressed
 * internally, so deflating again would save nothing and cost a dependency:
 * JSZip is ~100KB for one function. The stored format is short and completely
 * specified by APPNOTE.TXT — a local header per file, a central directory, and
 * an end-of-central-directory record.
 *
 * Deliberately not supported: Zip64 (so a single entry must stay under 4GB,
 * which a PNG of a 2400px image comfortably does), encryption, and unicode path
 * extras beyond the UTF-8 flag.
 */

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;

/** Bit 11 of the general-purpose flags: filename is UTF-8. */
const UTF8_FLAG = 0x800;

export type ZipEntry = {
  name: string;
  // Pinned to ArrayBuffer (rather than the default ArrayBufferLike) because a
  // Blob part cannot be backed by a SharedArrayBuffer.
  data: Uint8Array<ArrayBuffer>;
};

/* ------------------------------------------------------------------- crc32 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/* --------------------------------------------------------------- MS-DOS time */

/** ZIP stores timestamps in the 1980-based MS-DOS format, at 2-second accuracy. */
function dosDateTime(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time:
      (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/* --------------------------------------------------------------------- zip */

export function zip(entries: ZipEntry[], now = new Date()): Blob {
  const { time, date } = dosDateTime(now);
  const encoder = new TextEncoder();

  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const sum = crc32(entry.data);
    const size = entry.data.length;

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL_SIG, true);
    lv.setUint16(4, 20, true); // version needed: 2.0
    lv.setUint16(6, UTF8_FLAG, true);
    lv.setUint16(8, 0, true); // method 0 = stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, sum, true);
    lv.setUint32(18, size, true); // compressed
    lv.setUint32(22, size, true); // uncompressed
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true); // no extra field
    local.set(name, 30);

    parts.push(local, entry.data);

    const header = new Uint8Array(46 + name.length);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, CENTRAL_SIG, true);
    hv.setUint16(4, 20, true); // version made by
    hv.setUint16(6, 20, true); // version needed
    hv.setUint16(8, UTF8_FLAG, true);
    hv.setUint16(10, 0, true); // stored
    hv.setUint16(12, time, true);
    hv.setUint16(14, date, true);
    hv.setUint32(16, sum, true);
    hv.setUint32(20, size, true);
    hv.setUint32(24, size, true);
    hv.setUint16(28, name.length, true);
    hv.setUint16(30, 0, true); // extra
    hv.setUint16(32, 0, true); // comment
    hv.setUint16(34, 0, true); // disk number
    hv.setUint16(36, 0, true); // internal attrs
    hv.setUint32(38, 0, true); // external attrs
    hv.setUint32(42, offset, true); // offset of local header
    header.set(name, 46);

    central.push(header);
    offset += local.length + size;
  }

  const centralSize = central.reduce((n, h) => n + h.length, 0);

  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, END_SIG, true);
  ev.setUint16(4, 0, true); // this disk
  ev.setUint16(6, 0, true); // disk with central directory
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true); // central directory offset
  ev.setUint16(20, 0, true); // comment length

  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
