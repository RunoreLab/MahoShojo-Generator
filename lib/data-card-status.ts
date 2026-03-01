// 数据卡状态工具（前后端通用，无服务端依赖）
import { normalizePublicVisibilityValue } from '@/lib/data-card-read-mappers';

const toRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const readVisibility = (card: unknown): boolean | number => {
  const source = toRecord(card);
  if (!source) return false;
  return normalizePublicVisibilityValue(source);
};

export function isDataCardBanned(card: any): boolean {
  return readVisibility(card) === -1;
}

export function getDataCardStatus(card: any): {
  status: 'public' | 'private' | 'banned';
  label: string;
  color: string;
} {
  if (!toRecord(card)) {
    return { status: 'private', label: '私有', color: 'gray' };
  }

  const visibility = readVisibility(card);
  if (visibility === -1) {
    return { status: 'banned', label: '封禁', color: 'red' };
  } else if (visibility === 1 || visibility === true) {
    return { status: 'public', label: '公开', color: 'green' };
  } else {
    return { status: 'private', label: '私有', color: 'gray' };
  }
}
