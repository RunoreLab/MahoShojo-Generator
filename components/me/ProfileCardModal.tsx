'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { BaseModal } from '@/components/shared/BaseModal';
import { ImagePreviewModal } from '@/components/shared/ImagePreviewModal';
import { ProfileCard, type MeProfileCardPayload } from '@/components/me/ProfileCard';
import { authStorage } from '@/lib/auth';
import { revokeBlobUrl } from '@/lib/client/blobUrl';

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

type ApiResponse = {
  success: true;
  profile: MeProfileCardPayload['profile'];
  badges: MeProfileCardPayload['badges'];
  topCards: MeProfileCardPayload['topCards'];
  stats: MeProfileCardPayload['stats'];
  pvp: MeProfileCardPayload['pvp'];
  recentBattleReports: MeProfileCardPayload['recentBattleReports'];
};

type SaveMode = 'download' | 'modal';

function detectDefaultSaveMode(): SaveMode {
  if (typeof window === 'undefined') return 'download';
  return /Mobi/i.test(window.navigator.userAgent) ? 'modal' : 'download';
}

export function ProfileCardModal({ isOpen, onClose }: Props) {
  const [saveMode, setSaveMode] = useState<SaveMode>('download');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setSaveMode(detectDefaultSaveMode());
  }, [isOpen]);

  const query = useQuery({
    queryKey: ['me', 'profile-card'],
    enabled: isOpen,
    queryFn: async (): Promise<ApiResponse> => {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch('/api/me/profile-card', { headers: { Authorization: authHeader } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.error || '加载资料卡数据失败');
      return data as ApiResponse;
    },
    staleTime: 10_000,
  });

  const payload: MeProfileCardPayload | null = useMemo(() => {
    if (!query.data?.success) return null;
    return {
      profile: query.data.profile,
      badges: query.data.badges,
      topCards: query.data.topCards,
      stats: query.data.stats,
      pvp: query.data.pvp,
      recentBattleReports: query.data.recentBattleReports,
    };
  }, [query.data]);

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onClose={onClose}
        title="个人资料卡"
        description="可生成可分享图片：桌面端推荐直接下载；手机端推荐长按保存。"
        maxWidthClassName="max-w-[1120px]"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <span className="font-semibold">保存方式：</span>
              <button
                type="button"
                onClick={() => setSaveMode('download')}
                className={[
                  'rounded-lg border px-3 py-1.5',
                  saveMode === 'download' ? 'border-gray-900 bg-gray-900 text-white' : 'bg-white hover:bg-gray-50',
                ].join(' ')}
              >
                直接下载（电脑推荐）
              </button>
              <button
                type="button"
                onClick={() => setSaveMode('modal')}
                className={[
                  'rounded-lg border px-3 py-1.5',
                  saveMode === 'modal' ? 'border-gray-900 bg-gray-900 text-white' : 'bg-white hover:bg-gray-50',
                ].join(' ')}
              >
                长按保存（手机推荐）
              </button>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
              >
                关闭
              </button>
            </div>
          </div>
        }
      >
        {query.isLoading ? <div className="text-sm text-gray-600">加载中…</div> : null}
        {query.error instanceof Error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{query.error.message}</div>
        ) : null}

        {payload ? (
          <div className="mt-3 overflow-x-auto pb-2">
            <ProfileCard
              data={payload}
              imageSaveMode={saveMode}
              onSaveImage={(url) => {
                setImageUrl((prev) => {
                  revokeBlobUrl(prev);
                  return url;
                });
                setShowImageModal(true);
              }}
            />
          </div>
        ) : null}
      </BaseModal>

      <ImagePreviewModal
        isOpen={showImageModal}
        imageUrl={imageUrl}
        onClose={() => {
          setShowImageModal(false);
          setImageUrl((prev) => {
            revokeBlobUrl(prev);
            return null;
          });
        }}
      />
    </>
  );
}
