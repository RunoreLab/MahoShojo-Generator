// 数据卡字节体积的共享口径。
//
// 自 `apps/web/lib/data-card-size.ts` 上移：云端写入上限、卡槽配额换算与
// JsonSizeIndicator 在 Web/Hosted/Desktop 需要同一份数值。`TextEncoder`
// 在浏览器、WebView 与 Node 均为标准全局，不违反 domain 的无运行时约束。

export const DATA_CARD_SLOT_BYTES = 300 * 1024; // 300KiB per quota slot
export const MAX_DATA_CARD_BYTES = 1024 * 1024; // 1MiB hard cap

export function getUtf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function formatKilobytes(bytes: number): string {
  return (bytes / 1024).toFixed(1);
}
