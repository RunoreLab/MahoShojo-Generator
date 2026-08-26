import 'server-only';
import { createCloudflareD1BindingDatabaseProvider } from '@mahoshojo/hosted-runtime/database-provider';
import type { NodeDataD1Client } from '@mahoshojo/hosted-runtime/node-runtime/data-ports';

import { getRuntimeD1ClientWithoutHttpFallback } from '@/lib/db/drizzle';

export const cloudflareDrDatabaseProvider = createCloudflareD1BindingDatabaseProvider(
  getRuntimeD1ClientWithoutHttpFallback,
);

export const getCloudflareDrD1Client = (): NodeDataD1Client | null => (
  cloudflareDrDatabaseProvider.openSession({ consistency: 'primary' })?.client ?? null
);
