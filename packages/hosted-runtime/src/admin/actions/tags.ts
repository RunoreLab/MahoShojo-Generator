import { z } from 'zod';
import { commonInput, defineAction, fields, idInput, mutationInput, snapshot } from './core';
import type { AdminGuardedStatement } from '../operations';

const tagValues = { name: z.string().trim().min(1).max(100), description: z.string().max(2000).nullable(), category: z.string().trim().max(100).nullable(), scope: z.enum(['user', 'system', 'admin']), isActive: z.boolean() };
const tagFields = fields([['name', '名称', 'text'], ['description', '描述', 'text'], ['category', '分类', 'text'], ['scope', 'user / system / admin', 'text'], ['isActive', '启用', 'boolean']]);
const metadata = (name: string, label: string, extra: ReturnType<typeof fields>, resource = 'tags') => ({ name, label, resource, capability: 'tags.write', fields: fields([['id', resource === 'tag-aliases' ? '别名' : '标签 ID', 'text']]).concat(extra) });
const createTag = defineAction(metadata('tags.create', '新增标签', tagFields), z.object({ ...commonInput, id: idInput, ...tagValues }).strict(), async (_db, input) => {
  const now = new Date().toISOString();
  return { targetId: input.id, plan: { primary: { name: 'create-tag', sql: 'INSERT INTO tags (id,name,description,category,scope,is_active,created_at,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM tags WHERE id=?) AND {{admin_guard}}', bindings: [input.id, input.name, input.description, input.category, input.scope, Number(input.isActive), now, now, input.id] }, result: { id: input.id } } };
});
const updateTag = defineAction(metadata('tags.update', '修改标签', fields([['expectedVersion', '数据版本', 'text']]).concat(tagFields)), z.object({ ...mutationInput, ...tagValues }).strict(), async (db, input) => {
  const current = await snapshot(db, 'tags', input.id, input.expectedVersion);
  return { targetId: input.id, plan: { primary: { name: 'update-tag', sql: `UPDATE tags SET name=?,description=?,category=?,scope=?,is_active=?,updated_at=? WHERE ${current.where} AND {{admin_guard}}`, bindings: [input.name, input.description, input.category, input.scope, Number(input.isActive), new Date().toISOString(), ...current.bindings] }, result: { id: input.id } } };
});
const disableTag = defineAction(metadata('tags.disable', '停用标签', fields([['expectedVersion', '数据版本', 'text']])), z.object(mutationInput).strict(), async (db, input) => {
  const current = await snapshot(db, 'tags', input.id, input.expectedVersion);
  return { targetId: input.id, plan: { primary: { name: 'disable-tag', sql: `UPDATE tags SET is_active=0,updated_at=? WHERE ${current.where} AND {{admin_guard}}`, bindings: [new Date().toISOString(), ...current.bindings] }, result: { id: input.id, isActive: false } } };
});
const createAlias = defineAction(metadata('tag-aliases.create', '新增别名', fields([['tagId', '标签 ID', 'text']]), 'tag-aliases'), z.object({ ...commonInput, id: idInput, tagId: idInput }).strict(), async (_db, input) => ({ targetId: input.id, plan: {
  primary: { name: 'create-alias', sql: 'INSERT INTO tag_aliases (alias,tag_id,created_at) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM tags WHERE id=?) AND NOT EXISTS (SELECT 1 FROM tag_aliases WHERE alias=?) AND {{admin_guard}}', bindings: [input.id, input.tagId, new Date().toISOString(), input.tagId, input.id] }, result: { id: input.id, tagId: input.tagId },
} }));
const updateAlias = defineAction(metadata('tag-aliases.update', '修改别名指向', fields([['expectedVersion', '数据版本', 'text'], ['tagId', '标签 ID', 'text']]), 'tag-aliases'), z.object({ ...mutationInput, tagId: idInput }).strict(), async (db, input) => {
  const current = await snapshot(db, 'tag-aliases', input.id, input.expectedVersion);
  return { targetId: input.id, plan: { primary: { name: 'update-alias', sql: `UPDATE tag_aliases SET tag_id=? WHERE ${current.where} AND EXISTS (SELECT 1 FROM tags WHERE id=?) AND {{admin_guard}}`, bindings: [input.tagId, ...current.bindings, input.tagId] }, result: { id: input.id, tagId: input.tagId } } };
});
const deleteAlias = defineAction(metadata('tag-aliases.delete', '删除别名', fields([['expectedVersion', '数据版本', 'text']]), 'tag-aliases'), z.object(mutationInput).strict(), async (db, input) => {
  const current = await snapshot(db, 'tag-aliases', input.id, input.expectedVersion);
  return { targetId: input.id, plan: { primary: { name: 'delete-alias', sql: `DELETE FROM tag_aliases WHERE ${current.where} AND {{admin_guard}}`, bindings: current.bindings }, result: { id: input.id } } };
});
const tagIds = z.array(idInput).max(20).refine((items) => new Set(items).size === items.length, 'Duplicate tag IDs');
const replaceTags = defineAction({ name: 'cards.tags', label: '替换指定范围标签', resource: 'data-cards', capability: 'tags.write', fields: fields([['id', '数据卡 ID', 'text'], ['expectedVersion', '数据版本', 'text'], ['scope', 'user / system / admin', 'text'], ['expectedTagIds', '原有同范围标签 ID 数组', 'json'], ['tagIds', '新标签 ID 数组', 'json']]) },
  z.object({ ...mutationInput, scope: z.enum(['user', 'system', 'admin']), expectedTagIds: tagIds, tagIds }).strict(), async (db, input) => {
    const current = await snapshot(db, 'data-cards', input.id, input.expectedVersion);
    const desired = [...input.tagIds].sort();
    const now = new Date().toISOString();
    const effects: AdminGuardedStatement[] = [{ name: 'clear-scoped-card-tags', sql: 'DELETE FROM data_card_tags WHERE data_card_id=? AND tag_id IN (SELECT id FROM tags WHERE scope=?) AND {{admin_guard}}', bindings: [input.id, input.scope] }];
    for (const [index, tagId] of desired.entries()) effects.push({ name: `attach-tag-${index}`, sql: 'INSERT INTO data_card_tags (data_card_id,tag_id,created_by_user_id,created_at) SELECT ?,?,NULL,? WHERE {{admin_guard}}', bindings: [input.id, tagId, now], expectedChanges: 1 });
    return { targetId: input.id, plan: { primary: { name: 'claim-card-tag-update', sql: `UPDATE data_cards SET updated_at=? WHERE ${current.where} AND deleted_at IS NULL
      AND (SELECT json_group_array(tag_id) FROM (SELECT dct.tag_id FROM data_card_tags dct JOIN tags t ON t.id=dct.tag_id WHERE dct.data_card_id=? AND t.scope=? ORDER BY dct.tag_id))=?
      AND (SELECT count(*) FROM tags WHERE scope=? AND is_active=1 AND id IN (SELECT value FROM json_each(?)))=? AND {{admin_guard}}`,
      bindings: [now, ...current.bindings, input.id, input.scope, JSON.stringify([...input.expectedTagIds].sort()), input.scope, JSON.stringify(desired), desired.length] }, effects, result: { id: input.id, scope: input.scope, tagIds: desired } } };
  });

export const TAG_ACTIONS = [createTag, updateTag, disableTag, createAlias, updateAlias, deleteAlias, replaceTags];
