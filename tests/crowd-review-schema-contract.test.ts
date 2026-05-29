import { describe, expect, test } from 'vitest';

import {
  crowdReviewAssignments,
  crowdReviewInspectors,
  crowdReviewRounds,
  inspectorDisciplineEvents,
} from '@/lib/db/schema';

describe('crowd review schema contract', () => {
  test('exports phase-1 crowd review tables with snake_case columns', () => {
    expect(crowdReviewInspectors.status.name).toBe('status');
    expect(crowdReviewInspectors.suspendedUntil.name).toBe('suspended_until');
    expect(crowdReviewRounds.reportCaseId.name).toBe('report_case_id');
    expect(crowdReviewRounds.minValidVotes.name).toBe('min_valid_votes');
    expect(crowdReviewAssignments.inspectorUserId.name).toBe('inspector_user_id');
    expect(crowdReviewAssignments.postVoteSummarySeenAt.name).toBe('post_vote_summary_seen_at');
    expect(inspectorDisciplineEvents.eventType.name).toBe('event_type');
  });
});
