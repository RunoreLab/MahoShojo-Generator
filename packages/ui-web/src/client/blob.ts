// Blob/ObjectURL 下载的浏览器平台实现。
//
// 自 `apps/web/lib/client/blobUrl.ts` 上移，作为 Web 的缺省下载通道。
// WebView 可使用相同标准 API，但对象 URL 生命周期由宿主决定；例如 Desktop
// 的 JSON 导出注入 downloadTextFile，保留 WebView2 所需的 60 秒延迟。

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
