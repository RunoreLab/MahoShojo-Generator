export const HOSTED_DR_ACTIVATION_CANDIDATE_ENVIRONMENT =
  'HOSTED_DR_ACTIVATION_CANDIDATE' as const;

const HOSTED_DR_READINESS_PATH = '/api/hosted/dr-readiness';

export const parseHostedDrActivationCandidate = (
  value: string | undefined,
): boolean => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'false') return false;
  if (normalized === 'true') return true;
  throw new Error(`${HOSTED_DR_ACTIVATION_CANDIDATE_ENVIRONMENT} 只能为 true 或 false`);
};

export const isHostedDrActivationCandidateRequestAllowed = (
  pathname: string,
  method: string,
): boolean => pathname === HOSTED_DR_READINESS_PATH
  && (method.toUpperCase() === 'GET' || method.toUpperCase() === 'HEAD');

export const createHostedDrActivationCandidateRestrictedResponse = (): Response => new Response(
  JSON.stringify({
    code: 'HOSTED_DR_ACTIVATION_CANDIDATE_RESTRICTED',
    error: 'Hosted DR activation candidate only serves readiness probes',
  }),
  {
    status: 503,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  },
);
