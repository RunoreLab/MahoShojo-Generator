import { useEffect, useState } from 'react';

import { authStorage } from '@/lib/auth';
import {
  ME_PROFILE_AVATAR_UPDATED_EVENT,
  type MeProfileAvatarUpdatedDetail,
} from '@/lib/me-profile-events';

type TopBarProfileResponse = {
  success?: boolean;
  profile?: {
    avatarDataUrl?: unknown;
  };
};

const avatarCache = new Map<number, string | null>();

const normalizeAvatarDataUrl = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

export function useTopBarProfile(userId: number | null, enabled: boolean) {
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(() => {
    if (!enabled || !userId) return null;
    return avatarCache.get(userId) ?? null;
  });

  useEffect(() => {
    if (!enabled || !userId) {
      setAvatarDataUrl(null);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    let updatedFromEvent = false;

    const handleAvatarUpdated = (event: Event) => {
      const detail = (event as CustomEvent<MeProfileAvatarUpdatedDetail>).detail;
      if (!detail || detail.userId !== userId) {
        return;
      }

      updatedFromEvent = true;
      const nextAvatarDataUrl = normalizeAvatarDataUrl(detail.avatarDataUrl);
      avatarCache.set(userId, nextAvatarDataUrl);
      setAvatarDataUrl(nextAvatarDataUrl);
    };

    window.addEventListener(ME_PROFILE_AVATAR_UPDATED_EVENT, handleAvatarUpdated);

    const cachedAvatar = avatarCache.get(userId);
    if (cachedAvatar !== undefined) {
      setAvatarDataUrl(cachedAvatar);
      return () => {
        cancelled = true;
        controller.abort();
        window.removeEventListener(ME_PROFILE_AVATAR_UPDATED_EVENT, handleAvatarUpdated);
      };
    }

    void (async () => {
      try {
        const response = await authStorage.fetch('/api/me/profile', {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Failed to load topbar profile: ${response.status}`);
        }
        const data = (await response.json().catch(() => null)) as TopBarProfileResponse | null;
        const nextAvatarDataUrl = normalizeAvatarDataUrl(data?.profile?.avatarDataUrl);

        avatarCache.set(userId, nextAvatarDataUrl);
        if (!cancelled && !updatedFromEvent) {
          setAvatarDataUrl(nextAvatarDataUrl);
        }
      } catch {
        if (controller.signal.aborted || cancelled) {
          return;
        }
        setAvatarDataUrl(null);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      window.removeEventListener(ME_PROFILE_AVATAR_UPDATED_EVENT, handleAvatarUpdated);
    };
  }, [enabled, userId]);

  return { avatarDataUrl };
}
