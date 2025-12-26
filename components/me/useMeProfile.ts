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

async function authedFetch(path: string, init?: RequestInit) {
  const authHeader = await authStorage.getAuthHeader();
  if (!authHeader) throw new Error('未登录');
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: authHeader,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || '请求失败');
  return data as any;
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
      const fd = new FormData();
      fd.set('file', file);
      const data = await authedFetch('/api/me/profile/avatar', { method: 'PUT', body: fd });
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

