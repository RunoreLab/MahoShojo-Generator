/** Display text only. Original titles stay untouched in records, story content and exports. */
const DISPLAY_TITLE_UTF8_BYTES = 192;
const SHORTENED_SUFFIX = '…（标题已缩短）';
// All characters in this suffix occupy three bytes in UTF-8.
const SHORTENED_SUFFIX_BYTES = SHORTENED_SUFFIX.length * 3;

function prefixEnd(value: string, byteBudget: number): number {
  let end = 0;
  let bytes = 0;
  // Bounded by the display budget, even when the original title is several MiB.
  while (end < value.length) {
    const codePoint = value.codePointAt(end)!;
    const width = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (bytes + width > byteBudget) break;
    bytes += width;
    end += codePoint > 0xffff ? 2 : 1;
  }
  return end;
}

/** At most 192 UTF-8 bytes INCLUDING the explicit shortening marker; never encodes the full input. */
export function formatBattleStoryDisplayTitle(value: string): string {
  if (prefixEnd(value, DISPLAY_TITLE_UTF8_BYTES) === value.length) return value;
  return `${value.slice(0, prefixEnd(value, DISPLAY_TITLE_UTF8_BYTES - SHORTENED_SUFFIX_BYTES))}${SHORTENED_SUFFIX}`;
}
