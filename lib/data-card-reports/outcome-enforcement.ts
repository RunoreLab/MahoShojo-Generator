import type { AppDrizzleDb } from '@/lib/db/drizzle';
import type { ReportResolutionCode } from '@/lib/db/schema';

const ADVERSE_FINAL_REPORT_RESOLUTION_CODES: ReadonlyArray<ReportResolutionCode> = [
  'confirmed_violation',
  'content_removed',
  'self_remediated',
];

export const isAdverseFinalReportResolutionCode = (
  resolutionCode: ReportResolutionCode | null,
): resolutionCode is 'confirmed_violation' | 'content_removed' | 'self_remediated' =>
  resolutionCode != null && ADVERSE_FINAL_REPORT_RESOLUTION_CODES.includes(resolutionCode);

export async function enforceResolvedReportCaseTargetCard(input: {
  db: AppDrizzleDb;
  targetEntityType: string;
  targetEntityId: string;
  resolutionCode: ReportResolutionCode | null;
  now: string;
  enforceDataCardModerationOutcome: (
    db: AppDrizzleDb,
    input: {
      cardId: string;
      reviewStatus: 'rejected';
      isPublic: -1;
      now: string;
    },
  ) => Promise<{ found: boolean; changed: boolean }>;
}): Promise<{ applied: boolean; found: boolean; changed: boolean }> {
  if (input.targetEntityType !== 'data_card') {
    return { applied: false, found: false, changed: false };
  }

  if (!isAdverseFinalReportResolutionCode(input.resolutionCode)) {
    return { applied: false, found: false, changed: false };
  }

  const result = await input.enforceDataCardModerationOutcome(input.db, {
    cardId: input.targetEntityId,
    reviewStatus: 'rejected',
    isPublic: -1,
    now: input.now,
  });

  return {
    applied: true,
    found: result.found,
    changed: result.changed,
  };
}
