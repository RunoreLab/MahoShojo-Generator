import 'server-only';
import { createCloudflareD1BindingDatabaseProvider } from '@mahoshojo/hosted-runtime/database-provider';
import type { NodeDataD1Client } from '@mahoshojo/hosted-runtime/node-runtime/data-ports';
import { parseHostedApiDeploymentTarget } from '@mahoshojo/hosted-api/hosted-dr';

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
  options: { deploymentTarget?: string } = {},
): NodeDataD1Client | null => {
  const deploymentTarget = parseHostedApiDeploymentTarget(
    options.deploymentTarget ?? process.env.NEXT_PUBLIC_HOSTED_API_ENVIRONMENT,
  );
  if (!deploymentTarget) return null;
  const bindingClient = getCloudflareDrD1Client();
  if (bindingClient) return bindingClient;
  if (deploymentTarget !== 'local' && deploymentTarget !== 'test') return null;
  const localClient = getRuntimeD1Client();
  return localClient ? adaptRuntimeD1ClientForNodeDataPorts(localClient) : null;
};
