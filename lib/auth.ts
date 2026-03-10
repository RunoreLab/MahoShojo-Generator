import type { UserBadge } from '@/types/badge';
import { signOutBetterAuthSession } from '@/lib/auth/logout';
import { mapDeckDetailPayload, mapDeckListPayload } from '@/lib/deck-client-mappers';

const STORAGE_KEY = 'mahoshojo_auth';
const ENCRYPTION_KEY = 'mahoshojo_2024_secret_encryption_key';

export interface AuthData {
  username: string;
  authKey?: string;
  userId?: number;
  activityToken?: string;
}

// Web Crypto API 加密工具
class CryptoHelper {
  private async getKey(): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(ENCRYPTION_KEY);
    const hashBuffer = await crypto.subtle.digest('SHA-256', keyData);
    
    return crypto.subtle.importKey(
      'raw',
      hashBuffer,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async encrypt(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const encodedData = encoder.encode(data);
    
    const key = await this.getKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    const encryptedBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encodedData
    );
    
    const combined = new Uint8Array(iv.length + encryptedBuffer.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encryptedBuffer), iv.length);
    
    return btoa(Array.from(combined, byte => String.fromCharCode(byte)).join(''));
  }

  async decrypt(encryptedData: string): Promise<string | null> {
    try {
      const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
      
      const iv = combined.slice(0, 12);
      const data = combined.slice(12);
      
      const key = await this.getKey();
      
      const decryptedBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        data
      );
      
      const decoder = new TextDecoder();
      return decoder.decode(decryptedBuffer);
    } catch (error) {
      console.error('Decryption failed:', error);
      return null;
    }
  }
}

const cryptoHelper = new CryptoHelper();

let cachedEncryptedValue: string | null = null;
let cachedAuthValue: AuthData | null = null;
let cachedAuthPromise: Promise<AuthData | null> | null = null;
let sessionBootstrapPromise: Promise<AuthData | null> | null = null;

type VerifyAuthResponse = {
  success: boolean;
  authKey?: string | null;
  user?: { id: number; username: string; prefix?: string | null };
  badges?: UserBadge[];
  activityToken?: string | null;
};

const normalizeAuthKey = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeActivityToken = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined;

const readStoredAuthHeader = (auth: AuthData | null): string | null => {
  const authKey = normalizeAuthKey(auth?.authKey);
  return authKey ? `Bearer ${authKey}` : null;
};

const fetchVerifyAuthState = async (authHeader: string | null): Promise<VerifyAuthResponse> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (authHeader) {
    headers.Authorization = authHeader;
  }

  const response = await fetch('/api/auth/verify', {
    method: 'POST',
    headers,
    credentials: 'include',
  });

  return (await response.json()) as VerifyAuthResponse;
};

const persistVerifyAuthState = async (
  data: VerifyAuthResponse,
  fallbackAuth: AuthData | null,
): Promise<AuthData | null> => {
  if (!data?.success || !data.user || typeof data.user.username !== 'string') {
    return null;
  }

  const nextAuth: AuthData = {
    username: data.user.username,
  };

  const authKey = normalizeAuthKey(data.authKey) ?? normalizeAuthKey(fallbackAuth?.authKey);
  if (authKey) {
    nextAuth.authKey = authKey;
  }

  if (typeof data.user.id === 'number' && Number.isSafeInteger(data.user.id) && data.user.id > 0) {
    nextAuth.userId = data.user.id;
  } else if (typeof fallbackAuth?.userId === 'number' && Number.isSafeInteger(fallbackAuth.userId) && fallbackAuth.userId > 0) {
    nextAuth.userId = fallbackAuth.userId;
  }

  const activityToken = normalizeActivityToken(data.activityToken) ?? normalizeActivityToken(fallbackAuth?.activityToken);
  if (activityToken) {
    nextAuth.activityToken = activityToken;
  }

  await authStorage.setAuth(nextAuth);
  return nextAuth;
};

const bootstrapAuthFromSession = async (): Promise<AuthData | null> => {
  if (sessionBootstrapPromise) {
    return await sessionBootstrapPromise;
  }

  sessionBootstrapPromise = (async () => {
    const data = await fetchVerifyAuthState(null);
    return persistVerifyAuthState(data, null);
  })();

  try {
    return await sessionBootstrapPromise;
  } catch (error) {
    console.error('Session auth bootstrap error:', error);
    return null;
  } finally {
    sessionBootstrapPromise = null;
  }
};

export const authStorage = {
  // 加密存储认证信息
  async setAuth(data: AuthData): Promise<void> {
    const encrypted = await cryptoHelper.encrypt(JSON.stringify(data));
    localStorage.setItem(STORAGE_KEY, encrypted);
    cachedEncryptedValue = encrypted;
    cachedAuthValue = data;
    cachedAuthPromise = null;
  },

  // 获取并解密认证信息
  async getAuth(): Promise<AuthData | null> {
    try {
      const encrypted = localStorage.getItem(STORAGE_KEY);
      if (!encrypted) {
        cachedEncryptedValue = null;
        cachedAuthValue = null;
        cachedAuthPromise = null;
        return null;
      }

      if (encrypted === cachedEncryptedValue) {
        if (cachedAuthPromise) return await cachedAuthPromise;
        return cachedAuthValue;
      }

      cachedEncryptedValue = encrypted;
      cachedAuthPromise = (async () => {
        const decryptedStr = await cryptoHelper.decrypt(encrypted);
        if (!decryptedStr) {
          cachedAuthValue = null;
          return null;
        }
        try {
          cachedAuthValue = JSON.parse(decryptedStr) as AuthData;
          return cachedAuthValue;
        } catch (error) {
          console.error('Failed to parse auth data:', error);
          cachedAuthValue = null;
          return null;
        } finally {
          cachedAuthPromise = null;
        }
      })();

      return await cachedAuthPromise;

    } catch (error) {
      console.error('Failed to decrypt auth data:', error);
      return null;
    }
  },

  // 清除认证信息
  clearAuth(): void {
    localStorage.removeItem(STORAGE_KEY);
    cachedEncryptedValue = null;
    cachedAuthValue = null;
    cachedAuthPromise = null;
    sessionBootstrapPromise = null;
  },

  // 获取认证头
  async getAuthHeader(): Promise<string | null> {
    const auth = await this.getAuth();
    const cachedHeader = readStoredAuthHeader(auth);
    if (cachedHeader) return cachedHeader;

    const bootstrappedAuth = await bootstrapAuthFromSession();
    return readStoredAuthHeader(bootstrappedAuth);
  },

  // 获取“活跃统计”头（不依赖额外 D1 读取）
  async getActivityHeaders(): Promise<Record<string, string>> {
    const auth = (await this.getAuth()) ?? (await bootstrapAuthFromSession());
    if (!auth) return {};

    const headers: Record<string, string> = {};
    if (auth.activityToken) {
      headers['x-mahoshojo-activity-token'] = auth.activityToken;
    }
    if (typeof auth.userId === 'number' && Number.isSafeInteger(auth.userId) && auth.userId > 0) {
      headers['x-mahoshojo-user-id'] = String(auth.userId);
    }
    return headers;
  },

  async buildAuthenticatedRequestInit(init: RequestInit = {}): Promise<RequestInit> {
    const headers = new Headers(init.headers ?? {});
    const authHeader = await this.getAuthHeader();
    if (authHeader && !headers.has('Authorization')) {
      headers.set('Authorization', authHeader);
    }

    return {
      ...init,
      headers,
      credentials: init.credentials ?? 'same-origin',
    };
  },

  async fetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    return fetch(input, await this.buildAuthenticatedRequestInit(init));
  }
};

// API 请求工具函数
export const authApi = {
  // 注册
  async register(username: string, email: string, turnstileToken: string, password: string): Promise<{
    success: boolean;
    authKey?: string;
    authMode?: 'better-auth' | 'legacy';
    message?: string;
    error?: string;
    user?: { id: number; username: string; prefix?: string | null };
    activityToken?: string | null;
  }> {
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password, turnstileToken })
      });

      const data = await response.json();
      
      if (response.ok && data.success) {
        const nextAuthKey = typeof data.authKey === 'string' && data.authKey.trim().length > 0 ? data.authKey.trim() : null;
        if (nextAuthKey) {
          await authStorage.setAuth({
            username: typeof data.user?.username === 'string' ? data.user.username : username,
            authKey: nextAuthKey,
            userId: typeof data.user?.id === 'number' ? data.user.id : undefined,
            activityToken: typeof data.activityToken === 'string' ? data.activityToken : undefined,
          });
        } else {
          authStorage.clearAuth();
        }
        return data;
      }
      
      return { success: false, error: data.error || '注册失败' };
    } catch (error) {
      console.error('Register error:', error);
      return { success: false, error: '网络错误' };
    }
  },

  // 登录
  async login(
    identifier: string,
    credential: string,
    turnstileToken: string,
    mode: 'password' | 'legacy' = 'password',
  ): Promise<{
    success: boolean;
    authMode?: 'better-auth' | 'legacy';
    authKey?: string;
    user?: { id: number; username: string; prefix?: string | null };
    activityToken?: string | null;
    error?: string;
  }> {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, credential, mode, turnstileToken })
      });

      const data = await response.json();
      
      if (response.ok && data.success) {
        const fromServerAuthKey = typeof data.authKey === 'string' && data.authKey.trim().length > 0 ? data.authKey.trim() : null;
        const fallbackLegacyKey = mode === 'legacy' && credential.trim().length > 0 ? credential.trim() : null;
        const persistedAuthKey = fromServerAuthKey ?? fallbackLegacyKey;

        if (persistedAuthKey) {
          await authStorage.setAuth({
            username:
              typeof data.user?.username === 'string'
                ? data.user.username
                : mode === 'legacy'
                  ? identifier
                  : '',
            authKey: persistedAuthKey,
            userId: typeof data.user?.id === 'number' ? data.user.id : undefined,
            activityToken: typeof data.activityToken === 'string' ? data.activityToken : undefined,
          });
        } else {
          authStorage.clearAuth();
        }
        return data;
      }
      
      return { success: false, error: data.error || '登录失败' };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: '网络错误' };
    }
  },

  // 验证当前认证状态
  async verify(): Promise<{
    success: boolean;
    authKey?: string | null;
    user?: { id: number; username: string; prefix?: string | null };
    badges?: UserBadge[];
    activityToken?: string | null;
  }> {
    const auth = await authStorage.getAuth();
    const authHeader = readStoredAuthHeader(auth);

    try {
      const data = await fetchVerifyAuthState(authHeader);
      if (data?.success && data?.user?.id) {
        await persistVerifyAuthState(data, auth);
      }
      return data;
    } catch (error) {
      console.error('Verify error:', error);
      return { success: false };
    }
  },

  // 退出登录
  async logout(): Promise<void> {
    await signOutBetterAuthSession();
    authStorage.clearAuth();
  }
};

// 数据卡 API
export const dataCardApi = {
  // 获取所有数据卡
  async getCards(search?: string, sortBy?: 'likes' | 'usage' | 'favorites' | 'created_at'): Promise<any[]> {
    try {
      const searchParams = new URLSearchParams();
      if (search) {
        searchParams.append('search', search);
      }
      if (sortBy) {
        searchParams.append('sortBy', sortBy);
      }
      
      const queryString = searchParams.toString();
      const url = `/api/data-cards${queryString ? `?${queryString}` : ''}`;
      
      const response = await authStorage.fetch(url);

      if (response.ok) {
        const data = await response.json();
        return data.cards || [];
      }
      return [];
    } catch (error) {
      console.error('Get cards error:', error);
      return [];
    }
  },

  // 获取用户数据卡容量
  async getUserCapacity(): Promise<number | null> {
    try {
      const response = await authStorage.fetch('/api/user-capacity');

      if (response.ok) {
        const data = await response.json();
        return data.capacity || null;
      }
      return null;
    } catch (error) {
      console.error('Get user capacity error:', error);
      return null;
    }
  },

  // 创建数据卡
  async createCard(type: 'character' | 'scenario' | 'history' | 'questionnaire', name: string, description: string, data: any, isPublic: number = 0): Promise<{
    success: boolean;
    id?: string;
    error?: string;
    message?: string;
    reviewStatus?: 'pending' | 'approved' | 'rejected';
    visualAssetsRejected?: boolean;
  }> {
    try {
      const response = await authStorage.fetch('/api/data-cards', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type, name, description, data, isPublic })
      });

      const result = await response.json();
      return result;
    } catch (error) {
      console.error('Create card error:', error);
      return { success: false, error: '创建失败' };
    }
  },

  // 更新数据卡
  async updateCard(id: string, name: string, description: string, isPublic?: number): Promise<{
    success: boolean;
    error?: string;
    message?: string;
    reviewStatus?: 'pending' | 'approved' | 'rejected';
    visualAssetsRejected?: boolean;
  }> {
    try {
      const response = await authStorage.fetch('/api/data-cards', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id, name, description, isPublic })
      });

      const result = await response.json();
      return result;
    } catch (error) {
      console.error('Update card error:', error);
      return { success: false, error: '更新失败' };
    }
  },

  // 替换数据卡（包含内容更新，触发审核）
  async replaceCard(
    id: string,
    payload: { name?: string; description?: string; isPublic?: number; data: any }
  ): Promise<{
    success: boolean;
    pendingReview?: boolean;
    error?: string;
    message?: string;
    reviewStatus?: 'pending' | 'approved' | 'rejected';
    visualAssetsRejected?: boolean;
  }> {
    try {
      const response = await authStorage.fetch('/api/data-cards', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id, ...payload })
      });

      const result = await response.json();
      return result;
    } catch (error) {
      console.error('Replace card error:', error);
      return { success: false, error: '替换失败' };
    }
  },

  // 删除数据卡
  async deleteCard(id: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const response = await authStorage.fetch(`/api/data-cards?id=${id}`, {
        method: 'DELETE',
      });

      const result = await response.json();
      return result;
    } catch (error) {
      console.error('Delete card error:', error);
      return { success: false, error: '删除失败' };
    }
  },

  // 获取回收站列表
  async getRecycleBin(): Promise<any[]> {
    try {
      const response = await authStorage.fetch('/api/data-card-recycle');

      if (response.ok) {
        const data = await response.json();
        return data.cards || [];
      }
      return [];
    } catch (error) {
      console.error('Get recycle bin error:', error);
      return [];
    }
  },

  // 恢复回收站中的数据卡
  async restoreCard(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await authStorage.fetch('/api/data-card-recycle', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id })
      });

      const result = await response.json();
      if (response.ok) {
        return result;
      }
      return { success: false, error: result.error || '恢复失败' };
    } catch (error) {
      console.error('Restore card error:', error);
      return { success: false, error: '恢复失败' };
    }
  },

  // 永久删除回收站中的数据卡
  async deleteRecycleCard(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await authStorage.fetch(`/api/data-card-recycle?id=${id}`, {
        method: 'DELETE',
      });

      const result = await response.json();
      if (response.ok) {
        return result;
      }
      return { success: false, error: result.error || '删除失败' };
    } catch (error) {
      console.error('Delete recycle card error:', error);
      return { success: false, error: '删除失败' };
    }
  }
};

export const favoritesApi = {
  async getFavorites(options?: { type?: 'character' | 'scenario' | 'history' | 'questionnaire'; idsOnly?: boolean }) {
    const params = new URLSearchParams();
    if (options?.type) {
      params.append('type', options.type);
    }
    if (options?.idsOnly) {
      params.append('idsOnly', '1');
    }

    const response = await authStorage.fetch(`/api/favorites${params.size ? `?${params.toString()}` : ''}`);

    if (!response.ok) {
      return { success: false, favorites: [] };
    }

    return response.json();
  },

  async add(cardId: string) {
    const response = await authStorage.fetch('/api/favorites', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cardId })
    });

    return response.json();
  },

  async remove(cardId: string) {
    const response = await authStorage.fetch('/api/favorites', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cardId })
    });

    return response.json();
  }
};

export const deckApi = {
  async getMyDecks(): Promise<{ decks: any[]; capacity?: number; deckCount?: number } | null> {
    try {
      const response = await authStorage.fetch('/api/decks');

      if (!response.ok) return null;
      const data = await response.json();
      return mapDeckListPayload(data);
    } catch (error) {
      console.error('Get my decks error:', error);
      return null;
    }
  },

  async createDeck(payload: { name: string; description?: string; isPublic?: number }): Promise<any | null> {
    try {
      const response = await authStorage.fetch('/api/decks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (!response.ok) {
        return { success: false, error: data?.error || '创建失败' };
      }
      return data;
    } catch (error) {
      console.error('Create deck error:', error);
      return { success: false, error: '网络错误' };
    }
  },

  async updateDeck(deckId: string, payload: { name?: string; description?: string; isPublic?: number }): Promise<boolean> {
    try {
      const response = await authStorage.fetch('/api/decks', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: deckId, ...payload })
      });
      return response.ok;
    } catch (error) {
      console.error('Update deck error:', error);
      return false;
    }
  },

  async deleteDeck(deckId: string): Promise<boolean> {
    try {
      const response = await authStorage.fetch(`/api/decks?id=${encodeURIComponent(deckId)}`, {
        method: 'DELETE',
      });
      return response.ok;
    } catch (error) {
      console.error('Delete deck error:', error);
      return false;
    }
  },

  async getDeckCards(deckId: string): Promise<{ deck: any; cards: any[] } | null> {
    try {
      const response = await authStorage.fetch(`/api/deck-cards?deckId=${encodeURIComponent(deckId)}`);

      if (!response.ok) return null;
      const data = await response.json();
      return mapDeckDetailPayload(data);
    } catch (error) {
      console.error('Get deck cards error:', error);
      return null;
    }
  },

  async addDeckCards(deckId: string, cardIds: string[]): Promise<any | null> {
    try {
      const response = await authStorage.fetch('/api/deck-cards', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ deckId, cardIds })
      });
      return response.json();
    } catch (error) {
      console.error('Add deck cards error:', error);
      return { success: false, error: '网络错误' };
    }
  },

  async removeDeckCards(deckId: string, cardIds: string[]): Promise<boolean> {
    try {
      const response = await authStorage.fetch('/api/deck-cards', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ deckId, cardIds })
      });
      return response.ok;
    } catch (error) {
      console.error('Remove deck cards error:', error);
      return false;
    }
  },

  async pruneInaccessible(deckId: string): Promise<any | null> {
    try {
      const response = await authStorage.fetch('/api/deck-cards', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ deckId, action: 'pruneInaccessible' })
      });
      return response.json();
    } catch (error) {
      console.error('Prune deck cards error:', error);
      return { success: false, error: '网络错误' };
    }
  },

  async getPublicDecks(
    params: { limit: number; offset: number; search?: string; sortBy?: 'likes' | 'favorites' | 'createdAt' | 'created_at' }
  ): Promise<any[]> {
    try {
      const qs = new URLSearchParams();
      qs.set('limit', String(params.limit));
      qs.set('offset', String(params.offset));
      if (params.search) qs.set('search', params.search);
      if (params.sortBy) qs.set('sortBy', params.sortBy);

      const response = await fetch(`/api/public-decks?${qs.toString()}`);
      if (!response.ok) return [];
      const data = await response.json();
      return mapDeckListPayload(data).decks;
    } catch (error) {
      console.error('Get public decks error:', error);
      return [];
    }
  },

  async getPublicDeckDetail(deckId: string): Promise<{ deck: any; cards: any[] } | null> {
    try {
      const response = await fetch(`/api/public-decks?id=${encodeURIComponent(deckId)}`);
      if (!response.ok) return null;
      const data = await response.json();
      return mapDeckDetailPayload(data);
    } catch (error) {
      console.error('Get public deck detail error:', error);
      return null;
    }
  },

  async getPublicCharacterCards(search?: string): Promise<any[]> {
    try {
      const qs = new URLSearchParams();
      qs.set('type', 'character');
      qs.set('limit', '30');
      qs.set('offset', '0');
      if (search) qs.set('search', search);
      const response = await fetch(`/api/public-data-cards?${qs.toString()}`);
      if (!response.ok) return [];
      const data = await response.json();
      return data.cards || [];
    } catch (error) {
      console.error('Get public character cards error:', error);
      return [];
    }
  }
};

export const deckFavoritesApi = {
  async getFavoriteIds(): Promise<string[]> {
    try {
      const response = await authStorage.fetch('/api/deck-favorites?idsOnly=1');
      if (!response.ok) return [];
      const data = await response.json();
      return data.ids || [];
    } catch (error) {
      console.error('Get deck favorite ids error:', error);
      return [];
    }
  },

  async getFavorites(): Promise<any[]> {
    try {
      const response = await authStorage.fetch('/api/deck-favorites');
      if (!response.ok) return [];
      const data = await response.json();
      return mapDeckListPayload(data).decks;
    } catch (error) {
      console.error('Get deck favorites error:', error);
      return [];
    }
  },

  async addFavorite(deckId: string): Promise<boolean> {
    try {
      const response = await authStorage.fetch('/api/deck-favorites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ deckId })
      });
      return response.ok;
    } catch (error) {
      console.error('Add deck favorite error:', error);
      return false;
    }
  },

  async removeFavorite(deckId: string): Promise<boolean> {
    try {
      const response = await authStorage.fetch('/api/deck-favorites', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ deckId })
      });
      return response.ok;
    } catch (error) {
      console.error('Remove deck favorite error:', error);
      return false;
    }
  }
};

export const deckStatsApi = {
  async like(deckId: string): Promise<boolean> {
    try {
      const response = await fetch('/api/deck-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deckId, type: 'like' })
      });
      return response.ok;
    } catch (error) {
      console.error('Like deck error:', error);
      return false;
    }
  }
};
