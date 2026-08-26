import {
  createHostedDrReadinessService,
  type HostedDrReadinessDatabaseProvider,
  type HostedDrReadinessService,
} from '@mahoshojo/hosted-api/hosted-dr';

import { cloudflareDrDatabaseProvider } from '@/lib/hosted-dr/database-provider';

export const createNextDrReadinessHandler = (
  provider: HostedDrReadinessDatabaseProvider,
): HostedDrReadinessService => createHostedDrReadinessService({
  placement: 'next-dr',
  provider,
});

export const appRouteHandler = createNextDrReadinessHandler(
  cloudflareDrDatabaseProvider,
);
