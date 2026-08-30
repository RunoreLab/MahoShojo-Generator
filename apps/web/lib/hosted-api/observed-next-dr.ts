import {
  createObservedHostedGenerationService,
  createStructuredNextDrLifecycleObserver,
  type HostedGenerationOperation,
  type HostedGenerationService,
} from '@mahoshojo/hosted-runtime/generation-lifecycle';

const observe = createStructuredNextDrLifecycleObserver();

export const observeNextDrService = (
  operation: HostedGenerationOperation,
  service: HostedGenerationService,
): HostedGenerationService => createObservedHostedGenerationService({
  operation,
  placement: 'next-dr',
  service,
  observe,
});
