import { withNextDrCapability } from '@/lib/hosted-dr/capability-guard';
import { appRouteHandler } from './handler';

const guardedRouteHandler = withNextDrCapability('arena/generate-stream', appRouteHandler);

export const POST = guardedRouteHandler;
export const DELETE = guardedRouteHandler;
