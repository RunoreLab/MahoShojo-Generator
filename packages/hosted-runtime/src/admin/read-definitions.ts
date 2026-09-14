import type { AdminResource } from '@mahoshojo/contracts/admin';

export type AdminReadDefinition = {
  table: string;
  key: string;
  fields: Record<string, string>;
  detail?: Record<string, string>;
  search?: string;
  status?: string;
  statuses?: readonly string[];
  user?: string;
  where?: string;
};
const fields = (names: string): Record<string, string> => Object.fromEntries(names.split(' ').map((name) => [name, name]));
const eventFields = fields('id generation_id queue status skip_reason user_id a_entity_type a_entity_id b_entity_type b_entity_id a_before_rating a_after_rating a_delta b_before_rating b_after_rating b_delta created_at applied_at');

/** All SQL identifiers and expressions come from this server-owned manifest. */
export const ADMIN_READ_DEFINITIONS: Record<Exclude<AdminResource, 'dashboard'>, AdminReadDefinition> = {
  users: { table: 'users', key: 'id', fields: fields('id username prefix slot_count is_banned is_admin is_review_exempt last_login_at created_at updated_at'), detail: fields('signature'), search: 'username', status: "CASE WHEN coalesce(is_banned, '') = '' THEN 'active' ELSE 'banned' END", statuses: ['active', 'banned'] },
  'user-accounts': { table: 'users u', key: 'u.id', fields: {
    id: 'u.id', username: 'u.username',
    linked_accounts: '(SELECT count(*) FROM user_auth_links l WHERE l.business_user_id = u.id)',
    active_reset_requests: '(SELECT count(*) FROM auth_password_reset_tokens r WHERE r.user_id = u.id AND r.consumed_at IS NULL AND r.expires_at > unixepoch())',
    authentication_events: '(SELECT count(*) FROM auth_audit_logs a WHERE a.business_user_id = u.id)',
  }, search: 'u.username', user: 'u.id' },
  'data-cards': { table: 'data_cards', key: 'id', fields: { ...fields('id user_id type name description review_status is_recommended usage_count like_count favorite_count public_since created_at updated_at deleted_at'), is_public: 'CAST(is_public AS INTEGER)' }, detail: fields('data'), search: 'name', status: 'review_status', statuses: ['pending', 'approved', 'rejected'], user: 'user_id' },
  'data-card-updates': { table: 'data_card_updates', key: 'id', fields: fields('id data_card_id user_id name description created_at updated_at'), detail: fields('data'), search: 'name', user: 'user_id' },
  tags: { table: 'tags', key: 'id', fields: fields('id name description category scope is_active created_at updated_at'), search: 'name', status: 'scope', statuses: ['user', 'system', 'admin'] },
  'tag-aliases': { table: 'tag_aliases', key: 'alias', fields: { id: 'alias', ...fields('alias tag_id created_at') }, search: 'alias' },
  badges: { table: 'badges', key: 'id', fields: fields('id name description icon text_color background_color border_color rarity sort_order is_active created_at'), search: 'name' },
  // rowid is an internal reference; never expose the bearer redemption code, including in cursors.
  'redemption-codes': { table: 'redemption_codes', key: 'rowid', fields: { id: 'rowid', ...fields('slot_count created_at') } },
  messages: { table: 'site_messages', key: 'id', fields: fields('id message_type template_key title_text priority expires_at created_at updated_at'), detail: fields('body_text action_url'), search: 'title_text' },
  'user-messages': { table: 'user_messages', key: 'id', fields: fields('id recipient_user_id channel message_type template_key title_text priority read_at archived_at expires_at created_at'), detail: fields('body_text action_url'), search: 'title_text', user: 'recipient_user_id' },
  'report-cases': { table: 'report_cases', key: 'id', fields: fields('id target_entity_type target_entity_id target_user_id status resolution_code creator_notified_at latest_reported_at closed_at created_at updated_at'), status: 'status', statuses: ['open', 'under_review', 'resolved', 'dismissed'], user: 'target_user_id' },
  'report-appeals': { table: 'report_appeals', key: 'id', fields: fields('id report_case_id appellant_user_id target_user_id target_entity_type target_entity_id appeal_reason_code status resolution_code reviewed_at created_at updated_at'), detail: fields('details resolution_note'), status: 'status', statuses: ['submitted', 'under_review', 'resolved', 'withdrawn'], user: 'appellant_user_id' },
  'crowd-review': { table: 'crowd_review_rounds', key: 'id', fields: fields('id report_case_id status opened_at deadline_at extension_count min_valid_votes result_code created_at updated_at'), status: 'status', statuses: ['pending_dispatch', 'active', 'waiting_more_votes', 'concluded', 'escalated', 'cancelled'] },
  inspectors: { table: 'crowd_review_inspectors', key: 'user_id', fields: { id: 'user_id', ...fields('user_id status suspended_until status_reason_code created_at updated_at') }, detail: fields('status_reason_detail'), status: 'status', statuses: ['active', 'suspended', 'revoked'], user: 'user_id' },
  ratings: { table: 'arena_ratings', key: 'json_array(entity_type, entity_id, queue)', fields: { id: 'json_array(entity_type, entity_id, queue)', ...fields('entity_type entity_id queue rating games wins losses draws season_peak_rating season_low_rating last_delta last_applied_at created_at updated_at') }, search: 'entity_id', status: 'queue', statuses: ['strict', 'free'] },
  'rating-events': { table: 'arena_rating_events', key: 'id', fields: eventFields, user: 'user_id', status: 'status', statuses: ['pending', 'applied', 'skipped', 'failed'] },
  'risk-audits': { table: 'arena_rating_events', key: 'id', fields: eventFields, user: 'user_id', where: "status IN ('skipped', 'failed')", status: 'status', statuses: ['skipped', 'failed'] },
  generations: { table: 'battle_report_generations', key: 'id', fields: fields('id user_id started_at ended_at duration_ms status generation_mode mode ai_provider_name ai_model headline combatant_count input_chars output_chars prompt_tokens completion_tokens total_tokens pvp_room_id created_at updated_at'), detail: fields('output_preview output_has_sensitive_words output_has_shield_words'), user: 'user_id', search: 'headline', status: 'status', statuses: ['started', 'completed', 'aborted', 'failed'] },
  'pvp-rooms': { table: 'pvp_rooms', key: 'id', fields: fields('id host_user_id status phase current_match_id version expires_at last_activity_at created_at updated_at'), user: 'host_user_id' },
  'large-objects': { table: 'large_objects', key: 'id', fields: fields('id kind owner_ref_id owner_user_id bytes stored_bytes content_type content_encoding created_at updated_at'), user: 'owner_user_id' },
  analytics: { table: 'admin_user_analytics_daily', key: 'metric_date', fields: { id: 'metric_date', ...fields('metric_date total_users tracked_users untracked_users active_users_24h active_users_7d active_users_30d activity_coverage_rate generation_total_1d generation_completed_1d generation_aborted_1d generation_failed_1d generation_distinct_users_1d auth_success_1d auth_failed_1d frequency_profile created_at updated_at') } },
  'ai-availability': { table: 'ai_channel_availability_buckets', key: 'json_array(bucket_start, provider_id, model_id)', fields: { id: 'json_array(bucket_start, provider_id, model_id)', ...fields('bucket_start provider_id model_id success_count failure_count excluded_count last_error_class updated_at') }, search: 'model_id' },
};
