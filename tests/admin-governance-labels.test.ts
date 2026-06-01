import { describe, expect, test } from 'vitest';

import {
  getCrowdReviewRoundStatusLabel,
  getReportCaseStatusLabel,
} from '@/lib/admin/governance-labels';
import {
  ADMIN_MESSAGE_TEMPLATE_CATALOG,
  getAdminMessageTemplateCatalogItem,
} from '@/lib/admin/message-catalog';
import { getMessagePriorityLabel } from '@/lib/messages/display';

describe('admin governance labels', () => {
  test('returns Chinese labels for shared message and governance enums', () => {
    expect(getMessagePriorityLabel('normal')).toBe('普通优先级');
    expect(getReportCaseStatusLabel('under_review')).toBe('人工复核中');
    expect(getCrowdReviewRoundStatusLabel('pending_dispatch')).toBe('待派单');
  });

  test('admin message catalog contains required governance templates', () => {
    const keys = new Set(ADMIN_MESSAGE_TEMPLATE_CATALOG.map((item) => item.templateKey));

    expect(keys.has('site.generic.notice')).toBe(true);
    expect(keys.has('site.issue.update')).toBe(true);
    expect(keys.has('user.generic.notice')).toBe(true);
    expect(keys.has('user.moderation.data_card_rejected')).toBe(true);
    expect(keys.has('user.moderation.data_card_banned')).toBe(true);
    expect(keys.has('user.moderation.data_card_reported')).toBe(true);
    expect(keys.has('user.moderation.report_case_resolved')).toBe(true);
  });

  test('looks up catalog items by templateKey', () => {
    const item = getAdminMessageTemplateCatalogItem('site.issue.update');

    expect(item).not.toBeNull();
    expect(item?.messageType).toBe('issue');
    expect(item?.scope).toBe('site');
  });

  test('unknown prototype-like values fall back to explicit unknown labels', () => {
    expect(getReportCaseStatusLabel('__proto__')).toBe('未知（__proto__）');
  });
});
