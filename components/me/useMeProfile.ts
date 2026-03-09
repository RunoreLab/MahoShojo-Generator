'use client';

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { authStorage } from '@/lib/auth';

export type MeProfile = {
  signature: string;
  avatarDataUrl: string | null;
};

type ProfileApiResponse = {
  success: boolean;
  profile: MeProfile;
};

const MAX_SIGNATURE_LENGTH = 120;
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
  const queryKey = useMemo(() => ['me-profile', userId] as const, [userId]);

  const profileQuery = useQuery({
    queryKey,
    enabled: Boolean(userId),
    queryFn: async () => {
      const data = await authedFetch('/api/me/profile', { method: 'GET' });
      return data as ProfileApiResponse;
    },
    staleTime: 5_000,
  });

  const saveSignatureMutation = useMutation({
    mutationFn: async (signature: string) => {
      const capped = signature.replace(/\r\n/g, '\n').slice(0, MAX_SIGNATURE_LENGTH);
      const data = await authedFetch('/api/me/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature: capped }),
      });
      return data as ProfileApiResponse;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
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
    },
  });

  const profile: MeProfile = profileQuery.data?.profile ?? { signature: '', avatarDataUrl: null };
  const error =
    (profileQuery.error instanceof Error ? profileQuery.error.message : null) ||
    (saveSignatureMutation.error instanceof Error ? saveSignatureMutation.error.message : null) ||
    (uploadAvatarMutation.error instanceof Error ? uploadAvatarMutation.error.message : null) ||
    (clearAvatarMutation.error instanceof Error ? clearAvatarMutation.error.message : null);

  return {
    profile,
    loaded: profileQuery.isFetched,
    isLoading: profileQuery.isLoading,
    error,

    setSignatureOptimistic: (signature: string) => {
      const capped = signature.replace(/\r\n/g, '\n').slice(0, MAX_SIGNATURE_LENGTH);
      queryClient.setQueryData(queryKey, (prev: ProfileApiResponse | undefined) => {
        const prevProfile = prev?.profile ?? { signature: '', avatarDataUrl: null };
        return { success: true, profile: { ...prevProfile, signature: capped } };
      });
    },
    saveSignature: (signature: string) => saveSignatureMutation.mutateAsync(signature),
    isSavingSignature: saveSignatureMutation.isPending,

    uploadAvatar: (file: File) => uploadAvatarMutation.mutateAsync(file),
    isUploadingAvatar: uploadAvatarMutation.isPending,
    clearAvatar: () => clearAvatarMutation.mutateAsync(),
    isClearingAvatar: clearAvatarMutation.isPending,

    refetch: () => profileQuery.refetch(),
  };
}
