import { z } from 'zod';
import { commonInput, defineAction, fields, mutationInput, snapshot } from './core';

const siteTemplates = {
  'site.service.degraded': 'service', 'site.maintenance.notice': 'maintenance', 'site.activity.notice': 'activity',
  'site.policy.notice': 'policy', 'site.issue.update': 'issue', 'site.generic.notice': 'generic',
} as const;
const directTemplates = {
  'user.generic.notice': 'generic', 'user.moderation.data_card_rejected': 'moderation',
  'user.moderation.data_card_banned': 'moderation', 'user.moderation.data_card_reported': 'moderation',
  'user.moderation.report_case_resolved': 'moderation',
} as const;
const messageInput = {
  ...commonInput,
  payload: z.record(z.string().max(100), z.unknown()).default({}),
  titleText: z.string().trim().min(1).max(200).nullable().optional().default(null),
  bodyText: z.string().trim().min(1).max(10_000).nullable().optional().default(null),
  actionUrl: z.string().max(2048).refine((url) => /^\/(?!\/)/u.test(url) && !/[\\\u0000-\u0020\u007f]/u.test(url), '仅允许站内路径').nullable().optional().default(null),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  expiresAt: z.iso.datetime().nullable().optional().default(null),
};
const messageFields = fields([
  ['templateKey', '消息模板', 'text'], ['payload', '模板参数', 'json', false], ['titleText', '标题', 'text', false],
  ['bodyText', '正文', 'text', false], ['actionUrl', '站内跳转路径', 'text', false],
  ['priority', '优先级（low / normal / high）', 'text', false], ['expiresAt', '过期时间（ISO）', 'text', false],
]);

export const ADMIN_MESSAGE_ACTIONS = [
  defineAction({ name: 'messages.site.create', label: '发布站点消息', resource: 'messages', capability: 'messages.write', fields: messageFields },
    z.object({ ...messageInput, templateKey: z.enum(Object.keys(siteTemplates) as [keyof typeof siteTemplates, ...(keyof typeof siteTemplates)[]]) }).strict(),
    async (_db, input, context) => {
      const now = new Date().toISOString();
      return { targetId: input.idempotencyKey, plan: {
        primary: { name: 'create-site-message',
          sql: `INSERT INTO site_messages
            (message_type,template_key,payload_json,title_text,body_text,action_url,priority,expires_at,created_by_user_id,created_by_admin_principal_id,created_at,updated_at)
            SELECT ?,?,?,?,?,?,?,?,NULL,?,?,? WHERE {{admin_guard}}`,
          bindings: [siteTemplates[input.templateKey], input.templateKey, JSON.stringify(input.payload), input.titleText, input.bodyText, input.actionUrl,
            input.priority, input.expiresAt, context.principalId, now, now] },
        result: { createdCount: 1 },
      } };
    }),
  defineAction({ name: 'messages.direct.create', label: '发送定向消息', resource: 'user-messages', capability: 'messages.write', fields: [...fields([['recipientUserIds', '收件人用户 ID（最多 100）', 'json']]), ...messageFields] },
    z.object({ ...messageInput, templateKey: z.enum(Object.keys(directTemplates) as [keyof typeof directTemplates, ...(keyof typeof directTemplates)[]]),
      recipientUserIds: z.array(z.number().int().positive().safe()).min(1).max(100).refine((ids) => new Set(ids).size === ids.length, '收件人不可重复') }).strict(),
    async (_db, input, context) => {
      const now = new Date().toISOString();
      const recipients = JSON.stringify(input.recipientUserIds);
      return { targetId: input.idempotencyKey, plan: {
        primary: { name: 'create-direct-messages', expectedChanges: input.recipientUserIds.length,
          sql: `INSERT INTO user_messages
            (recipient_user_id,actor_user_id,created_by_admin_principal_id,channel,message_type,template_key,payload_json,title_text,body_text,action_url,priority,expires_at,created_at,updated_at)
            SELECT users.id,NULL,?,'admin',?,?,?,?,?,?,?,?,?,? FROM users
            WHERE users.id IN (SELECT value FROM json_each(?))
            AND (SELECT count(*) FROM users WHERE id IN (SELECT value FROM json_each(?)))=? AND {{admin_guard}}`,
          bindings: [context.principalId, directTemplates[input.templateKey], input.templateKey, JSON.stringify(input.payload), input.titleText, input.bodyText,
            input.actionUrl, input.priority, input.expiresAt, now, now, recipients, recipients, input.recipientUserIds.length] },
        result: { createdCount: input.recipientUserIds.length },
      } };
    }),
  defineAction({ name: 'messages.site.expire', label: '立即过期站点消息', resource: 'messages', capability: 'messages.write', fields: fields([['id', '消息 ID', 'text'], ['expectedVersion', '当前版本', 'text']]) },
    z.object(mutationInput).strict(), async (db, input) => {
      const observed = await snapshot(db, 'messages', input.id, input.expectedVersion);
      const now = new Date().toISOString();
      return { targetId: input.id, plan: { primary: { name: 'expire-site-message',
        sql: `UPDATE site_messages SET expires_at=?,updated_at=? WHERE ${observed.where} AND {{admin_guard}}`,
        bindings: [now, now, ...observed.bindings] }, result: { id: input.id, expired: true } } };
    }),
];
