import { withNextDrCapability } from '@/lib/hosted-dr/capability-guard';
import { appRouteHandler } from './handler';

export const GET = withNextDrCapability(
  'arena/generation-requests/[generationRequestId]',
  appRouteHandler,
);
