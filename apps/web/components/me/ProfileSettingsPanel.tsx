'use client';

import { useMemo } from 'react';
import { ProfileSignatureField, useProfileSignatureEditor } from '@mahoshojo/ui-web/settings';

import { useUnsavedPageGuard } from '@mahoshojo/ui-web/client';

import { useMeProfile } from '@/components/me/useMeProfile';

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, idx);
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export function ProfileSettingsPanel({ userId }: { userId: number | null }) {
  const {
    profile,
    error,
    saveSignature,
    loaded,
    signatureScope,
    refetch,
    uploadAvatar,
    isUploadingAvatar,
    clearAvatar,
    isClearingAvatar,
  } = useMeProfile(userId);

  const avatarSize = useMemo(
    () => (profile.avatarDataUrl ? formatBytes(profile.avatarDataUrl.length) : null),
    [profile.avatarDataUrl],
  );
  const editor = useProfileSignatureEditor({
    scope: signatureScope ?? (userId === null ? null : `web:${userId}`),
    signature: loaded ? profile.signature : undefined,
    canSave: userId !== null,
    save: async (signature) => (await saveSignature(signature)).profile.signature,
  });

  useUnsavedPageGuard(() => editor.dirty || editor.saving, editor.saving
    ? '签名保存请求仍在进行，离开不会撤销请求，服务端仍可能保存。确认离开？'
    : '个性签名尚未保存。确认放弃当前草稿并离开？', () => !editor.saving);

  if (!userId) {
    return (
      <div className="rounded-2xl border bg-white p-4 text-sm text-gray-700">
        你尚未登录，无法保存个人资料。
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-gray-900">个人资料</div>
          <div className="mt-1 text-xs text-gray-500">
            头像与签名保存到数据库；上传头像会在后端压缩为 128×128 WebP（质量约 80–85）再入库。
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4">
        <div>
          <div className="text-sm font-medium text-gray-900">头像</div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <div className="h-14 w-14 overflow-hidden rounded-2xl border bg-gradient-to-br from-pink-100 via-purple-100 to-blue-100">
              {profile.avatarDataUrl ? (
                <img src={profile.avatarDataUrl} alt="头像预览" className="h-full w-full object-cover" />
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
                  uploadAvatar(f).catch(() => {});
                  e.target.value = '';
                }}
                disabled={isUploadingAvatar || isClearingAvatar}
              />
              <div className="mt-1 text-xs text-gray-500">
                建议方形图片；服务端会裁剪+压缩。{avatarSize ? `当前约：${avatarSize}` : ''}
              </div>
            </div>

            <button
              type="button"
              className="rounded-lg border bg-white px-3 py-2 text-xs hover:bg-gray-50 disabled:opacity-50"
              onClick={() => clearAvatar().catch(() => {})}
              disabled={!profile.avatarDataUrl || isUploadingAvatar || isClearingAvatar}
            >
              清除头像
            </button>
          </div>
        </div>

        <ProfileSignatureField editor={editor} />
        {(editor.error || (!loaded && error)) && <div className="text-xs text-gray-500">
          请求中断时服务端仍可能已保存；可先读取线上签名核对，再决定是否重试。
          <button type="button" className="ml-2 underline" disabled={editor.saving} onClick={() => void refetch()}>读取线上签名</button>
        </div>}
      </div>

      {error ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</div>
      ) : null}
    </div>
  );
}
