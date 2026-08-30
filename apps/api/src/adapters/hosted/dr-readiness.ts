import {
  createHostedDrReadinessService,
  type HostedDrReadinessDatabaseProvider,
  type HostedDrReadinessService,
} from '@mahoshojo/hosted-api/hosted-dr';
import { honoPrimaryDatabaseProvider } from '#/d1/provider';

export const createHonoDrReadinessHandler = (
  provider: HostedDrReadinessDatabaseProvider,
): HostedDrReadinessService => createHostedDrReadinessService({
  placement: 'hono-primary',
  provider,
});

const honoDrReadinessHandler = createHonoDrReadinessHandler(honoPrimaryDatabaseProvider);

export const GET = honoDrReadinessHandler;
export const HEAD = honoDrReadinessHandler;
