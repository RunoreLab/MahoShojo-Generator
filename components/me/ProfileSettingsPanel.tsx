'use client';

import { useMemo } from 'react';

import { useLocalProfile } from '@/components/me/useLocalProfile';

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, idx);
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export function ProfileSettingsPanel() {
  const { avatarDataUrl, signature, error, setSignature, setAvatarFromFile, clearAvatar, clearSignature } =
    useLocalProfile();

  const avatarSize = useMemo(() => (avatarDataUrl ? formatBytes(avatarDataUrl.length) : null), [avatarDataUrl]);
  const count = signature.length;

  return (
    <div className="rounded-2xl border bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-gray-900">个人资料</div>
          <div className="mt-1 text-xs text-gray-500">
            头像与签名暂存于 localStorage，清理浏览器数据/更换设备后将丢失。
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4">
        <div>
          <div className="text-sm font-medium text-gray-900">头像</div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <div className="h-14 w-14 overflow-hidden rounded-2xl border bg-gradient-to-br from-pink-100 via-purple-100 to-blue-100">
              {avatarDataUrl ? (
                <img src={avatarDataUrl} alt="头像预览" className="h-full w-full object-cover" />
              ) : null}
            </div>

            <div className="flex-1 min-w-[220px]">
              <input
                type="file"
                accept="image/*"
                className="input-field file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setAvatarFromFile(f);
                  e.target.value = '';
                }}
              />
              <div className="mt-1 text-xs text-gray-500">
                建议方形图片；会自动裁剪到正方形并压缩。{avatarSize ? `当前约：${avatarSize}` : ''}
              </div>
            </div>

            <button
              type="button"
              className="rounded-lg border bg-white px-3 py-2 text-xs hover:bg-gray-50 disabled:opacity-50"
              onClick={clearAvatar}
              disabled={!avatarDataUrl}
            >
              清除头像
            </button>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-gray-900">个性签名</div>
            <div className="text-xs text-gray-500">{count}/120</div>
          </div>
          <textarea
            className="input-field mt-2 min-h-[90px] resize-y"
            placeholder="写一句你想展示的话…（最多 120 字）"
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="text-xs text-gray-500">提示：支持换行；内容会即时保存到当前浏览器。</div>
            <button
              type="button"
              className="rounded-lg border bg-white px-3 py-2 text-xs hover:bg-gray-50 disabled:opacity-50"
              onClick={clearSignature}
              disabled={!signature}
            >
              清空签名
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</div>
      ) : null}
    </div>
  );
}
