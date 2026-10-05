import { z } from 'zod';
import { defineAction, fields, mutationInput, snapshot } from './core';

const userInput = { ...mutationInput, id: z.string().regex(/^[1-9][0-9]{0,14}$/) };
const meta = (name: string, label: string, extra: ReturnType<typeof fields>) => ({ name, label, resource: 'users', capability: 'users.write', fields: fields([['id', '用户 ID', 'text'], ['expectedVersion', '数据版本', 'text']]).concat(extra) });
const ban = defineAction(meta('users.ban', '封禁或恢复用户', fields([['banned', '是否封禁', 'boolean']])), z.object({ ...userInput, banned: z.boolean() }).strict(), async (db, input) => {
  const current = await snapshot(db, 'users', input.id, input.expectedVersion);
  return { targetId: input.id, plan: { primary: { name: 'set-user-ban', sql: `UPDATE users SET is_banned=?,updated_at=? WHERE ${current.where} AND {{admin_guard}}`, bindings: [input.banned ? input.reason : null, new Date().toISOString(), ...current.bindings] }, result: { id: input.id, banned: input.banned } } };
});
const exempt = defineAction(meta('users.review-exempt', '设置审核豁免', fields([['exempt', '是否免审', 'boolean']])), z.object({ ...userInput, exempt: z.boolean() }).strict(), async (db, input) => {
  const current = await snapshot(db, 'users', input.id, input.expectedVersion);
  return { targetId: input.id, plan: { primary: { name: 'set-user-review-exempt', sql: `UPDATE users SET is_review_exempt=?,updated_at=? WHERE ${current.where} AND {{admin_guard}}`, bindings: [Number(input.exempt), new Date().toISOString(), ...current.bindings] }, result: { id: input.id, exempt: input.exempt } } };
});
const slots = defineAction(meta('users.slots', '设置卡槽上限', fields([['slotCount', '卡槽上限（0 恢复默认）', 'number']])), z.object({ ...userInput, slotCount: z.number().int().min(0).max(1_000_000) }).strict(), async (db, input) => {
  const current = await snapshot(db, 'users', input.id, input.expectedVersion);
  return { targetId: input.id, plan: { primary: { name: 'set-user-slots', sql: `UPDATE users SET slot_count=?,updated_at=? WHERE ${current.where} AND {{admin_guard}}`, bindings: [input.slotCount === 0 ? null : input.slotCount, new Date().toISOString(), ...current.bindings] }, result: { id: input.id, slotCount: input.slotCount } } };
});
const prefix = defineAction(meta('users.prefix', '设置头衔', fields([['prefix', '头衔（空文本清除）', 'text']])), z.object({ ...userInput, prefix: z.string().trim().max(100) }).strict(), async (db, input) => {
  const current = await snapshot(db, 'users', input.id, input.expectedVersion);
  return { targetId: input.id, plan: { primary: { name: 'set-user-prefix', sql: `UPDATE users SET prefix=?,updated_at=? WHERE ${current.where} AND {{admin_guard}}`, bindings: [input.prefix || null, new Date().toISOString(), ...current.bindings] }, result: { id: input.id } } };
});
export const USER_ACTIONS = [ban, exempt, slots, prefix];
