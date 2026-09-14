import { z } from './zod';
import { OpaqueKeySchema } from './arena-room';

export const ADMIN_ARENA_OBSERVATION_PATH = '/internal/admin/v1/arena-rooms';
export const ADMIN_ARENA_OBSERVATION_ISSUER = 'mahoshojo-admin';
export const ADMIN_ARENA_OBSERVATION_AUDIENCE = 'mahoshojo-arena-observer-v1';
export const ADMIN_ARENA_OBSERVATION_ACTION = 'arena.rooms.observe';
export const AdminArenaObservationQuerySchema = z.object({
  roomId: OpaqueKeySchema.optional(),
  cursor: z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/).optional(),
}).strict().refine((query) => !(query.roomId && query.cursor), 'Room lookup does not accept cursor');
export type AdminArenaObservationQuery = z.infer<typeof AdminArenaObservationQuerySchema>;
export const AdminArenaObservationItemSchema = z.object({
  roomId: OpaqueKeySchema,
  title: z.string().max(200),
  visibility: z.enum(['public', 'unlisted']),
  status: z.string().min(1).max(40),
  hostUserId: z.number().int().positive(),
  createdAt: z.string().max(64),
  lastActivityAt: z.string().max(64),
  directoryTtlMs: z.number().int().min(-2),
  checkpoint: z.enum(['not-read', 'present', 'missing', 'invalid', 'expiring']),
  checkpointRevision: z.number().int().nonnegative().nullable(),
  memberCount: z.number().int().nonnegative().max(100).nullable(),
}).strict();
export const AdminArenaObservationResponseSchema = z.object({
  protocolVersion: z.literal(1),
  items: z.array(AdminArenaObservationItemSchema).max(128),
  nextCursor: z.string().regex(/^[1-9][0-9]{0,19}$/).nullable(),
  observedAt: z.string().max(64),
}).strict();
export type AdminArenaObservationItem = z.infer<typeof AdminArenaObservationItemSchema>;
export type AdminArenaObservationResponse = z.infer<typeof AdminArenaObservationResponseSchema>;
