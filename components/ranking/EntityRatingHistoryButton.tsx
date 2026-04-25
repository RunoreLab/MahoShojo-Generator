'use client';

import { useCallback, useState } from 'react';

import {
  EntityRatingHistoryModal,
  type EntityRatingHistoryItem,
} from '@/components/ranking/EntityRatingHistoryModal';

type EntityRatingHistoryResponse =
  | {
      success: true;
      entityType: 'data_card' | 'preset';
      entityId: string;
      queue: 'strict';
      items: EntityRatingHistoryItem[];
    }
  | {
      success: false;
      error?: string;
    };

export function EntityRatingHistoryButton(props: {
  entityType: 'data_card' | 'preset';
  entityId: string;
  className?: string;
}) {
  const { entityType, entityId, className } = props;
  const [isOpen, setIsOpen] = useState(false);
  const [items, setItems] = useState<EntityRatingHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const id = entityId.trim();
    if (!id) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/arena/entity-rating-history?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(id)}`,
        { headers: { Accept: 'application/json' } },
      );
      const json = (await res.json()) as EntityRatingHistoryResponse;
      if (!res.ok || json.success !== true) {
        throw new Error((json as Extract<EntityRatingHistoryResponse, { success: false }>).error ?? `HTTP ${res.status}`);
      }
      setItems(Array.isArray(json.items) ? json.items : []);
    } catch (err) {
      setItems([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [entityId, entityType]);

  const open = () => {
    setIsOpen(true);
    void load();
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        className={
          className ??
          'inline-flex items-center rounded-full border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50'
        }
      >
        最近严格排位
      </button>
      <EntityRatingHistoryModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        loading={loading}
        error={error}
        items={items}
        onRetry={() => void load()}
      />
    </>
  );
}
