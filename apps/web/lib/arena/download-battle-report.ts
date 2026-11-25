import { downloadBlob } from '@/lib/client/blobUrl';

type SavePickerWindow = Window & {
  showSaveFilePicker?: (options: { suggestedName: string }) => Promise<FileSystemFileHandle>;
};

export async function downloadBattleReportFile(
  source: Blob | (() => Promise<Blob>),
  filename: string,
): Promise<void> {
  const browser: SavePickerWindow = window;
  let file: FileSystemFileHandle | undefined;

  // Android Edge 取消下载确认后可能丢失后续下载请求。系统文件选择器走独立的保存流程。
  if (/\bEdgA\//i.test(browser.navigator.userAgent) && typeof browser.showSaveFilePicker === 'function') {
    try {
      // 在点击的用户激活期内打开选择器，再执行可能耗时的 ZIP 打包。
      file = await browser.showSaveFilePicker({ suggestedName: filename });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      throw error;
    }
  }

  const blob = typeof source === 'function' ? await source() : source;
  if (!file) {
    downloadBlob(blob, filename);
    return;
  }

  const writable = await file.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
}
