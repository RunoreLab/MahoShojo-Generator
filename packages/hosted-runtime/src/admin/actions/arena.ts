import { z } from 'zod';
import { INITIAL_RATING } from '../arena-policy';
import { defineAction, fields, mutationInput, snapshot, type AdminBusinessAction } from './core';

export const ADMIN_ARENA_ACTIONS: AdminBusinessAction[] = [
  defineAction({ name: 'ratings.reset', label: '重置单队列评分（保留赛季极值和事件历史）', resource: 'ratings', capability: 'ratings.write', fields: fields([['id', '评分复合ID', 'text'], ['expectedVersion', '当前版本', 'text']]) },
    z.object(mutationInput).strict(), async (db, input) => {
      const key = z.tuple([z.enum(['data_card', 'preset']), z.string().min(1).max(128), z.enum(['strict', 'free'])]).parse(JSON.parse(input.id));
      const current = await snapshot(db, 'ratings', input.id, input.expectedVersion);
      return { targetId: input.id, plan: { primary: { name: 'reset-rating', sql: `UPDATE arena_ratings SET rating=?,games=0,wins=0,losses=0,draws=0,last_delta=NULL,last_applied_at=NULL,updated_at=?
        WHERE ${current.where} AND NOT EXISTS (SELECT 1 FROM arena_rating_events WHERE status='pending' AND queue=? AND ((a_entity_type=? AND a_entity_id=?) OR (b_entity_type=? AND b_entity_id=?))) AND {{admin_guard}}`,
        bindings: [INITIAL_RATING, new Date().toISOString(), ...current.bindings, key[2], key[0], key[1], key[0], key[1]] }, result: { entityType: key[0], entityId: key[1], queue: key[2], rating: INITIAL_RATING } } };
    }),
];
