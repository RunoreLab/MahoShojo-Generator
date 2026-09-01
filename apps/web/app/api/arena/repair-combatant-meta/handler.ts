import { getCloudflareDrArenaCompanionService } from '@/app/api/arena/companion-runtime';
import { withArenaCompanionResponseMarkers } from '@mahoshojo/hosted-runtime/arena-companion';

const handler = async (request: Request): Promise<Response> => withArenaCompanionResponseMarkers(
  await getCloudflareDrArenaCompanionService().repairCombatantMeta(request),
  { operation: 'arena/repair-combatant-meta', placement: 'next-dr' },
);

export const appRouteHandler = handler;
export default appRouteHandler;
