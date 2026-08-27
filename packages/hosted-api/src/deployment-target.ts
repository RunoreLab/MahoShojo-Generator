export type HostedApiDeploymentTarget = 'production' | 'preview' | 'local' | 'test';

const HOSTED_API_DEPLOYMENT_TARGETS = new Set<HostedApiDeploymentTarget>([
  'production',
  'preview',
  'local',
  'test',
]);

export const parseHostedApiDeploymentTarget = (
  value: string | undefined,
): HostedApiDeploymentTarget | null => {
  const target = value?.trim().toLowerCase();
  return target && HOSTED_API_DEPLOYMENT_TARGETS.has(target as HostedApiDeploymentTarget)
    ? target as HostedApiDeploymentTarget
    : null;
};
