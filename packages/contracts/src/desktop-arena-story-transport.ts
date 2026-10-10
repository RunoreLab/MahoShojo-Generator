import { z } from './zod';
import { ARENA_STORY_PROTOCOL_VERSION } from './arena-story';
import { DesktopHostedPresetConfigSchema, DesktopHostedSystemConfigSchema } from './desktop-cloud';
import {
  DESKTOP_ARENA_HOSTED_LIMITS, DESKTOP_ARENA_HOSTED_PROTOCOL_VERSION,
  DesktopArenaHostedScopeSchema, DesktopArenaHostedGenerationIdSchema,
  DesktopArenaHostedRecoveryPointerSchema, DesktopArenaHostedRequestIdSchema,
} from './desktop-arena-hosted';
import { StoryPendingFundingSnapshotSchema, StoryPendingKeySchema, StoryPendingManifestSchema } from './desktop-arena-story';

export { StoryPendingFundingSnapshotSchema, type StoryPendingFundingSnapshot } from './desktop-arena-story';

/** Hash input only. Provider aliases must already be resolved by the existing catalog. */
export const DesktopArenaHostedStoryClientBodyIntentSchema = z.object({
  inputDigest: StoryPendingManifestSchema.shape.inputDigest,
  funding: StoryPendingFundingSnapshotSchema.optional(),
}).strict();
export type DesktopArenaHostedStoryClientBodyIntent = z.infer<typeof DesktopArenaHostedStoryClientBodyIntentSchema>;

const pending = {
  ...DesktopArenaHostedScopeSchema.shape,
  pendingRevision: StoryPendingKeySchema.shape.pendingRevision,
  inputDigest: StoryPendingManifestSchema.shape.inputDigest,
};

/** Same Native stream command, with body sourced exclusively from sealed originals. */
export const DesktopArenaHostedStoryCreateRequestSchema = z.object({
  operation: z.literal('create-story-stream'), ...pending,
  clientBodyHash: DesktopArenaHostedRecoveryPointerSchema.shape.bodyHash,
  systemConfig: DesktopHostedSystemConfigSchema.optional(),
  presetConfig: DesktopHostedPresetConfigSchema.optional(),
  replaceRequestId: DesktopArenaHostedRequestIdSchema.optional(),
}).strict().refine((value) => !(value.systemConfig && value.presetConfig),
  'Funding selections are mutually exclusive');
export type DesktopArenaHostedStoryCreateRequest = z.infer<typeof DesktopArenaHostedStoryCreateRequestSchema>;

/** No renderer combatants or completed proof; Native rechecks originals and lookup. */
export const DesktopArenaHostedStoryReconcileRequestSchema = z.object({
  operation: z.literal('reconcile-story'), ...pending,
  generationId: DesktopArenaHostedGenerationIdSchema,
}).strict();
export type DesktopArenaHostedStoryReconcileRequest = z.infer<typeof DesktopArenaHostedStoryReconcileRequestSchema>;

/** Independently discriminated v4. Legacy v1–v3 parsers never acquire story authority. */
export const DesktopArenaHostedStoryRecoveryPointerSchema = z.object({
  ...z.object(DesktopArenaHostedRecoveryPointerSchema.shape).omit({ webPackageRef: true }).shape,
  version: z.literal(4), purpose: z.literal('story'), delivery: z.literal('stream'),
  protocolVersion: z.literal(DESKTOP_ARENA_HOSTED_PROTOCOL_VERSION), format: z.literal('markdown'),
  storyProtocolVersion: z.literal(ARENA_STORY_PROTOCOL_VERSION),
  sessionId: StoryPendingManifestSchema.shape.sessionId,
  operationId: StoryPendingManifestSchema.shape.operationId,
  inputDigest: StoryPendingManifestSchema.shape.inputDigest,
}).strict().refine((value) => JSON.stringify(value).length <= DESKTOP_ARENA_HOSTED_LIMITS.recoveryPointerCodeUnits);
export type DesktopArenaHostedStoryRecoveryPointer = z.infer<typeof DesktopArenaHostedStoryRecoveryPointerSchema>;
