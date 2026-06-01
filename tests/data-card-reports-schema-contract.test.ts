import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { reportCases, reportReferences, reportSubmissionEvents, reports } from '@/lib/db/schema';

describe('data card reports schema contract', () => {
  test('exports report tables with canonical snake_case columns', () => {
    expect(reportCases.targetEntityType.name).toBe('target_entity_type');
    expect(reportCases.creatorNotifiedAt.name).toBe('creator_notified_at');
    expect(reportCases.targetCardUpdatedAtAtNotice.name).toBe('target_card_updated_at_at_notice');

    expect(reports.reporterUserId.name).toBe('reporter_user_id');
    expect(reports.normalizedPayloadHash.name).toBe('normalized_payload_hash');
    expect(reports.targetDataSnapshot.name).toBe('target_data_snapshot');

    expect(reportReferences.referenceType.name).toBe('reference_type');
    expect(reportReferences.referenceId.name).toBe('reference_id');
    expect(reportReferences.sortOrder.name).toBe('sort_order');

    expect(reportSubmissionEvents.reporterUserId.name).toBe('reporter_user_id');
    expect(reportSubmissionEvents.submissionDecision.name).toBe('submission_decision');
  });

  test('migration creates immutable submission events used by rate limiting', () => {
    const migrationPath = join(process.cwd(), 'drizzle/0008_report_submission_events.sql');
    const content = readFileSync(migrationPath, 'utf8');

    expect(content.includes('CREATE TABLE IF NOT EXISTS report_submission_events')).toBe(true);
    expect(content.includes('CREATE INDEX IF NOT EXISTS idx_report_submission_events_reporter_created_at')).toBe(true);
  });
});
