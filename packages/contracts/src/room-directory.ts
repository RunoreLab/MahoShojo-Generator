import { z } from 'zod';

import { IsoTimestampSchema, OpaqueKeySchema } from './primitives';

export const MAX_ROOM_DIRECTORY_TITLE_LENGTH = 80;
export const MAX_ROOM_DIRECTORY_CURSOR_LENGTH = 512;
export const DEFAULT_ROOM_DIRECTORY_PAGE_SIZE = 20;
export const MAX_ROOM_DIRECTORY_PAGE_SIZE = 50;

export const RoomDirectoryVisibilitySchema = z.enum(['public', 'unlisted']);
export const RoomDirectoryStatusSchema = z.literal('open');
export const RoomDirectoryCursorSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/u)
  .max(MAX_ROOM_DIRECTORY_CURSOR_LENGTH);

export const RoomDirectoryEntrySchema = z.object({
  roomId: OpaqueKeySchema,
  title: z.string().trim().min(1).max(MAX_ROOM_DIRECTORY_TITLE_LENGTH),
  visibility: RoomDirectoryVisibilitySchema,
  status: RoomDirectoryStatusSchema,
  createdAt: IsoTimestampSchema,
  lastActivityAt: IsoTimestampSchema,
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
