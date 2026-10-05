import { z } from 'zod';
import { defineAction, fields, mutationInput, snapshot, versionInput } from './core';
import { dataCardModerationMessage } from './messages-helper';
import type { AdminGuardedStatement } from '../operations';
import { resetStrictRatingAfterCardUpdate } from './content-rating-reset';

const meta = (name: string, label: string, extra: ReturnType<typeof fields> = []) => ({ name, label, resource: 'data-cards', capability: 'content.write', fields: fields([['id', '数据卡 ID', 'text'], ['expectedVersion', '数据版本', 'text']]).concat(extra) });
const review = defineAction(meta('cards.review', '审核数据卡', fields([['decision', 'approved 或 rejected', 'text']])),
  z.object({ ...mutationInput, decision: z.enum(['approved', 'rejected']) }).strict(), async (db, input, context) => {
    const current = await snapshot(db, 'data-cards', input.id, input.expectedVersion);
    return { targetId: input.id, plan: {
      primary: { name: 'review-card', sql: `UPDATE data_cards SET review_status=?,updated_at=? WHERE ${current.where} AND deleted_at IS NULL AND {{admin_guard}}`, bindings: [input.decision, new Date().toISOString(), ...current.bindings] },
      effects: input.decision === 'rejected' ? [dataCardModerationMessage({ cardId: input.id, principalId: context.principalId, reason: input.reason, templateKey: 'user.moderation.data_card_rejected' })] : [],
      result: { id: input.id, decision: input.decision },
    } };
  });
const visibility = defineAction(meta('cards.visibility', '修改公开状态', fields([['visibility', '-1 封禁 / 0 私有 / 1 公开', 'number']])),
  z.object({ ...mutationInput, visibility: z.union([z.literal(-1), z.literal(0), z.literal(1)]) }).strict(), async (db, input, context) => {
    const current = await snapshot(db, 'data-cards', input.id, input.expectedVersion);
    const now = new Date().toISOString();
    return { targetId: input.id, plan: {
      primary: { name: 'set-card-visibility', sql: `UPDATE data_cards SET public_since=CASE WHEN CAST(is_public AS INTEGER)<>? THEN CASE WHEN ?=1 THEN ? ELSE NULL END ELSE public_since END,is_public=?,updated_at=? WHERE ${current.where} AND deleted_at IS NULL AND {{admin_guard}}`, bindings: [input.visibility, input.visibility, now, input.visibility, now, ...current.bindings] },
      effects: input.visibility === -1 ? [dataCardModerationMessage({ cardId: input.id, principalId: context.principalId, reason: input.reason, templateKey: 'user.moderation.data_card_banned' })] : [],
      result: { id: input.id, visibility: input.visibility },
    } };
  });
const recommendation = defineAction(meta('cards.recommend', '设置推荐', fields([['recommended', '是否推荐', 'boolean']])),
  z.object({ ...mutationInput, recommended: z.boolean() }).strict(), async (db, input) => {
    const current = await snapshot(db, 'data-cards', input.id, input.expectedVersion);
    return { targetId: input.id, plan: { primary: { name: 'recommend-card', sql: `UPDATE data_cards SET is_recommended=?,updated_at=? WHERE ${current.where} AND deleted_at IS NULL AND {{admin_guard}}`, bindings: [Number(input.recommended), new Date().toISOString(), ...current.bindings] }, result: { id: input.id, recommended: input.recommended } } };
  });
const edit = defineAction(meta('cards.metadata', '修改名称与描述', fields([['name', '名称', 'text'], ['description', '描述', 'text']])),
  z.object({ ...mutationInput, name: z.string().trim().min(1).max(200), description: z.string().max(4000) }).strict(), async (db, input) => {
    const current = await snapshot(db, 'data-cards', input.id, input.expectedVersion);
    return { targetId: input.id, plan: { primary: { name: 'edit-card-metadata', sql: `UPDATE data_cards SET name=?,description=?,updated_at=? WHERE ${current.where} AND deleted_at IS NULL AND {{admin_guard}}`, bindings: [input.name, input.description, new Date().toISOString(), ...current.bindings] }, result: { id: input.id } } };
  });
const nativeAllowed = defineAction(meta('cards.native-allowed', '问卷原生许可', fields([['nativeAllowed', '允许原生生成', 'boolean']])),
  z.object({ ...mutationInput, nativeAllowed: z.boolean() }).strict(), async (db, input) => {
    const current = await snapshot(db, 'data-cards', input.id, input.expectedVersion);
    return { targetId: input.id, plan: { primary: { name: 'permit-questionnaire-native', sql: `UPDATE data_cards SET data=json_set(data,'$.nativeAllowed',json(?)),updated_at=? WHERE ${current.where} AND type='questionnaire' AND json_valid(data) AND deleted_at IS NULL AND {{admin_guard}}`, bindings: [JSON.stringify(input.nativeAllowed), new Date().toISOString(), ...current.bindings] }, result: { id: input.id, nativeAllowed: input.nativeAllowed } } };
  });
const updateReview = defineAction({ name: 'card-updates.review', label: '审核卡片更新', resource: 'data-card-updates', capability: 'content.write', fields: fields([['id', '更新 ID', 'text'], ['expectedVersion', '更新版本', 'text'], ['cardId', '数据卡 ID', 'text'], ['cardVersion', '数据卡版本', 'text'], ['decision', 'approved 或 rejected', 'text']]) },
  z.object({ ...mutationInput, cardId: z.string().min(1).max(128), cardVersion: versionInput, decision: z.enum(['approved', 'rejected']) }).strict(), async (db, input, context) => {
    const update = await snapshot(db, 'data-card-updates', input.id, input.expectedVersion);
    const card = await snapshot(db, 'data-cards', input.cardId, input.cardVersion);
    const now = new Date().toISOString();
    const updateExists = `EXISTS (SELECT 1 FROM data_card_updates WHERE ${update.where} AND data_card_id=?)`;
    const cardExists = `EXISTS (SELECT 1 FROM data_cards WHERE ${card.where} AND deleted_at IS NULL)`;
    // A pending user update cannot restore an administrator-only permission that changed after submission.
    const updatedData = `CASE WHEN type='questionnaire' THEN json_set(COALESCE((SELECT data FROM data_card_updates WHERE id=?),data),'$.nativeAllowed',json(CASE WHEN json_extract(data,'$.nativeAllowed')=1 THEN 'true' ELSE 'false' END)) ELSE COALESCE((SELECT data FROM data_card_updates WHERE id=?),data) END`;
    const primary: AdminGuardedStatement = input.decision === 'approved'
      ? { name: 'apply-card-update', sql: `UPDATE data_cards SET name=COALESCE((SELECT name FROM data_card_updates WHERE id=?),name),description=COALESCE((SELECT description FROM data_card_updates WHERE id=?),description),data=${updatedData},review_status='approved',updated_at=? WHERE ${card.where} AND deleted_at IS NULL AND ${updateExists} AND {{admin_guard}}`, bindings: [input.id, input.id, input.id, input.id, now, ...card.bindings, ...update.bindings, input.cardId] }
      : { name: 'reject-card-update', sql: `UPDATE data_card_updates SET updated_at=? WHERE ${update.where} AND data_card_id=? AND ${cardExists} AND {{admin_guard}}`, bindings: [now, ...update.bindings, input.cardId, ...card.bindings] };
    const effects: AdminGuardedStatement[] = input.decision === 'rejected' ? [dataCardModerationMessage({ cardId: input.cardId, updateId: input.id, principalId: context.principalId, reason: input.reason, templateKey: 'user.moderation.data_card_rejected' })] : [];
    effects.push({ name: 'consume-card-update', sql: 'DELETE FROM data_card_updates WHERE id=? AND data_card_id=? AND {{admin_guard}}', bindings: [input.id, input.cardId], expectedChanges: 1 });
    if (input.decision === 'approved') effects.push({ name: 'invalidate-card-metrics', sql: 'DELETE FROM data_card_metrics WHERE data_card_id=? AND {{admin_guard}}', bindings: [input.cardId] });
    if (input.decision === 'approved') effects.push(resetStrictRatingAfterCardUpdate(input.cardId, now));
    return { targetId: input.id, plan: { primary, effects, result: { id: input.id, cardId: input.cardId, decision: input.decision } } };
  });

export const CONTENT_ACTIONS = [review, visibility, recommendation, edit, nativeAllowed, updateReview];
