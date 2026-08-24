import { configureDefaultNodeHostedD1ClientResolver } from '@mahoshojo/hosted-runtime/node-runtime/default-services';

import { getRuntimeD1Client } from '@/lib/db/drizzle';
import { adaptRuntimeD1ClientForNodeDataPorts } from '@/lib/db/node-data-port-adapter';

configureDefaultNodeHostedD1ClientResolver(() => {
  const client = getRuntimeD1Client();
  return client ? adaptRuntimeD1ClientForNodeDataPorts(client) : null;
});
