import { z } from 'zod';
import { defineAction, fields, mutationInput, snapshot, versionInput } from './core';
import type { AdminGuardedStatement } from '../operations';
import { appealCaseDecision, crowdReviewCaseDecision, reportCaseDecision, reportResolutionLabel } from '../moderation/transitions';
import { enforceCaseCard, fenceCaseRounds, notifyCaseResolution } from '../moderation/effects';

const targetFields = fields([['id', '目标 ID', 'text'], ['expectedVersion', '当前版本', 'text']]);
const resolutionInput = z.enum(['confirmed_violation', 'content_removed', 'self_remediated', 'no_violation', 'malicious_report']).nullable();
const optionalNote = z.string().trim().max(2000).nullable().optional().default(null);

export const ADMIN_MODERATION_ACTIONS = [
  defineAction({ name: 'reports.decide', label: '裁决举报案件', resource: 'report-cases', capability: 'reports.write',
    fields: [...targetFields, ...fields([['nextStatus', '状态（resolved / dismissed / under_review）', 'text'], ['resolutionCode', '结论代码（重新复核留空）', 'text', false], ['notifyCreator', '通知作者', 'boolean', false], ['creatorMessageReason', '给作者的说明（不填只发结论）', 'text', false]])] },
    z.object({ ...mutationInput, nextStatus: z.enum(['resolved', 'dismissed', 'under_review']), resolutionCode: resolutionInput.default(null), notifyCreator: z.boolean().default(true), creatorMessageReason: optionalNote }).strict(),
    async (db, input, context) => {
      const now = new Date().toISOString();
      const decision = reportCaseDecision(input.nextStatus, input.resolutionCode, now);
      const observed = await snapshot(db, 'report-cases', input.id, input.expectedVersion);
      return { targetId: input.id, plan: {
        primary: { name: 'decide-report-case', sql: `UPDATE report_cases SET status=?,resolution_code=?,closed_at=?,resolution_notified_at=NULL,resolution_notified_case_updated_at=NULL,updated_at=?
          WHERE ${observed.where} AND {{admin_guard}}`, bindings: [decision.status, decision.resolutionCode, decision.closedAt, now, ...observed.bindings] },
        effects: [...fenceCaseRounds(input.id, context.principalId, now), ...enforceCaseCard(input.id, decision, now),
          ...(input.notifyCreator ? notifyCaseResolution(input.id, decision, context.principalId, input.creatorMessageReason, now) : [])],
        result: { id: input.id, status: decision.status, resolutionCode: decision.resolutionCode },
      } };
    }),
  defineAction({ name: 'reports.notify-creator', label: '通知被举报作者', resource: 'report-cases', capability: 'reports.write', fields: targetFields },
    z.object(mutationInput).strict(), async (db, input, context) => {
      const observed = await snapshot(db, 'report-cases', input.id, input.expectedVersion);
      const now = new Date().toISOString();
      return { targetId: input.id, plan: {
        primary: { name: 'claim-creator-notice', sql: `UPDATE report_cases SET creator_notified_at=?,
          creator_notified_report_count=(SELECT count(*) FROM reports WHERE case_id=report_cases.id AND status='active'),
          target_card_updated_at_at_notice=(SELECT updated_at FROM data_cards WHERE id=report_cases.target_entity_id)
          WHERE ${observed.where} AND creator_notified_at IS NULL AND status IN ('open','under_review') AND {{admin_guard}}`, bindings: [now, ...observed.bindings] },
        effects: [{ name: 'send-creator-notice', expectedChanges: 1,
          sql: `INSERT INTO user_messages (recipient_user_id,actor_user_id,created_by_admin_principal_id,channel,message_type,template_key,payload_json,action_url,source_entity_type,source_entity_id,priority,created_at,updated_at)
            SELECT rc.target_user_id,NULL,?,'admin','moderation','user.moderation.data_card_reported',
            json_object('dataCardId',rc.target_entity_id,'dataCardName',dc.name,'detailsPreview',?,'reportCount',rc.creator_notified_report_count,'updatedAfterNotice',json('false')),
            '/character-manager','report_case',rc.id,'high',?,? FROM report_cases rc LEFT JOIN data_cards dc ON dc.id=rc.target_entity_id
            WHERE rc.id=? AND {{admin_guard}}`, bindings: [context.principalId, '公开数据卡收到举报，请前往角色管理查看并自查。', now, now, input.id] }],
        result: { id: input.id, notified: true },
      } };
    }),
  defineAction({ name: 'appeals.review', label: '复核申诉', resource: 'report-appeals', capability: 'appeals.write',
    fields: [...targetFields, ...fields([['expectedCaseVersion', '关联案件当前版本', 'text'], ['resolutionCode', '结论（upheld / overturned_no_violation / reopened_under_review）', 'text'], ['resolutionNote', '复核说明', 'text', false]])] },
    z.object({ ...mutationInput, expectedCaseVersion: versionInput, resolutionCode: z.enum(['upheld', 'overturned_no_violation', 'reopened_under_review']), resolutionNote: optionalNote }).strict(),
    async (db, input, context) => {
      const observed = await snapshot(db, 'report-appeals', input.id, input.expectedVersion);
      const caseId = String(observed.row?.report_case_id ?? 'missing');
      const related = await snapshot(db, 'report-cases', caseId, input.expectedCaseVersion);
      const now = new Date().toISOString();
      const decision = appealCaseDecision(input.resolutionCode, now);
      const effects: AdminGuardedStatement[] = [];
      if (decision) effects.push({ name: 'apply-appeal-to-case', expectedChanges: 1,
        sql: `UPDATE report_cases SET status=?,resolution_code=?,closed_at=?,resolution_notified_at=NULL,resolution_notified_case_updated_at=NULL,updated_at=? WHERE ${related.where} AND {{admin_guard}}`,
        bindings: [decision.status, decision.resolutionCode, decision.closedAt, now, ...related.bindings] });
      effects.push(...fenceCaseRounds(caseId, context.principalId, now), {
        name: 'notify-appeal-result', expectedChanges: 1,
        sql: `INSERT INTO user_messages (recipient_user_id,actor_user_id,created_by_admin_principal_id,channel,message_type,template_key,payload_json,action_url,source_entity_type,source_entity_id,priority,created_at,updated_at)
          SELECT ra.appellant_user_id,NULL,?,'admin','moderation','user.moderation.report_appeal_resolved',
          json_object('dataCardId',ra.target_entity_id,'dataCardName',dc.name,'resolutionCode',?,'resolutionLabel',?),
          ?,'report_appeal',ra.id,'high',?,? FROM report_appeals ra LEFT JOIN data_cards dc ON dc.id=ra.target_entity_id WHERE ra.id=? AND {{admin_guard}}`,
        bindings: [context.principalId, input.resolutionCode, reportResolutionLabel(input.resolutionCode), `/report-appeals?appealId=${encodeURIComponent(input.id)}`, now, now, input.id],
      });
      return { targetId: input.id, plan: {
        primary: { name: 'resolve-appeal', sql: `UPDATE report_appeals SET status='resolved',resolution_code=?,resolution_note=?,reviewed_by_user_id=NULL,reviewed_by_admin_principal_id=?,reviewed_at=?,updated_at=?
          WHERE ${observed.where} AND status IN ('submitted','under_review') AND EXISTS (SELECT 1 FROM report_cases WHERE ${related.where}
            AND status IS report_appeals.case_status_snapshot AND resolution_code IS report_appeals.case_resolution_code_snapshot
            AND updated_at=report_appeals.case_updated_at_snapshot) AND {{admin_guard}}`,
          bindings: [input.resolutionCode, input.resolutionNote, context.principalId, now, now, ...observed.bindings, ...related.bindings] },
        effects, result: { id: input.id, status: 'resolved', resolutionCode: input.resolutionCode },
      } };
    }),
  ...(['take-over', 'cancel', 'override'] as const).map((action) => defineAction({ name: `crowd-review.${action}`, label: ({ 'take-over': '接管众查轮次', cancel: '取消众查轮次', override: '覆盖众查结论' })[action], resource: 'crowd-review', capability: 'crowd-review.write',
    fields: [...targetFields, ...fields([['expectedCaseVersion', '关联案件当前版本', 'text'], ...(action === 'override' ? [['caseDecision', '案件结论（violation / no_violation / reopen_under_review）', 'text'] as [string, string, 'text'], ['creatorMessageReason', '给作者的说明（不填只发结论）', 'text', false] as [string, string, 'text', boolean]] : [])])] },
    z.object({ ...mutationInput, expectedCaseVersion: versionInput, caseDecision: action === 'override'
      ? z.enum(['violation', 'no_violation', 'reopen_under_review']) : z.literal('reopen_under_review').default('reopen_under_review'), creatorMessageReason: optionalNote }).strict(),
    async (db, input, context) => {
      const observed = await snapshot(db, 'crowd-review', input.id, input.expectedVersion);
      const caseId = String(observed.row?.report_case_id ?? 'missing');
      const related = await snapshot(db, 'report-cases', caseId, input.expectedCaseVersion);
      const now = new Date().toISOString();
      const decision = crowdReviewCaseDecision(input.caseDecision, now);
      const status = action === 'take-over' ? 'escalated' : action === 'cancel' ? 'cancelled' : 'concluded';
      const resultCode = action === 'take-over' ? 'escalated' : action === 'cancel' ? null : 'admin_override';
      const allowedStates = action === 'override' ? "('pending_dispatch','active','waiting_more_votes','concluded','escalated')"
        : action === 'cancel' ? "('pending_dispatch','active','waiting_more_votes','escalated')" : "('pending_dispatch','active','waiting_more_votes')";
      return { targetId: input.id, plan: {
        primary: { name: 'manage-crowd-round', sql: `UPDATE crowd_review_rounds SET status=?,result_code=?,
          result_summary_json=json_set(CASE WHEN json_valid(result_summary_json) THEN result_summary_json ELSE '{}' END,'$.adminAction',json(?)),updated_at=?
          WHERE ${observed.where} AND status IN ${allowedStates} AND EXISTS (SELECT 1 FROM report_cases WHERE ${related.where}) AND {{admin_guard}}`,
          bindings: [status, resultCode, JSON.stringify({ action, adminPrincipalId: context.principalId, caseDecision: input.caseDecision, actedAt: now }), now, ...observed.bindings, ...related.bindings] },
        effects: [{ name: 'apply-round-case-decision', expectedChanges: 1, sql: `UPDATE report_cases SET status=?,resolution_code=?,closed_at=?,updated_at=? WHERE ${related.where} AND {{admin_guard}}`,
          bindings: [decision.status, decision.resolutionCode, decision.closedAt, now, ...related.bindings] },
        ...fenceCaseRounds(caseId, context.principalId, now, input.id), ...enforceCaseCard(caseId, decision, now),
        ...(action === 'override' ? notifyCaseResolution(caseId, decision, context.principalId, input.creatorMessageReason, now) : [])],
        result: { id: input.id, status, resultCode, reportCaseId: caseId },
      } };
    })),
  defineAction({ name: 'inspectors.status', label: '设置巡查使状态', resource: 'inspectors', capability: 'inspectors.write', fields: [...targetFields,
    ...fields([['nextStatus', '状态（active / suspended / revoked）', 'text'], ['suspendedUntil', '暂停截止时间（ISO）', 'text', false]])] },
    z.object({ ...mutationInput, nextStatus: z.enum(['active', 'suspended', 'revoked']), suspendedUntil: z.iso.datetime().nullable().optional().default(null) }).strict(),
    async (db, input, context) => {
      const observed = await snapshot(db, 'inspectors', input.id, input.expectedVersion);
      const now = new Date().toISOString();
      const until = input.nextStatus === 'suspended' ? input.suspendedUntil : null;
      const note = input.nextStatus === 'active' ? null : input.reason;
      const primary: AdminGuardedStatement = observed.row
        ? { name: 'set-inspector-status', sql: `UPDATE crowd_review_inspectors SET status=?,suspended_until=?,status_reason_code=NULL,status_reason_detail=?,updated_by_user_id=NULL,updated_at=? WHERE ${observed.where} AND {{admin_guard}}`, bindings: [input.nextStatus, until, note, now, ...observed.bindings] }
        : { name: 'grant-inspector-state', sql: `INSERT INTO crowd_review_inspectors (user_id,status,suspended_until,status_reason_detail,created_at,updated_at)
          SELECT id,?,?,?,?,? FROM users WHERE id=? AND ?='missing' AND NOT EXISTS (SELECT 1 FROM crowd_review_inspectors WHERE user_id=?) AND {{admin_guard}}`, bindings: [input.nextStatus, until, note, now, now, input.id, input.expectedVersion, input.id] };
      const event = input.nextStatus === 'active' ? observed.row ? 'restore' : 'grant' : input.nextStatus === 'suspended' ? 'suspend' : 'revoke';
      const effects: AdminGuardedStatement[] = [{ name: 'audit-inspector-discipline', expectedChanges: 1,
        sql: `INSERT INTO inspector_discipline_events (id,user_id,event_type,reason_detail,source_entity_type,source_entity_id,created_by_user_id,created_by_admin_principal_id,created_at)
          SELECT ?,?,?,?,'admin_principal',?,NULL,?,? WHERE {{admin_guard}}`, bindings: [crypto.randomUUID(), input.id, event, input.reason, context.principalId, context.principalId, now] }];
      if (input.nextStatus !== 'active') effects.push({ name: 'revoke-inspector-assignments',
        sql: "UPDATE crowd_review_assignments SET status='revoked',completed_at=?,updated_at=? WHERE inspector_user_id=? AND status='assigned' AND {{admin_guard}}", bindings: [now, now, input.id] });
      return { targetId: input.id, plan: { primary, effects, result: { id: input.id, status: input.nextStatus } } };
    }),
];
