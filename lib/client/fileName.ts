export function buildSafeFileName(base: string, ext: string, fallbackBase = 'file'): string {
  const raw = base.trim() || fallbackBase;
  const cleaned = raw.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80);
  const normalizedExt = ext.replace(/^\./, '').trim() || 'txt';
  return `${cleaned}.${normalizedExt}`;
}

