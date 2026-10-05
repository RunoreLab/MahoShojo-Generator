// 自 `apps/web/lib/client/fileName.ts` 上移：文件名清洗为纯函数，与运行时无关。

export function buildSafeFileName(base: string, ext: string, fallbackBase = 'file'): string {
  const raw = base.trim() || fallbackBase;
  const cleaned = raw.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80);
  const normalizedExt = ext.replace(/^\./, '').trim() || 'txt';
  return `${cleaned}.${normalizedExt}`;
}
