'use client';

import { useMemo, useRef } from 'react';

import { UserWithTitle } from '@/components/UserTitle';
import type { User } from '@/lib/useAuth';
import type { UserBadge } from '@/types/badge';
import { useLocalProfile } from '@/components/me/useLocalProfile';

function getInitials(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return trimmed.slice(0, 1).toUpperCase();
}

export function ProfileHeader({
  user,
  badges,
  onOpenSettings,
}: {
  user: User;
  badges: UserBadge[];
  onOpenSettings: () => void;
}) {
  const { avatarDataUrl, signature, error, setAvatarFromFile } = useLocalProfile();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const initials = useMemo(() => getInitials(user.username), [user.username]);

  return (
    <div className="mt-3 rounded-2xl border bg-white p-4">
      <div className="flex items-start gap-4">
        <div className="shrink-0">
          <button
            type="button"
            className="group relative h-16 w-16 overflow-hidden rounded-2xl border bg-gradient-to-br from-pink-100 via-purple-100 to-blue-100"
            onClick={() => fileInputRef.current?.click()}
            title="点击上传头像（仅本机保存）"
          >
            {avatarDataUrl ? (
              <img src={avatarDataUrl} alt="头像" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-lg font-bold text-gray-700">
                {initials}
              </div>
            )}
            <div className="pointer-events-none absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setAvatarFromFile(f);
              e.target.value = '';
            }}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <UserWithTitle
              username={user.username}
              prefix={user.prefix}
              badges={badges}
              showBadges={true}
              usernameClassName="font-semibold text-gray-900"
              titleClassName="text-xs"
            />
            <button
              type="button"
              className="rounded-lg border bg-white px-3 py-1.5 text-xs hover:bg-gray-50"
              onClick={onOpenSettings}
            >
              编辑资料
            </button>
          </div>

          <div className="mt-1 text-xs text-gray-600">ID：{user.id}</div>

          <div className="mt-2 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700">
            {signature ? (
              <div className="whitespace-pre-wrap break-words">{signature}</div>
            ) : (
              <div className="text-gray-500">
                还没有个性签名，去「设置」里写一句话吧。
              </div>
            )}
          </div>

          {error ? (
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {error}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
