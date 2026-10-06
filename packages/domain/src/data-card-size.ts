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

/**
 * `text` 的 UTF-8 编码字节数是否超过 `maxBytes`：逐码点累加、超限即返回。
 *
 * 不用 `getUtf8ByteLength`（`TextEncoder().encode`）：那会为超大输入先分配一份
 * 等长缓冲，而字节上限的意义正是赶在 `JSON.parse` 与任何 buffering 之前拦住
 * 这种输入（bounded-input）。孤立代理项按 `TextEncoder` 语义计作 U+FFFD 的
 * 3 字节，保证与落盘/IPC 侧的字节口径一致。
 */
export function exceedsUtf8ByteLimit(text: string, maxBytes: number): boolean {
  // UTF-8 字节数恒不小于 UTF-16 码元数：先用 O(1) 拦住最明显的大输入。
  if (text.length > maxBytes) return true;
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit < 0x80) {
      bytes += 1;
    } else if (unit < 0x800) {
      bytes += 2;
    } else if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < text.length
      && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
    if (bytes > maxBytes) return true;
  }
  return false;
}

export function formatKilobytes(bytes: number): string {
  return (bytes / 1024).toFixed(1);
}
