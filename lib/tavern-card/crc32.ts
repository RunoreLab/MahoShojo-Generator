const CRC32_POLY = 0xedb88320;

let crcTable: Uint32Array | null = null;

const getCrcTable = (): Uint32Array => {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = (c & 1) ? (CRC32_POLY ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  crcTable = table;
  return table;
};

export function crc32(bytes: Uint8Array, seed = 0xffffffff): number {
  const table = getCrcTable();
  let crc = seed >>> 0;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return crc >>> 0;
}

export function crc32Finish(crc: number): number {
  return (crc ^ 0xffffffff) >>> 0;
}

export function crc32Concat(parts: Uint8Array[]): number {
  let crc = 0xffffffff;
  for (const part of parts) {
    crc = crc32(part, crc);
  }
  return crc32Finish(crc);
}

