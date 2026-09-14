import { assertAdminBatchSucceeded, type AdminDatabase } from '../database';
import type { ReportResolutionCode } from '../../db/schema/business';
import { isAdverseFinalReportResolutionCode, reportResolutionLabel } from './transitions';
import type { ReportCaseDecision } from './transitions';

/** Automatic crowd result and adverse card enforcement share one D1 transaction. */
export async function applyAutomaticCrowdResolution(db: AdminDatabase, input: ReportCaseDecision & { reportCaseId: string; roundId: string; now: string }): Promise<boolean> {
  const results = await db.batch([
    db.prepare(`UPDATE report_cases SET status=?,resolution_code=?,closed_at=?,updated_at=?
      WHERE id=? AND status IN ('open','under_review') AND EXISTS
      (SELECT 1 FROM crowd_review_rounds r WHERE r.id=? AND r.report_case_id=report_cases.id AND r.updated_at=?
        AND r.status IN ('concluded','escalated') AND json_extract(r.result_summary_json,'$.adminAction') IS NULL
        AND ((?='confirmed_violation' AND r.result_code='violation') OR (?='no_violation' AND r.result_code='no_violation')
          OR (? IS NULL AND r.result_code IN ('tie','escalated'))))`)
      .bind(input.status, input.resolutionCode, input.closedAt, input.now, input.reportCaseId, input.roundId, input.now,
        input.resolutionCode, input.resolutionCode, input.resolutionCode),
    db.prepare(`UPDATE data_cards SET review_status='rejected',is_public=-1,public_since=NULL,updated_at=?
      WHERE changes()=1 AND ?='confirmed_violation'
        AND id IN (SELECT target_entity_id FROM report_cases WHERE id=? AND target_entity_type='data_card')`)
      .bind(input.now, input.resolutionCode, input.reportCaseId),
  ]);
  assertAdminBatchSucceeded(results);
  return results[0]?.meta?.changes === 1;
}

/** Shared automatic notification: claim and insert commit together, fenced against a newer manual decision. */
export async function notifyResolvedReportCase(db: AdminDatabase, caseId: string): Promise<boolean> {
  const row = await db.prepare('SELECT status,resolution_code,updated_at FROM report_cases WHERE id=?').bind(caseId)
    .first<{ status: string; resolution_code: ReportResolutionCode | null; updated_at: string }>();
  if (!row || row.status !== 'resolved' || !isAdverseFinalReportResolutionCode(row.resolution_code)) return false;
  const now = new Date().toISOString();
  const results = await db.batch([
    db.prepare(`UPDATE report_cases SET resolution_notified_at=?,resolution_notified_case_updated_at=updated_at
      WHERE id=? AND updated_at=? AND status='resolved' AND resolution_code=?
      AND (resolution_notified_case_updated_at IS NULL OR resolution_notified_case_updated_at<>updated_at)`)
      .bind(now, caseId, row.updated_at, row.resolution_code),
    db.prepare(`INSERT INTO user_messages
      (recipient_user_id,actor_user_id,channel,message_type,template_key,payload_json,action_url,source_entity_type,source_entity_id,priority,created_at,updated_at)
      SELECT rc.target_user_id,NULL,'system','moderation','user.moderation.report_case_resolved',
      json_object('dataCardId',rc.target_entity_id,'dataCardName',dc.name,'resolutionCode',rc.resolution_code,'resolutionLabel',?,'cardAutoRejected',json('true'),'cardAutoBanned',json('true')),
      ?,'report_case',rc.id,'high',?,? FROM report_cases rc LEFT JOIN data_cards dc ON dc.id=rc.target_entity_id
      WHERE changes()=1 AND rc.id=? AND rc.updated_at=? AND rc.status='resolved' AND rc.resolution_code=?`)
      .bind(reportResolutionLabel(row.resolution_code), `/report-appeals?reportCaseId=${encodeURIComponent(caseId)}`, now, now, caseId, row.updated_at, row.resolution_code),
  ]);
  assertAdminBatchSucceeded(results);
  return results[1]?.meta?.changes === 1;
}
