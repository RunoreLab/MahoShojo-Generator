import type { AdminGuardedStatement } from '../operations';
import { isAdverseFinalReportResolutionCode, reportResolutionLabel, type ReportCaseDecision } from './transitions';

/** Every manual case decision fences all former rounds, including concluded rounds with delayed work. */
export function fenceCaseRounds(caseId: string, principalId: string, now: string, excludeRoundId = ''): AdminGuardedStatement[] {
  return [
    { name: 'fence-case-rounds', sql: `UPDATE crowd_review_rounds SET
      status=CASE WHEN status IN ('pending_dispatch','active','waiting_more_votes') THEN 'cancelled' ELSE status END,
      result_code=CASE WHEN status IN ('pending_dispatch','active','waiting_more_votes') THEN NULL ELSE result_code END,
      result_summary_json=json_set(CASE WHEN json_valid(result_summary_json) THEN result_summary_json ELSE '{}' END,'$.adminAction',json(?)),updated_at=?
      WHERE report_case_id=? AND id<>? AND {{admin_guard}}`,
    bindings: [JSON.stringify({ action: 'case_decision', adminPrincipalId: principalId, actedAt: now }), now, caseId, excludeRoundId] },
    { name: 'revoke-case-assignments', sql: `UPDATE crowd_review_assignments SET status='revoked',completed_at=?,updated_at=?
      WHERE status='assigned' AND crowd_review_round_id IN (SELECT id FROM crowd_review_rounds WHERE report_case_id=?) AND {{admin_guard}}`,
    bindings: [now, now, caseId] },
  ];
}

export function enforceCaseCard(caseId: string, decision: ReportCaseDecision, now: string): AdminGuardedStatement[] {
  if (!isAdverseFinalReportResolutionCode(decision.resolutionCode)) return [];
  return [{ name: 'enforce-case-card', sql: `UPDATE data_cards SET review_status='rejected',is_public=-1,public_since=NULL,updated_at=?
    WHERE id IN (SELECT target_entity_id FROM report_cases WHERE id=? AND target_entity_type='data_card') AND {{admin_guard}}`, bindings: [now, caseId] }];
}

export function notifyCaseResolution(caseId: string, decision: ReportCaseDecision, principalId: string, reason: string | null, now: string): AdminGuardedStatement[] {
  return [
    { name: 'notify-case-resolution', expectedChanges: 1,
      sql: `INSERT INTO user_messages (recipient_user_id,actor_user_id,created_by_admin_principal_id,channel,message_type,template_key,payload_json,action_url,source_entity_type,source_entity_id,priority,created_at,updated_at)
        SELECT rc.target_user_id,NULL,?,'admin','moderation','user.moderation.report_case_resolved',
        json_object('dataCardId',rc.target_entity_id,'dataCardName',dc.name,'resolutionCode',?,'resolutionLabel',?,'reason',?,'cardAutoRejected',json(?),'cardAutoBanned',json(?)),
        ?,'report_case',rc.id,'high',?,? FROM report_cases rc LEFT JOIN data_cards dc ON dc.id=rc.target_entity_id
        WHERE rc.id=? AND {{admin_guard}}`,
      bindings: [principalId, decision.resolutionCode, reportResolutionLabel(decision.resolutionCode), reason,
        JSON.stringify(isAdverseFinalReportResolutionCode(decision.resolutionCode)), JSON.stringify(isAdverseFinalReportResolutionCode(decision.resolutionCode)),
        `/report-appeals?reportCaseId=${encodeURIComponent(caseId)}`, now, now, caseId] },
    { name: 'mark-resolution-notified', expectedChanges: 1,
      sql: 'UPDATE report_cases SET resolution_notified_at=?,resolution_notified_case_updated_at=updated_at WHERE id=? AND {{admin_guard}}', bindings: [now, caseId] },
  ];
}
