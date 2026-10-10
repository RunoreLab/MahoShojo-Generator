import { ARENA_RECONCILIATION_LIMITS } from '@mahoshojo/contracts/arena-reconciliation';
import {
  DesktopArenaHostedStoryReconcileRequestSchema,
  type DesktopArenaHostedStoryReconcileRequest,
} from '@mahoshojo/contracts/desktop-arena-story-transport';
import { receiveArenaReconciliationChannel, type ArenaReconciliationChannelOptions } from './arena-reconciliation-bridge';
import type { InvokeFn } from './cloud-bridge';

/** Only the exact pending identity crosses IPC. Combatants come from the sealed Native original. */
export const reconcileArenaHostedStory = (
  invoke: InvokeFn,
  value: DesktopArenaHostedStoryReconcileRequest,
  options: ArenaReconciliationChannelOptions & { expectedCombatantCount?: number } = {},
) => receiveArenaReconciliationChannel(
  invoke,
  DesktopArenaHostedStoryReconcileRequestSchema.parse(value),
  // This optional stricter response check is local only; Native always validates against its original input.
  options.expectedCombatantCount ?? ARENA_RECONCILIATION_LIMITS.maxCombatants,
  options,
);
