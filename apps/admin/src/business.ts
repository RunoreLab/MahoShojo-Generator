import { ADMIN_RESOURCES, AdminQuerySchema, type AdminResource, type AdminQuery, type AdminReadResponse } from '@mahoshojo/contracts/admin';
export { ADMIN_RESOURCES, AdminQuerySchema };
export type { AdminResource, AdminQuery, AdminReadResponse };
export const READ_CAPABILITIES: Record<AdminResource, string> = {
  dashboard: 'dashboard.read', users: 'users.read', 'user-accounts': 'users.accounts.read',
  'data-cards': 'content.read', 'data-card-updates': 'content.read', tags: 'tags.read', 'tag-aliases': 'tags.read',
  badges: 'badges.read', 'redemption-codes': 'redemption.read', messages: 'messages.read', 'user-messages': 'messages.read',
  'report-cases': 'moderation.read', 'report-appeals': 'moderation.read', 'crowd-review': 'moderation.read', inspectors: 'moderation.read',
  ratings: 'ratings.read', 'rating-events': 'ratings.read', 'risk-audits': 'ratings.read', generations: 'generations.read',
  'pvp-rooms': 'pvp.read', 'large-objects': 'storage.read', analytics: 'analytics.read', 'ai-availability': 'ai.read',
};
export type AdminAction = {
  name: string; label: string; resource: string; capability: string;
  fields: readonly { name: string; label: string; type: 'text' | 'number' | 'boolean' | 'json'; required?: boolean }[];
  itemFields?: AdminAction['fields'];
  execute(input: unknown, context: { principalId: string; requestId: string; authnContextSafeRef: string }): Promise<unknown>;
};
export class AdminHttpError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 413 | 503, readonly code: string) { super(code); }
}
