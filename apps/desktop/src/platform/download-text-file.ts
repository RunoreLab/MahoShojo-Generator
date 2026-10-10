/**
 * 文本文件的浏览器下载通道。
 *
 * WebView 的 `<a download>` 走 WebView2 原生下载流程（保存对话框由系统弹出），
 * 不需要新增 native command 或文件系统权限——与导入侧 `<input type="file">`
 * 不扩张 command ACL 的口径一致（`DESK-071b`）。
 *
 * 对象 URL 的释放故意延迟而不是立刻 `revokeObjectURL`：click 之后 WebView 才
 * 开始读取 blob，同步 revoke 会让部分 WebView2 版本拿到空文件。
 */
export const downloadTextFile = (fileName: string, text: string, mimeType = 'application/json'): void => {
  downloadBlobFile(fileName, new Blob([text], { type: mimeType }));
};

/** Main UI only: preserves the same browser/OS download boundary, with no arbitrary-path IPC. */
export const downloadBinaryFile = (fileName: string, bytes: Uint8Array, mimeType: string): void => {
  downloadBlobFile(fileName, new Blob([new Uint8Array(bytes).buffer], { type: mimeType }));
};

const downloadBlobFile = (fileName: string, blob: Blob): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
};
