export const MAX_DATA_CARD_BYTES = 300 * 1024; // 300KB

export function getUtf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function formatKilobytes(bytes: number): string {
  return (bytes / 1024).toFixed(1);
}

