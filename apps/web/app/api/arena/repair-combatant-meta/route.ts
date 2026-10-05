import { withNextDrCapability } from '@/lib/hosted-dr/capability-guard';
import { appRouteHandler } from './handler';

const guardedRouteHandler = withNextDrCapability(
  'arena/repair-combatant-meta',
  appRouteHandler,
);

export const GET = guardedRouteHandler;
export const HEAD = guardedRouteHandler;
export const OPTIONS = guardedRouteHandler;
export const POST = guardedRouteHandler;
export const PUT = guardedRouteHandler;
export const PATCH = guardedRouteHandler;
export const DELETE = guardedRouteHandler;
