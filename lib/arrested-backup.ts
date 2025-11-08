// lib/arrested-backup.ts
// 封装逮捕页备份数据的存取逻辑，避免因 AI 输出触发敏感词而丢失用户输入

export type ArrestedBackupTriggerSource = 'input' | 'output';

export interface ArrestedBackupItem {
  id: string;
  label: string;
  filename: string;
  mimeType: string;
  description?: string;
  content: string;
  size: number;
}

export interface ArrestedBackupPackage {
  triggerSource: ArrestedBackupTriggerSource;
  triggeredAt: string;
  reason?: string;
  origin?: string;
  items: ArrestedBackupItem[];
  version: number;
}

export interface ArrestedBackupDraftItem {
  id?: string;
  label: string;
  filename?: string;
  mimeType?: string;
  description?: string;
  content: string | Record<string, unknown>;
}

export interface ArrestedBackupDraft {
  triggerSource: ArrestedBackupTriggerSource;
  reason?: string;
  origin?: string;
  items: ArrestedBackupDraftItem[];
}

const STORAGE_KEY = 'arrested-backup:v1';
const DEFAULT_MIME = 'application/json';

const safeSessionStorage = (): Storage | null => {
  if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') {
    return null;
  }
  try {
    return window.sessionStorage;
  } catch (error) {
    console.warn('无法访问 sessionStorage，跳过备份。', error);
    return null;
  }
};

const computeSize = (content: string): number => {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(content).length;
  }
  return content.length;
};

const normalizeFilename = (filename: string, fallbackIndex: number): string => {
  const sanitized = filename.trim() || `input-${fallbackIndex}`;
  const safe = sanitized.replace(/[^\w\u4e00-\u9fa5\-\.]+/g, '_');
  return safe || `input-${fallbackIndex}`;
};

const normalizeDraftItems = (draftItems: ArrestedBackupDraftItem[]): ArrestedBackupItem[] => {
  return draftItems.map((item, index) => {
    const content = typeof item.content === 'string'
      ? item.content
      : JSON.stringify(item.content, null, 2);
    const filename = normalizeFilename(item.filename || '', index + 1);
    const mimeType = item.mimeType?.trim() || DEFAULT_MIME;
    const needsJsonSuffix = mimeType === DEFAULT_MIME && !filename.toLowerCase().endsWith('.json');
    return {
      id: item.id || `${Date.now()}-${index}`,
      label: item.label || `输入项 ${index + 1}`,
      filename: needsJsonSuffix ? `${filename}.json` : filename,
      mimeType,
      description: item.description,
      content,
      size: computeSize(content),
    };
  });
};

export const persistArrestedBackup = (draft: ArrestedBackupDraft): void => {
  const storage = safeSessionStorage();
  if (!storage || !draft.items?.length) {
    return;
  }

  const payload: ArrestedBackupPackage = {
    triggerSource: draft.triggerSource,
    reason: draft.reason,
    origin: draft.origin,
    triggeredAt: new Date().toISOString(),
    items: normalizeDraftItems(draft.items),
    version: 1,
  };

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('写入逮捕备份失败：', error);
  }
};

export const loadArrestedBackup = (): ArrestedBackupPackage | null => {
  const storage = safeSessionStorage();
  if (!storage) return null;
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ArrestedBackupPackage;
    if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) {
      storage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn('解析逮捕备份失败，已清空旧数据。', error);
    storage.removeItem(STORAGE_KEY);
    return null;
  }
};

export const clearArrestedBackup = (): void => {
  const storage = safeSessionStorage();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('清理逮捕备份失败：', error);
  }
};
