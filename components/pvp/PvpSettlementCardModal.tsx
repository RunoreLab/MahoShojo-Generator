'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { BaseModal } from '@/components/shared/BaseModal';
import { ImagePreviewModal } from '@/components/shared/ImagePreviewModal';
import { PvpSettlementCard, type PvpSettlementCardPayload } from '@/components/pvp/PvpSettlementCard';
import { authStorage } from '@/lib/auth';
import { revokeBlobUrl } from '@/lib/client/blobUrl';
import { getMainColorGradient, MainColor, MAIN_COLOR_KEYS, type MainColorKey } from '@/lib/main-color';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  roomId: string;
};

type ApiResponse = PvpSettlementCardPayload & { success: true };

type SaveMode = 'download' | 'modal';

function detectDefaultSaveMode(): SaveMode {
  if (typeof window === 'undefined') return 'download';
  return /Mobi/i.test(window.navigator.userAgent) ? 'modal' : 'download';
}

const THEME_STORAGE_KEY = 'pvp:settlement-card:theme';

function readStoredTheme(): MainColorKey {
  if (typeof window === 'undefined') return 'Pink';
  const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
  return raw && raw in MainColor ? (raw as MainColorKey) : 'Pink';
}

function storeTheme(key: MainColorKey) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(THEME_STORAGE_KEY, key);
}

export function PvpSettlementCardModal({ isOpen, onClose, roomId }: Props) {
  const [saveMode, setSaveMode] = useState<SaveMode>('download');
  const [themeKey, setThemeKey] = useState<MainColorKey>('Pink');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setSaveMode(detectDefaultSaveMode());
    setThemeKey(readStoredTheme());
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    storeTheme(themeKey);
  }, [isOpen, themeKey]);

  const query = useQuery({
    queryKey: ['pvp', 'rooms', roomId, 'settlement-card'],
    enabled: isOpen && Boolean(roomId),
    queryFn: async (): Promise<ApiResponse> => {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch(`/api/pvp/rooms/${encodeURIComponent(roomId)}/settlement-card`, {
        headers: { Authorization: authHeader },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.error || '加载结算卡数据失败');
      return data as ApiResponse;
    },
    staleTime: 5_000,
  });

  const payload: PvpSettlementCardPayload | null = useMemo(() => {
    if (!query.data?.success) return null;
    const data = query.data;
    return {
      generatedAt: data.generatedAt,
      room: data.room,
      me: data.me,
      participants: data.participants,
      match: data.match,
      myDeck: data.myDeck,
      myInitialHand: data.myInitialHand,
      rounds: data.rounds,
    };
  }, [query.data]);

  const themeButtons = useMemo(() => {
    return MAIN_COLOR_KEYS.map((key) => {
      const colors = getMainColorGradient(key);
      const active = key === themeKey;
      return (
        <button
          key={key}
          type="button"
          onClick={() => setThemeKey(key)}
          className={[
            'rounded-lg border px-3 py-1.5 text-xs font-semibold',
            active ? 'border-gray-900 bg-gray-900 text-white' : 'bg-white hover:bg-gray-50',
          ].join(' ')}
          title={`切换为：${MainColor[key]}`}
        >
          <span
            className="inline-block h-3 w-3 rounded-full align-middle mr-2"
            style={{ backgroundImage: `linear-gradient(135deg, ${colors.first}, ${colors.second})` }}
          />
          {MainColor[key]}
        </button>
      );
    });
  }, [themeKey]);

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onClose={onClose}
        title="战局结算卡"
        description="可生成可分享图片：桌面端推荐直接下载；手机端推荐长按保存。"
        maxWidthClassName="max-w-[1180px]"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
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
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                <span className="font-semibold">配色：</span>
                {themeButtons}
              </div>
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
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {query.error.message}
          </div>
        ) : null}

        {payload ? (
          <div className="mt-3 overflow-x-auto pb-2">
            <PvpSettlementCard
              data={payload}
              themeKey={themeKey}
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
