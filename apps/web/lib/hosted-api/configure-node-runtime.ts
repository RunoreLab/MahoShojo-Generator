import { configureDefaultNodeHostedD1ClientResolver } from '@mahoshojo/hosted-runtime/node-runtime/default-services';

import { getNextHostedD1Client } from '@/lib/hosted-dr/database-provider';

configureDefaultNodeHostedD1ClientResolver(getNextHostedD1Client);
