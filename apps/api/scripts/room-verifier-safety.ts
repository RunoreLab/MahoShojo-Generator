const SAFE_PREFIX = /^[a-z0-9_-]+$/u;
const RESERVED_PREFIX = /^(?:ci|default|gmr02|gmr09dur|local|preview|prod|production|test|verify)(?:$|[_-])/u;

export const requireSafeRoomVerifierPrefix = (input: Readonly<{
  environmentName: string;
  maxLength: number;
  value: string | undefined;
}>): string => {
  const prefix = input.value?.trim();
  if (
    !prefix
    || prefix.length > input.maxLength
    || !SAFE_PREFIX.test(prefix)
    || RESERVED_PREFIX.test(prefix)
  ) {
    throw new Error(`${input.environmentName} 必须是安全非默认环境标识`);
  }
  return prefix;
};
