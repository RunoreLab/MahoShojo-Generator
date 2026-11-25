// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { downloadBattleReportFile } from '@/lib/arena/download-battle-report';
import { downloadBlob } from '@/lib/client/blobUrl';

vi.mock('@/lib/client/blobUrl', () => ({ downloadBlob: vi.fn() }));

const ANDROID_EDGE = 'Mozilla/5.0 (Linux; Android 10; K) EdgA/151.0.0.0';

afterEach(() => vi.unstubAllGlobals());

it('Android Edge 在点击时打开选择器，取消时跳过 ZIP 打包和下载', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ANDROID_EDGE);
  const showSaveFilePicker = vi.fn().mockRejectedValue(new DOMException('Picker closed', 'AbortError'));
  vi.stubGlobal('showSaveFilePicker', showSaveFilePicker);
  const packZip = vi.fn();

  const attempt = downloadBattleReportFile(packZip, 'package.zip');
  expect(showSaveFilePicker).toHaveBeenCalledWith({ suggestedName: 'package.zip' });
  await attempt;
  expect(packZip).not.toHaveBeenCalled();
  expect(downloadBlob).not.toHaveBeenCalled();
});

it.each([
  [ANDROID_EDGE, undefined],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/151.0.0.0', vi.fn()],
] as const)('没有适用的保存选择器时继续使用浏览器下载', async (userAgent, picker) => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  vi.stubGlobal('showSaveFilePicker', picker);
  const blob = new Blob(['战报']);

  await downloadBattleReportFile(blob, '战报.md');
  if (picker) expect(picker).not.toHaveBeenCalled();
  expect(downloadBlob).toHaveBeenCalledWith(blob, '战报.md');
});

it('写入失败会放弃未提交的写入，下一次仍可保存', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ANDROID_EDGE);
  const error = new DOMException('Cannot write', 'NotAllowedError');
  const write = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);
  const abort = vi.fn().mockResolvedValue(undefined);
  const showSaveFilePicker = vi.fn().mockResolvedValue({
    createWritable: vi.fn().mockResolvedValue({ write, close, abort }),
  });
  vi.stubGlobal('showSaveFilePicker', showSaveFilePicker);
  const blob = new Blob(['战报']);

  await expect(downloadBattleReportFile(blob, '战报.md')).rejects.toBe(error);
  expect(abort).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
  await downloadBattleReportFile(blob, '战报.md');
  expect(showSaveFilePicker).toHaveBeenCalledTimes(2);
  expect(write).toHaveBeenLastCalledWith(blob);
  expect(close).toHaveBeenCalledOnce();
  expect(downloadBlob).not.toHaveBeenCalled();
});
