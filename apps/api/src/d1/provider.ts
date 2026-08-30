import { createHonoPrimaryDatabaseProvider } from '@mahoshojo/hosted-runtime/database-provider';
import { getDefaultNodeD1Client } from '@mahoshojo/hosted-runtime/node-runtime/d1-client';
import type { NodeDataD1Client } from '@mahoshojo/hosted-runtime/node-runtime/data-ports';

export const honoPrimaryDatabaseProvider = createHonoPrimaryDatabaseProvider(
  getDefaultNodeD1Client,
);

export const getHonoPrimaryD1Client = (): NodeDataD1Client | null => (
  honoPrimaryDatabaseProvider.openSession({ consistency: 'primary' })?.client ?? null
);
