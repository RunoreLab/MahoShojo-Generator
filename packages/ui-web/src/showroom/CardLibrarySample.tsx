import { useState } from 'react';
import { CardLibraryModal, type CardLibraryHost } from '../card-library';
import { generationActionClassNames } from '../generation-actions';

const cards = [
  { id: 'showroom-recommended', name: '推荐角色样板', is_recommended: 1 },
  { id: 'showroom-public', name: '公开角色样板', is_recommended: 0 },
].map(card => ({
  ...card, type: 'character', description: '筛选交互样板', username: '样板作者',
  is_public: true, review_status: 'approved', usage_count: 0, like_count: 0, favorite_count: 0,
  created_at: '2026-11-13T00:00:00.000Z', updated_at: '2026-11-13T00:00:00.000Z',
}));

/** 注入静态只读数据，复用完整生产弹窗，避免样板访问线上卡库或真实本地库。 */
const host: CardLibraryHost = {
  auth: { status: 'authenticated', userId: 7, userBadges: [] },
  online: {
    fetchSummaryPage: async () => ({ success: true, cards: [], total: 0, nextOffset: null }),
    fetchPublicCards: async query => {
      const filtered = cards.filter(card =>
        (!query.recommendedOnly || card.is_recommended === 1) &&
        (!query.search || card.name.includes(query.search)) &&
        (!query.author || card.username.includes(query.author)));
      return { ok: true, status: 200, data: { success: true, cards: filtered, total: filtered.length } };
    },
    fetchPublicCardById: async () => ({ ok: true, status: 200, data: { success: true, card: null } }),
    loadFullCard: async () => { throw new Error('只读样板不读取正文'); },
    listTags: async () => ({ ok: true, tags: [] }),
    listFavoriteIds: async () => ({ success: true, favorites: [] }),
    addFavorite: async () => ({ success: false }),
    removeFavorite: async () => ({ success: false }),
    getDeckCards: async () => null,
    reportCardStat: async () => false,
  },
  local: { repository: {
    get: async () => null,
    list: async () => ({ items: [] }),
    put: async () => { throw new Error('只读样板不写入本地库'); },
    putIfAbsent: async () => { throw new Error('只读样板不写入本地库'); },
    delete: async () => { throw new Error('只读样板不写入本地库'); },
    restore: async () => { throw new Error('只读样板不写入本地库'); },
  } },
  platform: {
    Link: ({ children, ...props }) => <a {...props}>{children}</a>,
    marks: { isLiked: () => false, markLiked: () => false, isUsed: () => false, markUsed: () => false },
    copyText: async () => {},
  },
  slots: {},
};

export function CardLibrarySample() {
  const [open, setOpen] = useState(false);
  return <div>
    <button type="button" className={generationActionClassNames.secondary} onClick={() => setOpen(true)}>打开数据卡筛选样板</button>
    <CardLibraryModal host={host} isOpen={open} onClose={() => setOpen(false)} selectedType="character"
      initialTab="public" browseOnly />
  </div>;
}
