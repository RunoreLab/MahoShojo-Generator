export const HOSTED_DR_CAPABILITY_HEADER = 'x-mahoshojo-hosted-dr-capability';
export const HOSTED_DR_OPERATION_METHOD_HEADER = 'x-mahoshojo-hosted-dr-method';

export type HostedDrProbeTarget = Readonly<{
  capabilityId: string;
  operationMethod: string;
}>;
