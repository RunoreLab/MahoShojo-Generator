'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { config as appConfig } from '@/lib/config';
import type { Preset } from '@/lib/presets';
import type { ScenarioPreset } from '@/lib/scenario-presets';
import type { StatsData } from '@/app/api/get-stats/handler';

import { LanguageOption, PresetCollections } from '../types';

const fetcher = async <T>(url: string): Promise<T> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`无法从 ${url} 读取数据`);
  }
  return response.json();
};

export const usePresetQuery = () => {
  const query = useQuery<Preset[]>({
    queryKey: ['arena', 'presets'],
    queryFn: () => fetcher('/api/get-presets'),
  });

  const grouped = useMemo<PresetCollections | null>(() => {
    if (!query.data) return null;
    return {
      magicalGirl: query.data.filter((preset) => preset.type === 'magical-girl'),
      canshou: query.data.filter((preset) => preset.type === 'canshou'),
    };
  }, [query.data]);

  return { ...query, grouped };
};

export const useStatsQuery = () => {
  return useQuery<StatsData>({
    queryKey: ['arena', 'stats'],
    queryFn: () => fetcher('/api/get-stats'),
    enabled: Boolean(appConfig.SHOW_STAT_DATA),
  });
};

export const useLanguagesQuery = () => {
  return useQuery<LanguageOption[]>({
    queryKey: ['arena', 'languages'],
    queryFn: () => fetcher('/languages.json'),
  });
};

export const useScenarioPresetQuery = (options?: { enabled?: boolean }) => {
  return useQuery<ScenarioPreset[]>({
    queryKey: ['arena', 'scenario-presets'],
    queryFn: () => fetcher('/api/get-scenario-presets'),
    enabled: options?.enabled ?? true,
  });
};
