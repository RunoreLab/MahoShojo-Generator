const BETTER_AUTH_SIGN_OUT_PATH = '/api/auth/sign-out';

export type LogoutFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const signOutBetterAuthSession = async (fetchImpl: LogoutFetch = fetch): Promise<boolean> => {
  try {
    const response = await fetchImpl(BETTER_AUTH_SIGN_OUT_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({}),
    });

    return response.ok;
  } catch (error) {
    console.error('[auth][logout] Better Auth sign-out 失败:', error);
    return false;
  }
};
