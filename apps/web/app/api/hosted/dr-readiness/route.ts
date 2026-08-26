import { withNextDrCapability } from '@/lib/hosted-dr/capability-guard';
import { appRouteHandler } from './handler';

const guardedRouteHandler = withNextDrCapability(
  'hosted/dr-readiness',
  appRouteHandler,
);

export const GET = guardedRouteHandler;
export const HEAD = guardedRouteHandler;
