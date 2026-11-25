import { downloadBlob } from '@/lib/client/blobUrl';

type FileSource = Blob | (() => Promise<Blob>);

type SavePickerWindow = Window & {
  showSaveFilePicker?: (options: { suggestedName: string }) => Promise<FileSystemFileHandle>;
};

/** null 让调用方使用原有的浏览器下载入口。 */
export function trySaveWithAndroidEdgePicker(source: FileSource, filename: string): Promise<void> | null {
  const browser: SavePickerWindow = window;
  // Android Edge 取消下载确认后可能丢失后续下载请求。系统文件选择器走独立的保存流程。
  const pickFile = browser.showSaveFilePicker;
  if (!/\bEdgA\//i.test(browser.navigator.userAgent) || typeof pickFile !== 'function') return null;
  return savePickedFile(() => pickFile.call(browser, { suggestedName: filename }), source);
}

export async function downloadFile(source: FileSource, filename: string): Promise<void> {
  const save = trySaveWithAndroidEdgePicker(source, filename);
  if (save) return save;
  const blob = typeof source === 'function' ? await source() : source;
  downloadBlob(blob, filename);
}

async function savePickedFile(pickFile: () => Promise<FileSystemFileHandle>, source: FileSource): Promise<void> {
  let file: FileSystemFileHandle;
  try {
    // 在点击的用户激活期内打开选择器，再读取源文件或打包。
    file = await pickFile();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    throw error;
  }

  const blob = typeof source === 'function' ? await source() : source;
  const writable = await file.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
}
