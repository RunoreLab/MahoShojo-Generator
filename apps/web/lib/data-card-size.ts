export const DATA_CARD_SLOT_BYTES = 300 * 1024; // 300KiB per quota slot
export const MAX_DATA_CARD_BYTES = 1024 * 1024; // 1MiB hard cap

export function getUtf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function formatKilobytes(bytes: number): string {
  return (bytes / 1024).toFixed(1);
}
