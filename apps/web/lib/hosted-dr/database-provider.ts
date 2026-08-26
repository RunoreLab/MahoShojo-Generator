import 'server-only';
import { createCloudflareD1BindingDatabaseProvider } from '@mahoshojo/hosted-runtime/database-provider';
import type { NodeDataD1Client } from '@mahoshojo/hosted-runtime/node-runtime/data-ports';

import {
  getRuntimeD1Client,
  getRuntimeD1ClientWithoutHttpFallback,
} from '@/lib/db/drizzle';
import { adaptRuntimeD1ClientForNodeDataPorts } from '@/lib/db/node-data-port-adapter';

export const cloudflareDrDatabaseProvider = createCloudflareD1BindingDatabaseProvider(
  getRuntimeD1ClientWithoutHttpFallback,
);

export const getCloudflareDrD1Client = (): NodeDataD1Client | null => (
  cloudflareDrDatabaseProvider.openSession({ consistency: 'primary' })?.client ?? null
);

export const getNextHostedD1Client = (
  options: { executionEnvironment?: string } = {},
): NodeDataD1Client | null => {
  const bindingClient = getCloudflareDrD1Client();
  if (bindingClient || (options.executionEnvironment ?? process.env.NODE_ENV) === 'production') {
    return bindingClient;
  }
  const localClient = getRuntimeD1Client();
  return localClient ? adaptRuntimeD1ClientForNodeDataPorts(localClient) : null;
};
