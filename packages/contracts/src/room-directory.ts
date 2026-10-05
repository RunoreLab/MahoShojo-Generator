import { z } from './zod';

import { IsoTimestampSchema, OpaqueKeySchema } from './primitives';
import { MAX_ROOM_MEMBERS } from './limits';

export const MAX_ROOM_DIRECTORY_TITLE_LENGTH = 80;
export const MAX_ROOM_DIRECTORY_CURSOR_LENGTH = 512;
export const DEFAULT_ROOM_DIRECTORY_PAGE_SIZE = 20;
export const MAX_ROOM_DIRECTORY_PAGE_SIZE = 50;

export const RoomDirectoryVisibilitySchema = z.enum(['public', 'unlisted']);
export const RoomDirectoryStatusSchema = z.literal('open');
export const RoomDirectoryTitleSchema = z.string().trim().min(1)
  .max(MAX_ROOM_DIRECTORY_TITLE_LENGTH);
export const RoomDirectoryCursorSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/u)
  .max(MAX_ROOM_DIRECTORY_CURSOR_LENGTH);

export const RoomDirectoryEntrySchema = z.object({
  roomId: OpaqueKeySchema,
  title: RoomDirectoryTitleSchema,
  visibility: RoomDirectoryVisibilitySchema,
  status: RoomDirectoryStatusSchema,
  createdAt: IsoTimestampSchema,
  lastActivityAt: IsoTimestampSchema,
  // 以下为 projection 期可选增强字段（旧 API 不返回也合法，便于 Web/API 滚动部署）：
  hostDisplayName: z.string().trim().min(1).max(200).optional(),
  memberCount: z.number().int().min(1).max(MAX_ROOM_MEMBERS).optional(),
  memberLimit: z.number().int().min(1).max(MAX_ROOM_MEMBERS).optional(),
}).strict();

export const RoomDirectoryPageQuerySchema = z.object({
  cursor: RoomDirectoryCursorSchema.optional(),
  limit: z.number().int().min(1).max(MAX_ROOM_DIRECTORY_PAGE_SIZE)
    .default(DEFAULT_ROOM_DIRECTORY_PAGE_SIZE),
}).strict();

export const RoomDirectoryPageSchema = z.object({
  items: z.array(RoomDirectoryEntrySchema).max(MAX_ROOM_DIRECTORY_PAGE_SIZE),
  nextCursor: RoomDirectoryCursorSchema.nullable(),
}).strict();

export type RoomDirectoryVisibility = z.infer<typeof RoomDirectoryVisibilitySchema>;
export type RoomDirectoryEntry = z.infer<typeof RoomDirectoryEntrySchema>;
export type RoomDirectoryPageQuery = z.infer<typeof RoomDirectoryPageQuerySchema>;
export type RoomDirectoryPage = z.infer<typeof RoomDirectoryPageSchema>;
