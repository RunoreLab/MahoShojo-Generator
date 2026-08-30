import {
  createObservedHostedGenerationService,
  type HostedGenerationOperation,
  type HostedGenerationService,
} from '@mahoshojo/hosted-runtime/generation-lifecycle';
import { observeHostedGenerationLifecycle } from '@mahoshojo/hosted-runtime/telemetry';

export const observeHonoHostedGenerationService = (
  operation: HostedGenerationOperation,
  service: HostedGenerationService,
): HostedGenerationService => createObservedHostedGenerationService({
  operation,
  placement: 'hono-primary',
  service,
  observe: observeHostedGenerationLifecycle,
});
