'use client';

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { normalizeProfileSignature } from '@mahoshojo/ui-web/settings';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { authStorage } from '@/lib/auth';
import { getAuthSnapshot, subscribeAuthSnapshot } from '@/lib/auth-client-store';
import { dispatchMeProfileAvatarUpdated } from '@/lib/me-profile-events';

export type MeProfile = {
  signature: string;
  avatarDataUrl: string | null;
};

type ProfileApiResponse = {
  success: boolean;
  profile: MeProfile;
};

function readProfileResponse(data: unknown, maxLength = 1024): ProfileApiResponse {
  const result = data as Partial<ProfileApiResponse> | null;
  if (result?.success !== true || typeof result.profile?.signature !== 'string'
    || result.profile.signature.length > maxLength
    || (result.profile.avatarDataUrl !== null && typeof result.profile.avatarDataUrl !== 'string')) {
    throw new Error('服务端未确认个人资料，请刷新后重试');
  }
  return result as ProfileApiResponse;
}
const AVATAR_SIZE = 128;
const AVATAR_WEBP_QUALITY = 0.82;
const MAX_AVATAR_BASE64_LENGTH = 350_000;

async function authedFetch(path: string, init?: RequestInit) {
  const res = await authStorage.fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || '请求失败');
  return data as any;
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

function dataUrlToImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('解析图片失败'));
    img.src = dataUrl;
  });
}

function canvasToWebpDataUrl(canvas: HTMLCanvasElement) {
  const out = canvas.toDataURL('image/webp', AVATAR_WEBP_QUALITY);
  if (!out.startsWith('data:image/webp')) {
    throw new Error('当前浏览器不支持生成 WebP 头像，请尝试使用 Chrome/Edge');
  }
  return out;
}

async function compressAvatarToWebpBase64InBrowser(file: File) {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
  const dataUrl = await fileToDataUrl(file);
  const img = await dataUrlToImage(dataUrl);

  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持 Canvas');

  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  const size = Math.min(sw, sh);
  const sx = Math.floor((sw - size) / 2);
  const sy = Math.floor((sh - size) / 2);

  ctx.clearRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  ctx.drawImage(img, sx, sy, size, size, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

  const out = canvasToWebpDataUrl(canvas);
  const base64 = out.replace(/^data:image\/webp;base64,/, '');
  if (base64.length > MAX_AVATAR_BASE64_LENGTH) {
    throw new Error('头像体积过大，建议换一张更小的图片');
  }
  return base64;
}

export function useMeProfile(userId: number | null) {
  const queryClient = useQueryClient();
  // user 对象在每次成功登录时更新（含同账号重登），徽章刷新保留它。
  const authIdentity = useSyncExternalStore(subscribeAuthSnapshot, () => getAuthSnapshot().user, () => null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const owner = useRef({ userId, authIdentity, epoch: 0 });
  if (owner.current.userId !== userId || owner.current.authIdentity !== authIdentity) {
    owner.current = { userId, authIdentity, epoch: owner.current.epoch + 1 };
  }
  const currentOwner = owner.current;
  const isCurrentOwner = (initiatedBy: typeof currentOwner) => mounted.current && owner.current === initiatedBy
    && getAuthSnapshot().user === initiatedBy.authIdentity;
  const queryKey = useMemo(() => ['me-profile', userId] as const, [userId]);

  const profileQuery = useQuery({
    queryKey,
    enabled: Boolean(userId),
    queryFn: async ({ signal }) => {
      const data = await authedFetch('/api/me/profile', { method: 'GET', signal });
      if (!isCurrentOwner(currentOwner)) throw new Error('账号已变化，请重新载入资料');
      return readProfileResponse(data);
    },
    staleTime: 5_000,
  });

  const saveSignatureMutation = useMutation({
    // 不继承全局 mutation 重试策略：失败/未知结果只由用户显式重试。
    retry: false,
    mutationFn: async ({ signature, initiatedBy }: { signature: string; initiatedBy: typeof currentOwner }) => {
      if (initiatedBy.userId === null || initiatedBy.authIdentity?.id !== initiatedBy.userId || !isCurrentOwner(initiatedBy)) throw new Error('账号已变化，请重新载入资料');
      const key = ['me-profile', initiatedBy.userId] as const;
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      if (!isCurrentOwner(initiatedBy)) throw new Error('账号已变化，请重新载入资料');
      const data = readProfileResponse(await authedFetch('/api/me/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature: normalizeProfileSignature(signature) }),
      }), 120);
      if (!isCurrentOwner(initiatedBy)) throw new Error('账号已变化，旧请求结果已忽略');
      // 截住写入期间启动的 refetch，避免旧 GET 晚到覆盖已确认写入。
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      if (!isCurrentOwner(initiatedBy)) throw new Error('账号已变化，旧请求结果已忽略');
      queryClient.setQueryData(key, data);
      return data;
    },
  });

  const uploadAvatarMutation = useMutation({
    mutationFn: async (file: File) => {
      const avatarWebpBase64 = await compressAvatarToWebpBase64InBrowser(file);
      const data = await authedFetch('/api/me/profile/avatar', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarWebpBase64 }),
      });
      return data as { success: boolean; avatarDataUrl: string };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, (prev: ProfileApiResponse | undefined) => {
        const prevProfile = prev?.profile ?? { signature: '', avatarDataUrl: null };
        return { success: true, profile: { ...prevProfile, avatarDataUrl: data.avatarDataUrl } };
      });
      if (typeof userId === 'number' && userId > 0) {
        dispatchMeProfileAvatarUpdated({ userId, avatarDataUrl: data.avatarDataUrl });
      }
    },
  });

  const clearAvatarMutation = useMutation({
    mutationFn: async () => {
      const data = await authedFetch('/api/me/profile/avatar', { method: 'DELETE' });
      return data as { success: boolean };
    },
    onSuccess: () => {
      queryClient.setQueryData(queryKey, (prev: ProfileApiResponse | undefined) => {
        const prevProfile = prev?.profile ?? { signature: '', avatarDataUrl: null };
        return { success: true, profile: { ...prevProfile, avatarDataUrl: null } };
      });
      if (typeof userId === 'number' && userId > 0) {
        dispatchMeProfileAvatarUpdated({ userId, avatarDataUrl: null });
      }
    },
  });

  const profile: MeProfile = profileQuery.data?.profile ?? { signature: '', avatarDataUrl: null };
  const error =
    (profileQuery.error instanceof Error ? profileQuery.error.message : null) ||
    (uploadAvatarMutation.error instanceof Error ? uploadAvatarMutation.error.message : null) ||
    (clearAvatarMutation.error instanceof Error ? clearAvatarMutation.error.message : null);

  return {
    profile,
    loaded: profileQuery.data !== undefined,
    signatureScope: userId === null ? null : `web:${userId}:${currentOwner.epoch}`,
    isLoading: profileQuery.isLoading,
    error,

    setSignatureOptimistic: (signature: string) => {
      const capped = normalizeProfileSignature(signature);
      queryClient.setQueryData(queryKey, (prev: ProfileApiResponse | undefined) => {
        const prevProfile = prev?.profile ?? { signature: '', avatarDataUrl: null };
        return { success: true, profile: { ...prevProfile, signature: capped } };
      });
    },
    saveSignature: (signature: string) => saveSignatureMutation.mutateAsync({ signature, initiatedBy: currentOwner }),
    isSavingSignature: saveSignatureMutation.variables?.initiatedBy === currentOwner && saveSignatureMutation.isPending,

    uploadAvatar: (file: File) => uploadAvatarMutation.mutateAsync(file),
    isUploadingAvatar: uploadAvatarMutation.isPending,
    clearAvatar: () => clearAvatarMutation.mutateAsync(),
    isClearingAvatar: clearAvatarMutation.isPending,

    refetch: () => profileQuery.refetch(),
  };
}
