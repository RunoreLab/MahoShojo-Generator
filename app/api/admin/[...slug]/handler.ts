/**
 * Admin API catch-all route handler.
 *
 * Maps /api/admin/* slugs to their handler implementations in
 * components/creation/api/admin/.
 *
 * For legacy handlers that parse IDs from the URL themselves,
 * we reconstruct the full URL from the slug + query string.
 */

// --- Static handlers (no dynamic params) ---

import dashboardStatsHandler from '@/components/creation/api/admin/dashboard-stats';
import usersHandler from '@/components/creation/api/admin/users';
import dataCardsHandler from '@/components/creation/api/admin/data-cards';
import aiModelsHandler from '@/components/creation/api/admin/ai-models';
import aiChannelAvailabilityHandler from '@/components/creation/api/admin/ai-channel-availability';
import aiReviewHandler from '@/components/creation/api/admin/ai-review';
import arenaRatingsHandler from '@/components/creation/api/admin/arena-ratings';
import arenaRatingEventsHandler from '@/components/creation/api/admin/arena-rating-events';
import arenaRiskAuditHandler from '@/components/creation/api/admin/arena-risk-audit';
import badgesHandler from '@/components/creation/api/admin/badges';
import battleReportGenerationsHandler from '@/components/creation/api/admin/battle-report-generations';
import battleReportOutputHandler from '@/components/creation/api/admin/battle-report-output';
import dataCardTagsHandler from '@/components/creation/api/admin/data-card-tags';
import dataCardUpdatesHandler from '@/components/creation/api/admin/data-card-updates';
import largeObjectsHandler from '@/components/creation/api/admin/large-objects';
import pvpHandler from '@/components/creation/api/admin/pvp';
import questionnaireNativeHandler from '@/components/creation/api/admin/questionnaire-native';
import redemptionCodesHandler from '@/components/creation/api/admin/redemption-codes';
import tagAliasesHandler from '@/components/creation/api/admin/tag-aliases';
import tagsHandler from '@/components/creation/api/admin/tags';
import userAccountsHandler from '@/components/creation/api/admin/user-accounts';
import userAnalyticsHandler from '@/components/creation/api/admin/user-analytics';
import exportDataCardsHandler from '@/components/creation/api/admin/export-data-cards';
import exportBattleReportGenerationsHandler from '@/components/creation/api/admin/export-battle-report-generations';

// --- Sub-path static handlers ---

import arenaRatingsResetHandler from '@/components/creation/api/admin/arena-ratings/reset';
import badgesGrantHandler from '@/components/creation/api/admin/badges/grant';
import badgesRevokeHandler from '@/components/creation/api/admin/badges/revoke';
import dataCardsBatchUpdateHandler from '@/components/creation/api/admin/data-cards/batch-update';
import dataMaintenancePreviewHandler from '@/components/creation/api/admin/data-maintenance/preview';
import dataMaintenanceJobsHandler from '@/components/creation/api/admin/data-maintenance/jobs';
import dataMaintenanceExecuteHandler from '@/components/creation/api/admin/data-maintenance/execute';
import dataCardMetricsRecomputeHandler from '@/components/creation/api/admin/data-card-metrics/recompute';
import dataCardUpdatesBatchReviewHandler from '@/components/creation/api/admin/data-card-updates/batch-review';
import usersBatchUpdateHandler from '@/components/creation/api/admin/users/batch-update';
import userAnalyticsSnapshotHandler from '@/components/creation/api/admin/user-analytics/snapshot';
import messagesIndexHandler from '@/components/creation/api/admin/messages/index';
import messagesSiteHandler from '@/components/creation/api/admin/messages/site';
import messagesDirectHandler from '@/components/creation/api/admin/messages/direct';
import reportCasesIndexHandler from '@/components/creation/api/admin/report-cases/index';
import reportAppealsIndexHandler from '@/components/creation/api/admin/report-appeals/index';
import crowdReviewInspectorsIndexHandler from '@/components/creation/api/admin/crowd-review/inspectors/index';
import crowdReviewCasesIndexHandler from '@/components/creation/api/admin/crowd-review/cases/index';

// --- Dynamic handlers (context.params) ---

import reportCasesDetailHandler from '@/components/creation/api/admin/report-cases/[caseId]';
import reportCasesDecisionHandler from '@/components/creation/api/admin/report-cases/[caseId]/decision';
import reportCasesNotifyCreatorHandler from '@/components/creation/api/admin/report-cases/[caseId]/notify-creator';
import reportAppealsDetailHandler from '@/components/creation/api/admin/report-appeals/[appealId]';
import reportAppealsReviewHandler from '@/components/creation/api/admin/report-appeals/[appealId]/review';
import crowdReviewCasesDetailHandler from '@/components/creation/api/admin/crowd-review/cases/[roundId]';
import crowdReviewCasesCancelHandler from '@/components/creation/api/admin/crowd-review/cases/[roundId]/cancel';
import crowdReviewCasesOverrideHandler from '@/components/creation/api/admin/crowd-review/cases/[roundId]/override';
import crowdReviewCasesTakeOverHandler from '@/components/creation/api/admin/crowd-review/cases/[roundId]/take-over';
import crowdReviewInspectorsStatusHandler from '@/components/creation/api/admin/crowd-review/inspectors/[userId]/status';
import messagesSiteExpireHandler from '@/components/creation/api/admin/messages/site/[id]/expire';

// --- URL-parsing dynamic handlers (legacy [id] pattern) ---

import badgesIdHandler from '@/components/creation/api/admin/badges/[id]';
import dataCardsIdHandler from '@/components/creation/api/admin/data-cards/[id]';
import dataMaintenanceJobsIdHandler from '@/components/creation/api/admin/data-maintenance/jobs/[id]';
import largeObjectsIdHandler from '@/components/creation/api/admin/large-objects/[id]';
import tagsIdHandler from '@/components/creation/api/admin/tags/[id]';
import usersIdHandler from '@/components/creation/api/admin/users/[id]';

type AdminHandler = (req: Request, context?: { params?: Record<string, string | string[]> }) => Promise<Response>;

/**
 * Route mapping: slug → handler function.
 *
 * For routes with dynamic segments, the slug array is joined and matched.
 * The route map uses the canonical API path as key.
 */
const ROUTE_MAP: Record<string, any> = {
  // Dashboard & overview
  'dashboard-stats': dashboardStatsHandler,

  // Users
  'users': usersHandler,
  'users/[id]': usersIdHandler,
  'users/batch-update': usersBatchUpdateHandler,
  'user-accounts': userAccountsHandler,
  'user-analytics': userAnalyticsHandler,
  'user-analytics/snapshot': userAnalyticsSnapshotHandler,

  // Content
  'data-cards': dataCardsHandler,
  'data-cards/[id]': dataCardsIdHandler,
  'data-cards/batch-update': dataCardsBatchUpdateHandler,
  'data-card-tags': dataCardTagsHandler,
  'data-card-updates': dataCardUpdatesHandler,
  'data-card-updates/batch-review': dataCardUpdatesBatchReviewHandler,
  'data-card-metrics/recompute': dataCardMetricsRecomputeHandler,
  'ai-channel-availability': aiChannelAvailabilityHandler,
  'ai-models': aiModelsHandler,
  'ai-review': aiReviewHandler,
  'questionnaire-native': questionnaireNativeHandler,

  // Tags
  'tags': tagsHandler,
  'tags/[id]': tagsIdHandler,
  'tag-aliases': tagAliasesHandler,

  // Badges
  'badges': badgesHandler,
  'badges/[id]': badgesIdHandler,
  'badges/grant': badgesGrantHandler,
  'badges/revoke': badgesRevokeHandler,

  // Redemption codes
  'redemption-codes': redemptionCodesHandler,

  // Arena
  'arena-ratings': arenaRatingsHandler,
  'arena-ratings/reset': arenaRatingsResetHandler,
  'arena-rating-events': arenaRatingEventsHandler,
  'arena-risk-audit': arenaRiskAuditHandler,

  // Battle report
  'battle-report-generations': battleReportGenerationsHandler,
  'battle-report-output': battleReportOutputHandler,
  'export-battle-report-generations': exportBattleReportGenerationsHandler,
  'export-data-cards': exportDataCardsHandler,

  // PVP
  'pvp': pvpHandler,

  // Storage
  'large-objects': largeObjectsHandler,
  'large-objects/[id]': largeObjectsIdHandler,

  // Data maintenance
  'data-maintenance/preview': dataMaintenancePreviewHandler,
  'data-maintenance/jobs': dataMaintenanceJobsHandler,
  'data-maintenance/jobs/[id]': dataMaintenanceJobsIdHandler,
  'data-maintenance/execute': dataMaintenanceExecuteHandler,

  // Messages
  'messages': messagesIndexHandler,
  'messages/site': messagesSiteHandler,
  'messages/direct': messagesDirectHandler,
  'messages/site/[id]/expire': messagesSiteExpireHandler,

  // Governance - Report cases
  'report-cases': reportCasesIndexHandler,
  'report-cases/[caseId]': reportCasesDetailHandler,
  'report-cases/[caseId]/decision': reportCasesDecisionHandler,
  'report-cases/[caseId]/notify-creator': reportCasesNotifyCreatorHandler,

  // Governance - Report appeals
  'report-appeals': reportAppealsIndexHandler,
  'report-appeals/[appealId]': reportAppealsDetailHandler,
  'report-appeals/[appealId]/review': reportAppealsReviewHandler,

  // Governance - Crowd review
  'crowd-review/inspectors': crowdReviewInspectorsIndexHandler,
  'crowd-review/inspectors/[userId]/status': crowdReviewInspectorsStatusHandler,
  'crowd-review/cases': crowdReviewCasesIndexHandler,
  'crowd-review/cases/[roundId]': crowdReviewCasesDetailHandler,
  'crowd-review/cases/[roundId]/cancel': crowdReviewCasesCancelHandler,
  'crowd-review/cases/[roundId]/override': crowdReviewCasesOverrideHandler,
  'crowd-review/cases/[roundId]/take-over': crowdReviewCasesTakeOverHandler,
};

// Dynamic route param names by route pattern
const DYNAMIC_PARAM_MAP: Record<string, string> = {
  'users/[id]': 'id',
  'data-cards/[id]': 'id',
  'badges/[id]': 'id',
  'tags/[id]': 'id',
  'large-objects/[id]': 'id',
  'data-maintenance/jobs/[id]': 'id',
  'messages/site/[id]/expire': 'id',
  'report-cases/[caseId]': 'caseId',
  'report-cases/[caseId]/decision': 'caseId',
  'report-cases/[caseId]/notify-creator': 'caseId',
  'report-appeals/[appealId]': 'appealId',
  'report-appeals/[appealId]/review': 'appealId',
  'crowd-review/cases/[roundId]': 'roundId',
  'crowd-review/cases/[roundId]/cancel': 'roundId',
  'crowd-review/cases/[roundId]/override': 'roundId',
  'crowd-review/cases/[roundId]/take-over': 'roundId',
  'crowd-review/inspectors/[userId]/status': 'userId',
};

/**
 * Given a slug array from the URL, try to match it against the route map.
 * Handles both exact matches and dynamic segment matches.
 */
function matchRoute(slugParts: string[]): { routeKey: string; params: Record<string, string> } | null {
  // Try exact match first
  const exactKey = slugParts.join('/');
  if (exactKey in ROUTE_MAP) {
    return { routeKey: exactKey, params: {} };
  }

  // Try dynamic segment matching
  for (const [pattern, paramName] of Object.entries(DYNAMIC_PARAM_MAP)) {
    const patternParts = pattern.split('/');
    if (patternParts.length !== slugParts.length) continue;

    const params: Record<string, string> = {};
    let match = true;

    for (let i = 0; i < patternParts.length; i++) {
      const pp = patternParts[i];
      if (pp.startsWith('[') && pp.endsWith(']')) {
        // Dynamic segment - extract param name and value
        params[paramName] = slugParts[i];
      } else if (pp !== slugParts[i]) {
        match = false;
        break;
      }
    }

    if (match) {
      return { routeKey: pattern, params };
    }
  }

  return null;
}

export function resolveAdminHandler(slugParts: string[]): {
  handler: AdminHandler;
  params: Record<string, string>;
} | null {
  const match = matchRoute(slugParts);
  if (!match) return null;

  const handler = ROUTE_MAP[match.routeKey] as AdminHandler;
  if (!handler) return null;

  return { handler, params: match.params };
}
