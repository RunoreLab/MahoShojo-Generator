import type {
  GameCardElement,
  GameCardRarity,
  GameCardType,
} from '@mahoshojo/contracts/game-card';

export const RARITY_LABELS: Record<GameCardRarity, string> = {
  common: '普通',
  uncommon: '优良',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说',
  mythic: '神话',
};

export const CARD_TYPE_LABELS: Record<GameCardType, string> = {
  character: '角色',
  creature: '生物',
  spell: '法术',
  scenario: '场景',
  equipment: '装备',
  support: '辅助',
};

export const ELEMENT_LABELS: Record<GameCardElement, string> = {
  fire: '火',
  water: '水',
  earth: '地',
  wind: '风',
  light: '光',
  dark: '暗',
  void: '虚',
  neutral: '无',
};

export const RARITY_COLORS: Record<GameCardRarity, {
  primary: string;
  secondary: string;
  glow: string;
}> = {
  common: { primary: '#9ca3af', secondary: '#6b7280', glow: 'rgba(156,163,175,0.4)' },
  uncommon: { primary: '#34d399', secondary: '#059669', glow: 'rgba(52,211,153,0.4)' },
  rare: { primary: '#60a5fa', secondary: '#2563eb', glow: 'rgba(96,165,250,0.4)' },
  epic: { primary: '#a78bfa', secondary: '#7c3aed', glow: 'rgba(167,139,250,0.4)' },
  legendary: { primary: '#fbbf24', secondary: '#d97706', glow: 'rgba(251,191,36,0.5)' },
  mythic: { primary: '#f87171', secondary: '#dc2626', glow: 'rgba(248,113,113,0.5)' },
};

export const ELEMENT_COLORS: Record<GameCardElement, string> = {
  fire: '#ef4444',
  water: '#3b82f6',
  earth: '#a16207',
  wind: '#10b981',
  light: '#fbbf24',
  dark: '#6366f1',
  void: '#7c3aed',
  neutral: '#9ca3af',
};
