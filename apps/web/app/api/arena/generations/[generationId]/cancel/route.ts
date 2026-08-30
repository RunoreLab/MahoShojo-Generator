import { withNextDrCapability } from '@/lib/hosted-dr/capability-guard';
import { appRouteHandler } from './handler';

export const POST = withNextDrCapability(
  'arena/generations/[generationId]/cancel',
  appRouteHandler,
);
