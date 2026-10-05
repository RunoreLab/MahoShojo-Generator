import type { AdminGuardedStatement } from '../operations';

/** Uses the canonical user.moderation.* payload consumed by the existing message renderer. */
export function dataCardModerationMessage(input: {
  cardId: string; updateId?: string; principalId: string; reason: string;
  templateKey: 'user.moderation.data_card_rejected' | 'user.moderation.data_card_banned';
}): AdminGuardedStatement {
  return {
    name: 'notify-card-owner', expectedChanges: 1,
    sql: `INSERT INTO user_messages
      (recipient_user_id,actor_user_id,created_by_admin_principal_id,channel,message_type,template_key,payload_json,action_url,source_entity_type,source_entity_id,priority,created_at,updated_at)
      SELECT dc.user_id,NULL,?,'admin','moderation',?,json_object('dataCardId',dc.id,'dataCardName',${input.updateId ? 'COALESCE(u.name,dc.name)' : 'dc.name'},'reason',?),
      ?,'data_card',dc.id,'high',?,? FROM data_cards dc ${input.updateId ? 'JOIN data_card_updates u ON u.data_card_id=dc.id AND u.id=?' : ''}
      WHERE dc.id=? AND {{admin_guard}}`,
    bindings: [input.principalId, input.templateKey, input.reason,
      `/character-manager?dataCardId=${encodeURIComponent(input.cardId)}`, new Date().toISOString(), new Date().toISOString(),
      ...(input.updateId ? [input.updateId] : []), input.cardId],
  };
}
