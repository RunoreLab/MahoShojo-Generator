// Blob/ObjectURL 下载的浏览器平台实现。
//
// 自 `apps/web/lib/client/blobUrl.ts` 上移：WebView（含 Tauri）对这些 Web
// 标准 API 的支持一致，共享组件直接复用，无需各端注入。

export function isBlobUrl(url: string): boolean {
  return url.startsWith('blob:');
}

export function revokeBlobUrl(url: string | null | undefined): void {
  if (!url) return;
  if (!isBlobUrl(url)) return;
  URL.revokeObjectURL(url);
}

export function createBlobUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
