export type RedeemCodeResponse = {
  success?: boolean;
  message?: string;
  error?: string;
  slotCount?: number;
};

type SubmitRedeemCodeInput = {
  code: string;
  authHeader?: string | null;
  fetchImpl?: typeof fetch;
};

const toOptionalNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const buildRedeemCodeRequestInit = (
  code: string,
  authHeader?: string | null,
): RequestInit => {
  const headers = new Headers({
    'Content-Type': 'application/json',
  });

  const normalizedAuthHeader = toOptionalNonEmptyString(authHeader);
  if (normalizedAuthHeader) {
    headers.set('Authorization', normalizedAuthHeader);
  }

  return {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify({ code: code.trim() }),
  };
};

export const submitRedeemCode = async (
  input: SubmitRedeemCodeInput,
): Promise<{ response: Response; data: RedeemCodeResponse }> => {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(
    '/api/redeem-code',
    buildRedeemCodeRequestInit(input.code, input.authHeader),
  );

  const data = (await response.json()) as RedeemCodeResponse;
  return { response, data };
};
