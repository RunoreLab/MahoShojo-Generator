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
