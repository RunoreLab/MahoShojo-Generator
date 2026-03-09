import { describe, expect, test } from 'bun:test';

import { mapArenaRatingEventReadRow, mapArenaRatingSnapshotRow } from '@/lib/db/repositories/arena-read-mappers';

describe('arena-read mappers', () => {
  test('mapArenaRatingSnapshotRow 支持 snake_case 输入并输出 canonical camelCase', () => {
    const mapped = mapArenaRatingSnapshotRow({
      queue: 'free',
      entity_type: 'preset',
      entity_id: 'M01',
      rating: '1321',
      games: '27',
    });

    expect(mapped).toEqual({
      queue: 'free',
      entityType: 'preset',
      entityId: 'M01',
      rating: 1321,
      games: 27,
    });
    expect('entity_id' in mapped).toBe(false);
    expect('entity_type' in mapped).toBe(false);
  });

  test('mapArenaRatingSnapshotRow 支持 camelCase 输入', () => {
    const mapped = mapArenaRatingSnapshotRow({
      queue: 'strict',
      entityType: 'data_card',
      entityId: 'card-1',
      rating: 1200,
      games: 0,
    });

    expect(mapped.queue).toBe('strict');
    expect(mapped.entityType).toBe('data_card');
    expect(mapped.entityId).toBe('card-1');
    expect(mapped.rating).toBe(1200);
    expect(mapped.games).toBe(0);
  });

  test('mapArenaRatingEventReadRow 支持 snake_case 输入并输出 canonical camelCase', () => {
    const mapped = mapArenaRatingEventReadRow({
      queue: 'strict',
      status: 'applied',
      skip_reason: null,
      details_json: '{"version":2}',
      a_entity_type: 'data_card',
      a_entity_id: 'card-a',
      b_entity_type: 'preset',
      b_entity_id: 'M02',
      a_before_rating: 1000,
      a_after_rating: 1016,
      a_delta: 16,
      a_before_games: 0,
      a_after_games: 1,
      b_before_rating: 1000,
      b_after_rating: 984,
      b_delta: -16,
      b_before_games: 0,
      b_after_games: 1,
    });

    expect(mapped).toEqual({
      queue: 'strict',
      status: 'applied',
      skipReason: null,
      detailsJson: '{"version":2}',
      aEntityType: 'data_card',
      aEntityId: 'card-a',
      bEntityType: 'preset',
      bEntityId: 'M02',
      aBeforeRating: 1000,
      aAfterRating: 1016,
      aDelta: 16,
      aBeforeGames: 0,
      aAfterGames: 1,
      bBeforeRating: 1000,
      bAfterRating: 984,
      bDelta: -16,
      bBeforeGames: 0,
      bAfterGames: 1,
    });
    expect('skip_reason' in mapped).toBe(false);
    expect('a_entity_type' in mapped).toBe(false);
  });

  test('mapArenaRatingEventReadRow 支持 camelCase 输入', () => {
    const mapped = mapArenaRatingEventReadRow({
      queue: 'free',
      status: 'pending',
      skipReason: 'dedup-ip-pair',
      detailsJson: null,
      aEntityType: 'preset',
      aEntityId: 'M03',
      bEntityType: 'data_card',
      bEntityId: 'card-b',
      aBeforeRating: null,
      aAfterRating: null,
      aDelta: null,
      aBeforeGames: null,
      aAfterGames: null,
      bBeforeRating: null,
      bAfterRating: null,
      bDelta: null,
      bBeforeGames: null,
      bAfterGames: null,
    });

    expect(mapped.queue).toBe('free');
    expect(mapped.status).toBe('pending');
    expect(mapped.skipReason).toBe('dedup-ip-pair');
    expect(mapped.aEntityType).toBe('preset');
    expect(mapped.bEntityType).toBe('data_card');
  });
});
