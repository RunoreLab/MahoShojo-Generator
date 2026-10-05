import { z } from 'zod';
import { commonInput, defineAction, fields, idInput, mutationInput, snapshot } from './core';

const color = z.discriminatedUnion('type', [
  z.object({ type: z.literal('solid'), value: z.string().max(100).regex(/^(?:#[0-9a-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla)\([0-9.,%\s+-]+\)|[a-zA-Z]+)$/) }).strict(),
  z.object({ type: z.literal('gradient'), value: z.string().max(500).regex(/^(?:linear|radial|conic)-gradient\([#a-zA-Z0-9.,%()\s+-]+\)$/).refine((value) => !/(?:url|var|image)\s*\(/i.test(value)) }).strict(),
]);
const icon = z.discriminatedUnion('type', [
  z.object({ type: z.literal('lucide'), name: z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,80}$/) }).strict(),
  z.object({ type: z.literal('emoji'), value: z.string().min(1).max(40) }).strict(),
  z.object({ type: z.literal('null'), value: z.null() }).strict(),
  z.object({ type: z.literal('svg'), url: z.string().min(1).max(2048).refine((value) => {
    if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return !/[\u0000-\u0020<>"']/u.test(value);
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
  }) }).strict(),
]);
const badgeValues = {
  name: z.string().trim().min(1).max(100), description: z.string().max(2000).nullable(), icon,
  textColor: color, backgroundColor: color, borderColor: color.nullable(), rarity: z.number().int().min(0).max(1000), sortOrder: z.number().int().min(-1_000_000).max(1_000_000), isActive: z.boolean(),
};
const badgeFields = fields([['name', '名称', 'text'], ['description', '描述', 'text'], ['icon', '图标 JSON', 'json'], ['textColor', '文字颜色 JSON', 'json'], ['backgroundColor', '背景颜色 JSON', 'json'], ['borderColor', '边框颜色 JSON（可填 null）', 'json'], ['rarity', '稀有度', 'number'], ['sortOrder', '排序', 'number'], ['isActive', '启用', 'boolean']]);
const meta = (name: string, label: string, extra: ReturnType<typeof fields>) => ({ name, label, resource: 'badges', capability: 'badges.write', fields: fields([['id', '徽章 ID', 'text']]).concat(extra) });
const serializeBadge = (input: z.infer<z.ZodObject<typeof badgeValues>>) => [input.name, input.description, JSON.stringify(input.icon), JSON.stringify(input.textColor), JSON.stringify(input.backgroundColor), input.borderColor === null ? null : JSON.stringify(input.borderColor), input.rarity, input.sortOrder, Number(input.isActive)];
const create = defineAction(meta('badges.create', '创建徽章', badgeFields), z.object({ ...commonInput, id: idInput, ...badgeValues }).strict(), async (_db, input) => ({ targetId: input.id, plan: {
  primary: { name: 'create-badge', sql: 'INSERT INTO badges (id,name,description,icon,text_color,background_color,border_color,rarity,sort_order,is_active,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM badges WHERE id=?) AND {{admin_guard}}', bindings: [input.id, ...serializeBadge(input), new Date().toISOString(), input.id] }, result: { id: input.id },
} }));
const update = defineAction(meta('badges.update', '修改徽章', fields([['expectedVersion', '数据版本', 'text']]).concat(badgeFields)), z.object({ ...mutationInput, ...badgeValues }).strict(), async (db, input) => {
  const current = await snapshot(db, 'badges', input.id, input.expectedVersion);
  return { targetId: input.id, plan: { primary: { name: 'update-badge', sql: `UPDATE badges SET name=?,description=?,icon=?,text_color=?,background_color=?,border_color=?,rarity=?,sort_order=?,is_active=? WHERE ${current.where} AND {{admin_guard}}`, bindings: [...serializeBadge(input), ...current.bindings] }, result: { id: input.id } } };
});
const remove = defineAction(meta('badges.delete', '删除无人持有的徽章', fields([['expectedVersion', '数据版本', 'text']])), z.object(mutationInput).strict(), async (db, input) => {
  const current = await snapshot(db, 'badges', input.id, input.expectedVersion);
  return { targetId: input.id, plan: { primary: { name: 'delete-unused-badge', sql: `DELETE FROM badges WHERE ${current.where} AND NOT EXISTS (SELECT 1 FROM user_badges WHERE badge_id=?) AND {{admin_guard}}`, bindings: [...current.bindings, input.id] }, result: { id: input.id } } };
});
const grant = defineAction(meta('badges.grant', '授予用户徽章', fields([['expectedVersion', '徽章版本', 'text'], ['userId', '用户 ID', 'number']])), z.object({ ...mutationInput, userId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict(), async (db, input, context) => {
  const current = await snapshot(db, 'badges', input.id, input.expectedVersion);
  return { targetId: `${input.id}:${input.userId}`, plan: { primary: {
    name: 'grant-badge', sql: `INSERT INTO user_badges (user_id,badge_id,is_equipped,display_order,obtained_at)
      SELECT ?,?,0,0,? WHERE EXISTS (SELECT 1 FROM badges WHERE ${current.where} AND is_active=1)
      AND EXISTS (SELECT 1 FROM users WHERE id=?) AND NOT EXISTS (SELECT 1 FROM user_badges WHERE user_id=? AND badge_id=?) AND {{admin_guard}}`,
    bindings: [input.userId, input.id, new Date().toISOString(), ...current.bindings, input.userId, input.userId, input.id],
  }, effects: [{ name: 'notify-badge-grant', expectedChanges: 1, sql: `INSERT INTO user_messages
      (recipient_user_id,actor_user_id,created_by_admin_principal_id,channel,message_type,template_key,payload_json,source_entity_type,source_entity_id,priority,created_at,updated_at)
      SELECT ?,NULL,?,'admin','reputation','user.reputation.badge_awarded',json_object('badgeName',name,'summary',?),'badge',id,'normal',?,? FROM badges WHERE id=? AND {{admin_guard}}`,
    bindings: [input.userId, context.principalId, input.reason, new Date().toISOString(), new Date().toISOString(), input.id] }], result: { id: input.id, userId: input.userId } } };
});
const revoke = defineAction(meta('badges.revoke', '撤销用户徽章', fields([['userId', '用户 ID', 'number'], ['assignmentId', '持有记录 ID', 'number'], ['obtainedAt', '持有记录获得时间', 'text']])), z.object({ ...commonInput, id: idInput, userId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), assignmentId: z.number().int().positive(), obtainedAt: z.string().min(1).max(100) }).strict(), async (_db, input) => ({ targetId: `${input.id}:${input.userId}`, plan: {
  primary: { name: 'revoke-badge', sql: 'DELETE FROM user_badges WHERE id=? AND user_id=? AND badge_id=? AND obtained_at=? AND {{admin_guard}}', bindings: [input.assignmentId, input.userId, input.id, input.obtainedAt] }, result: { id: input.id, userId: input.userId },
} }));

const generateCodes = defineAction({ name: 'redemption.generate', label: '生成兑换码', resource: 'redemption-codes', capability: 'redemption.write', fields: fields([['count', '生成数量（1–100）', 'number'], ['slotCount', '每码卡槽数', 'number']]) },
  z.object({ ...commonInput, count: z.number().int().min(1).max(100), slotCount: z.number().int().min(1).max(1_000_000) }).strict(), async (_db, input) => {
    const codes = Array.from({ length: input.count }, () => crypto.randomUUID().replaceAll('-', '').toUpperCase());
    return { targetId: 'generated-batch', plan: { primary: { name: 'generate-redemption-codes', expectedChanges: input.count,
      sql: `INSERT INTO redemption_codes (code,slot_count,created_at) SELECT value,?,? FROM json_each(?)
        WHERE NOT EXISTS (SELECT 1 FROM redemption_codes WHERE code IN (SELECT value FROM json_each(?))) AND {{admin_guard}}`,
      bindings: [input.slotCount, new Date().toISOString(), JSON.stringify(codes), JSON.stringify(codes)] }, result: { codes, slotCount: input.slotCount } } };
  });
const deleteCode = defineAction({ name: 'redemption.delete', label: '废弃未使用兑换码', resource: 'redemption-codes', capability: 'redemption.write', fields: fields([['id', '兑换记录 ID', 'text'], ['expectedVersion', '数据版本', 'text']]) }, z.object({ ...mutationInput, id: z.string().regex(/^[1-9][0-9]{0,15}$/) }).strict(), async (db, input) => {
  const current = await snapshot(db, 'redemption-codes', input.id, input.expectedVersion);
  return { targetId: input.expectedVersion, plan: { primary: { name: 'delete-redemption-code', sql: `DELETE FROM redemption_codes WHERE ${current.where} AND {{admin_guard}}`, bindings: current.bindings }, result: { deleted: true } } };
});
export const ENTITLEMENT_ACTIONS = [create, update, remove, grant, revoke, generateCodes, deleteCode];
