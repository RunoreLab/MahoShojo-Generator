import type { MouseEvent } from 'react';
import { trySaveWithAndroidEdgePicker } from './downloadFile';

export function handleCharacterPresetDownloadClick(event: MouseEvent<HTMLAnchorElement>): void {
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;

  const href = event.currentTarget.getAttribute('href');
  if (!href) return;

  const save = trySaveWithAndroidEdgePicker(async () => {
    const response = await fetch(href, { credentials: 'omit', redirect: 'error' });
    if (!response.ok) throw new Error('无法读取预设角色原件');
    return response.blob();
  }, event.currentTarget.download);

  if (save) {
    event.preventDefault();
    void save.catch(() => window.alert('下载预设角色失败，请重试。'));
  }
}
