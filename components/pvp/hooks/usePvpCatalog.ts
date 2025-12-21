'use client';

import { useQuery } from '@tanstack/react-query';

import { dataCardApi } from '@/lib/auth';

export interface DataCardRow {
  id: string;
  user_id: number;
  type: 'character' | 'scenario';
  name: string;
  description?: string | null;
  data: string;
  is_public: number;
  review_status?: 'pending' | 'approved' | 'rejected' | null;
  updated_at?: string | null;
  username?: string;
}

export interface PresetRow {
  name: string;
  description: string;
  filename: string;
  type: 'magical-girl' | 'canshou';
}

export const useMyCharacterCardsQuery = () =>
  useQuery({
    queryKey: ['pvp', 'my-cards'],
    queryFn: async (): Promise<DataCardRow[]> => {
      const cards = await dataCardApi.getCards();
      return (cards || [])
        .filter((c: any) => c.type === 'character')
        .filter((c: any) => c.deleted_at == null)
        .filter((c: any) => c.review_status !== 'rejected')
        .filter((c: any) => Number(c.is_public) !== -1);
    },
  });

export const usePublicCharacterCardsQuery = () =>
  useQuery({
    queryKey: ['pvp', 'public-cards'],
    queryFn: async (): Promise<DataCardRow[]> => {
      const res = await fetch('/api/public-data-cards?type=character&limit=50&offset=0', { method: 'GET' });
      if (!res.ok) return [];
      const data = await res.json();
      return (data?.cards || [])
        .filter((c: any) => c.deleted_at == null)
        .filter((c: any) => c.review_status !== 'rejected')
        .filter((c: any) => Number(c.is_public) !== -1);
    },
  });

export const usePresetsQuery = () =>
  useQuery({
    queryKey: ['pvp', 'presets'],
    queryFn: async (): Promise<PresetRow[]> => {
      const res = await fetch('/api/get-presets', { method: 'GET' });
      if (!res.ok) return [];
      return (await res.json()) as PresetRow[];
    },
  });

