import { describe, expect, it } from 'vitest';

import {
  MAX_ROOM_DIRECTORY_PAGE_SIZE,
  RoomDirectoryEntrySchema,
  RoomDirectoryPageQuerySchema,
  RoomDirectoryPageSchema,
} from '../src/room-directory';

const entry = {
  roomId: 'room-opaque-1',
  title: '周末协作竞技场',
  visibility: 'public',
  status: 'open',
  createdAt: '2026-08-28T08:00:00.000Z',
  lastActivityAt: '2026-08-28T08:10:00.000Z',
};

describe('Arena Room directory contract', () => {
  it('只暴露低频 discovery metadata，不接受 authority 或 secret 字段', () => {
    expect(RoomDirectoryEntrySchema.parse(entry)).toEqual(entry);
    for (const sensitive of [
      { roomEpoch: 'epoch-secret' },
      { hostUserId: 101 },
      { presence: { connections: 2 } },
      { storyChunk: 'not-directory-data' },
      { apiKey: 'secret' },
    ]) {
      expect(RoomDirectoryEntrySchema.safeParse({ ...entry, ...sensitive }).success).toBe(false);
    }
  });

  it('分页大小有硬上限，cursor 只接受 bounded opaque base64url', () => {
    expect(RoomDirectoryPageQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(RoomDirectoryPageQuerySchema.parse({ limit: MAX_ROOM_DIRECTORY_PAGE_SIZE })).toEqual({
      limit: MAX_ROOM_DIRECTORY_PAGE_SIZE,
    });
    expect(RoomDirectoryPageQuerySchema.safeParse({ limit: MAX_ROOM_DIRECTORY_PAGE_SIZE + 1 }).success)
      .toBe(false);
    expect(RoomDirectoryPageQuerySchema.safeParse({ cursor: 'not a cursor' }).success).toBe(false);
    expect(RoomDirectoryPageQuerySchema.safeParse({ cursor: 'a'.repeat(513) }).success).toBe(false);
  });

  it('page 最多容纳硬上限条目，nextCursor 为 nullable opaque value', () => {
    expect(RoomDirectoryPageSchema.parse({ items: [entry], nextCursor: 'eyJ2IjoxfQ' }))
      .toMatchObject({ items: [entry], nextCursor: 'eyJ2IjoxfQ' });
    expect(RoomDirectoryPageSchema.safeParse({
      items: Array.from({ length: MAX_ROOM_DIRECTORY_PAGE_SIZE + 1 }, () => entry),
      nextCursor: null,
    }).success).toBe(false);
  });
});
