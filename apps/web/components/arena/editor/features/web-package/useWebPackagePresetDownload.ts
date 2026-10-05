'use client';

import { useCallback, useRef, useState } from 'react';
import { BUILTIN_WEB_PACKAGE_PRESETS, packWebPackageZip, resolveWebPackage } from '@mahoshojo/web-package';

import { downloadBlob } from '@/lib/client/blobUrl';
import { buildSafeFileName } from '@/lib/client/fileName';

/**
 * 下载是本地操作，不修改 editor 选择；只读与多人工作台也可使用。
 *
 * 忙态按 digest 记录而不是一个全局布尔：预设网格一次给出多张卡片，只有正在
 * 导出的那张需要转圈，其余卡片的下载入口必须保持可用。
 */
export const useWebPackagePresetDownload = () => {
  const busyDigestRef = useRef<string | null>(null);
  const [downloadingDigest, setDownloadingDigest] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const downloadPreset = useCallback(async (digest: string) => {
    if (busyDigestRef.current !== null) return;
    busyDigestRef.current = digest;
    setDownloadingDigest(digest);
    setDownloadError(null);
    try {
      const preset = BUILTIN_WEB_PACKAGE_PRESETS.find((item) => item.packageRef.digest === digest);
      if (!preset) throw new Error('未找到预设');
      const base = await resolveWebPackage(preset.packageRef);
      const archive = await packWebPackageZip(base);
      downloadBlob(
        new Blob([archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer], { type: 'application/zip' }),
        buildSafeFileName(`${base.manifest.id}@${base.manifest.version}`, 'zip', 'mahoshojo-web-package'),
      );
    } catch {
      setDownloadError('Web 包下载失败，请稍后重试。');
    } finally {
      busyDigestRef.current = null;
      setDownloadingDigest(null);
    }
  }, []);

  return { downloadingDigest, downloadError, downloadPreset };
};
