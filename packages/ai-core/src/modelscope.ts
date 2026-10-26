export const MODELSCOPE_SIZE_OPTIONS = [
  { value: '928x1664', label: '16:9 竖屏（928×1664）' },
  { value: '1664x928', label: '16:9 横屏（1664×928）' },
  { value: '1328x1328', label: '正方形（1328×1328）' },
  { value: '1104x1472', label: '4:3 竖屏（1104×1472）' },
  { value: '1472x1104', label: '4:3 横屏（1472×1104）' },
] as const;

export type ModelScopePresetSize = (typeof MODELSCOPE_SIZE_OPTIONS)[number]['value'];

export const DEFAULT_MODELSCOPE_SIZE: ModelScopePresetSize = '1328x1328';
export const DEFAULT_MODELSCOPE_MODEL = 'Stonego/XiabanmostyleV3';

// Exact matching preserves saved-value validation; HTTP normalization belongs to its adapter.
export const isModelScopePresetSize = (value: unknown): value is ModelScopePresetSize =>
  typeof value === 'string' && MODELSCOPE_SIZE_OPTIONS.some((option) => option.value === value);
