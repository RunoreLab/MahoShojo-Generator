import {
  registeredArenaCompanionRouteService,
  withArenaCompanionResponseMarkers,
} from '@mahoshojo/hosted-runtime/arena-companion';

export const POST = async (request: Request): Promise<Response> => withArenaCompanionResponseMarkers(
  await registeredArenaCompanionRouteService.repairCombatantMeta(request),
  { operation: 'arena/repair-combatant-meta', placement: 'hono-primary' },
);
