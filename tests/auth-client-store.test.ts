import { beforeEach, describe, expect, vi, test } from 'vitest';

let loginResult: {
  success: boolean;
  user?: { id: number; username: string; prefix?: string | null };
  error?: string;
} = { success: false };

let logoutCalls = 0;
let badgeCalls = 0;

vi.mock('@/lib/auth', () => ({
  authApi: {
    verify: vi.fn(async () => ({ success: false })),
    register: vi.fn(async () => ({ success: false })),
    login: vi.fn(async () => loginResult),
    logout: vi.fn(async () => {
      logoutCalls += 1;
    }),
  },
  authStorage: {
    getAuth: vi.fn(async () => null),
    clearAuth: vi.fn(() => undefined),
  },
}));

vi.mock('@/lib/userBadges', () => ({
  getUserBadges: vi.fn(async () => {
    badgeCalls += 1;
    return [];
  }),
}));

describe('auth client store', () => {
  beforeEach(() => {
    loginResult = { success: false };
    logoutCalls = 0;
    badgeCalls = 0;
  });

  test('login and logout broadcast the shared auth snapshot to every subscriber', async () => {
    const {
      getAuthSnapshot,
      loginAndSyncAuthState,
      logoutAndSyncAuthState,
      resetAuthStoreForTests,
      subscribeAuthSnapshot,
    } = await import('@/lib/auth-client-store');

    resetAuthStoreForTests();
    loginResult = {
      success: true,
      user: { id: 7, username: '小圆' },
    };

    const firstSeen: Array<string | null> = [];
    const secondSeen: Array<string | null> = [];
    const unsubscribeFirst = subscribeAuthSnapshot(() => {
      firstSeen.push(getAuthSnapshot().user?.username ?? null);
    });
    const unsubscribeSecond = subscribeAuthSnapshot(() => {
      secondSeen.push(getAuthSnapshot().user?.username ?? null);
    });

    try {
      await loginAndSyncAuthState('madoka@example.test', 'password', 'turnstile-token');

      expect(getAuthSnapshot().user?.username).toBe('小圆');
      expect(firstSeen).toContain('小圆');
      expect(secondSeen).toContain('小圆');
      expect(badgeCalls).toBe(1);

      await logoutAndSyncAuthState();

      expect(getAuthSnapshot().user).toBeNull();
      expect(firstSeen.at(-1)).toBeNull();
      expect(secondSeen.at(-1)).toBeNull();
      expect(logoutCalls).toBe(1);
    } finally {
      unsubscribeFirst();
      unsubscribeSecond();
      resetAuthStoreForTests();
    }
  });
});
