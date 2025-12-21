import { inferPvpCombatantTypeFromJson } from './logic';
import type { PvpCombatantType } from './types';

export interface LoadedPresetCard {
  filename: string;
  name: string;
  type: PvpCombatantType;
  data: unknown;
  dataJson: string;
}

const getPresetDisplayName = (data: any): string => {
  if (!data || typeof data !== 'object') return '未命名';
  return data.codename || data.name || data.title || '未命名';
};

export const loadPresetCard = async (origin: string, filename: string): Promise<LoadedPresetCard> => {
  const safeFilename = typeof filename === 'string' ? filename.trim() : '';
  if (!safeFilename) throw new Error('缺少 preset filename');

  const url = new URL(`/presets/${safeFilename}`, origin);
  const res = await fetch(url.toString(), { method: 'GET' });
  if (!res.ok) {
    throw new Error(`无法读取预设卡: ${safeFilename}`);
  }

  const data = await res.json();
  const type: PvpCombatantType = inferPvpCombatantTypeFromJson(data);
  const name = getPresetDisplayName(data);
  const dataJson = JSON.stringify(data);

  return { filename: safeFilename, name, type, data, dataJson };
};

