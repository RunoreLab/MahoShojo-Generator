import {
  DATA_CARD_REVIEW_STATUSES,
  ONLINE_DATA_CARD_TYPES,
  ONLINE_DATA_CARD_VISIBILITIES,
  DataCardReviewStatusSchema,
  OnlineDataCardTypeSchema,
  OnlineDataCardVisibilitySchema,
} from '@mahoshojo/contracts/data-cards';
import {
  DataCardReviewStatusSchema as RootDataCardReviewStatusSchema,
  OnlineDataCardTypeSchema as RootOnlineDataCardTypeSchema,
  OnlineDataCardVisibilitySchema as RootOnlineDataCardVisibilitySchema,
} from '@mahoshojo/contracts';

describe('online data-card metadata contract', () => {
  it('accepts exactly the four online data-card types', () => {
    expect(ONLINE_DATA_CARD_TYPES).toEqual([
      'character',
      'scenario',
      'history',
      'questionnaire',
    ]);

    for (const value of ONLINE_DATA_CARD_TYPES) {
      expect(OnlineDataCardTypeSchema.parse(value)).toBe(value);
    }

    for (const value of ['canshou', 'general', 'unknown', '', null]) {
      expect(OnlineDataCardTypeSchema.safeParse(value).success).toBe(false);
    }
  });

  it('accepts exactly the three review statuses', () => {
    expect(DATA_CARD_REVIEW_STATUSES).toEqual(['pending', 'approved', 'rejected']);

    for (const value of DATA_CARD_REVIEW_STATUSES) {
      expect(DataCardReviewStatusSchema.parse(value)).toBe(value);
    }

    for (const value of ['draft', 'banned', '', null]) {
      expect(DataCardReviewStatusSchema.safeParse(value).success).toBe(false);
    }
  });

  it('preserves the numeric visibility wire values without boolean coercion', () => {
    expect(ONLINE_DATA_CARD_VISIBILITIES).toEqual([-1, 0, 1]);

    for (const value of ONLINE_DATA_CARD_VISIBILITIES) {
      expect(OnlineDataCardVisibilitySchema.parse(value)).toBe(value);
    }

    for (const value of [true, false, 2, -2, '1', null]) {
      expect(OnlineDataCardVisibilitySchema.safeParse(value).success).toBe(false);
    }
  });

  it('exports the same schemas from the package root and data-cards subpath', () => {
    expect(RootOnlineDataCardTypeSchema).toBe(OnlineDataCardTypeSchema);
    expect(RootDataCardReviewStatusSchema).toBe(DataCardReviewStatusSchema);
    expect(RootOnlineDataCardVisibilitySchema).toBe(OnlineDataCardVisibilitySchema);
  });
});
