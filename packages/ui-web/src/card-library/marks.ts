import type { CardLibraryMarks } from './host';

/** Web 沿用至今的存储键名：改键会让老用户丢掉「已点赞/已使用」状态。 */
const LIKED_CARDS_KEY = 'mahoshojo_liked_cards';
const USED_CARDS_KEY = 'mahoshojo_used_cards';

interface CardInteraction {
  cardId: string;
  timestamp: number;
}

const readInteractions = (storage: Storage, key: string): CardInteraction[] => {
  try {
    const stored = storage.getItem(key);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as CardInteraction[]) : [];
  } catch {
    return [];
  }
};

const readIdSet = (storage: Storage, key: string): Set<string> =>
  new Set(readInteractions(storage, key).map((item) => item.cardId));

const appendInteraction = (storage: Storage, key: string, cardId: string): boolean => {
  const ids = readIdSet(storage, key);
  if (ids.has(cardId)) return false;
  const interactions = readInteractions(storage, key);
  interactions.push({ cardId, timestamp: Date.now() });
  try {
    storage.setItem(key, JSON.stringify(interactions));
    return true;
  } catch {
    return false;
  }
};

/**
 * 基于 `Storage` 接口的标记实现（Web 用 `window.localStorage`，Tauri webview
 * 同样提供 localStorage；测试可注入内存 Storage 替身）。
 *
 * `markLiked`/`markUsed` 返回 false 的语义是「这条卡已被标记过或写入失败」：
 * 点赞链路把它当作跨标签页去重锁——失败时不上报服务端，防止无限刷赞
 * （见原 `apps/web/lib/localStorage.ts` 的注释链）。
 */
export const createStorageCardLibraryMarks = (storage: Storage): CardLibraryMarks => ({
  isLiked: (cardId) => readIdSet(storage, LIKED_CARDS_KEY).has(cardId),
  markLiked: (cardId) => appendInteraction(storage, LIKED_CARDS_KEY, cardId),
  isUsed: (cardId) => readIdSet(storage, USED_CARDS_KEY).has(cardId),
  markUsed: (cardId) => appendInteraction(storage, USED_CARDS_KEY, cardId),
});

/** 宿主侧一行接入：默认吃 `globalThis.localStorage`，无窗口环境降级为全空。 */
export const createLocalStorageCardLibraryMarks = (): CardLibraryMarks => {
  const storage = typeof localStorage === 'undefined' ? null : localStorage;
  if (storage === null) {
    return {
      isLiked: () => false,
      markLiked: () => false,
      isUsed: () => false,
      markUsed: () => false,
    };
  }
  return createStorageCardLibraryMarks(storage);
};
