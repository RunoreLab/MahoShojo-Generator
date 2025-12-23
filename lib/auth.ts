const STORAGE_KEY = 'mahoshojo_auth';
const ENCRYPTION_KEY = 'mahoshojo_2024_secret_encryption_key';

export interface AuthData {
  username: string;
  authKey: string;
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

export const authStorage = {
  // 加密存储认证信息
  async setAuth(data: AuthData): Promise<void> {
    const encrypted = await cryptoHelper.encrypt(JSON.stringify(data));
    localStorage.setItem(STORAGE_KEY, encrypted);
  },

  // 获取并解密认证信息
  async getAuth(): Promise<AuthData | null> {
    try {
      const encrypted = localStorage.getItem(STORAGE_KEY);
      if (!encrypted) return null;

      const decryptedStr = await cryptoHelper.decrypt(encrypted);
      if (!decryptedStr) return null;
      
      return JSON.parse(decryptedStr) as AuthData;
    } catch (error) {
      console.error('Failed to decrypt auth data:', error);
      return null;
    }
  },

  // 清除认证信息
  clearAuth(): void {
    localStorage.removeItem(STORAGE_KEY);
  },

  // 获取认证头
  async getAuthHeader(): Promise<string | null> {
    const auth = await this.getAuth();
    return auth ? `Bearer ${auth.authKey}` : null;
  }
};

// API 请求工具函数
export const authApi = {
  // 注册
  async register(username: string, email: string, turnstileToken: string): Promise<{
    success: boolean;
    authKey?: string;
    message?: string;
    error?: string;
  }> {
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, turnstileToken })
      });

      const data = await response.json();
      
      if (response.ok && data.success) {
        await authStorage.setAuth({ username, authKey: data.authKey });
        return data;
      }
      
      return { success: false, error: data.error || '注册失败' };
    } catch (error) {
      console.error('Register error:', error);
      return { success: false, error: '网络错误' };
    }
  },

  // 登录
  async login(username: string, authKey: string, turnstileToken: string): Promise<{
    success: boolean;
    user?: { id: number; username: string; prefix?: string | null };
    error?: string;
  }> {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, authKey, turnstileToken })
      });

      const data = await response.json();
      
      if (response.ok && data.success) {
        await authStorage.setAuth({ username, authKey });
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
    user?: { id: number; username: string; prefix?: string | null };
  }> {
    const authHeader = await authStorage.getAuthHeader();
    if (!authHeader) {
      return { success: false };
    }

    try {
      const response = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': authHeader
        }
      });

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Verify error:', error);
      return { success: false };
    }
  },

  // 退出登录
  logout(): void {
    authStorage.clearAuth();
  }
};

// 数据卡 API
export const dataCardApi = {
  // 获取所有数据卡
  async getCards(search?: string, sortBy?: 'likes' | 'usage' | 'favorites' | 'created_at'): Promise<any[]> {
    const authHeader = await authStorage.getAuthHeader();
    if (!authHeader) return [];

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
      
      const response = await fetch(url, {
        headers: { 'Authorization': authHeader }
      });

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
    const authHeader = await authStorage.getAuthHeader();
    if (!authHeader) return null;

    try {
      const response = await fetch('/api/user-capacity', {
        headers: { 'Authorization': authHeader }
      });

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
  async createCard(type: 'character' | 'scenario', name: string, description: string, data: any, isPublic: number = 0): Promise<{
    success: boolean;
    id?: number;
    error?: string;
  }> {
    const authHeader = await authStorage.getAuthHeader();
    if (!authHeader) {
      return { success: false, error: '未登录' };
    }

    try {
      const response = await fetch('/api/data-cards', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': authHeader
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
  }> {
    const authHeader = await authStorage.getAuthHeader();
    if (!authHeader) {
      return { success: false, error: '未登录' };
    }

    try {
      const response = await fetch('/api/data-cards', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': authHeader
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
  ): Promise<{ success: boolean; pendingReview?: boolean; error?: string }> {
    const authHeader = await authStorage.getAuthHeader();
    if (!authHeader) {
      return { success: false, error: '未登录' };
    }

    try {
      const response = await fetch('/api/data-cards', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader
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
    const authHeader = await authStorage.getAuthHeader();
    if (!authHeader) {
      return { success: false, error: '未登录' };
    }

    try {
      const response = await fetch(`/api/data-cards?id=${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': authHeader }
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
    const authHeader = await authStorage.getAuthHeader();
    if (!authHeader) return [];

    try {
      const response = await fetch('/api/data-card-recycle', {
        headers: { 'Authorization': authHeader }
      });

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
    const authHeader = await authStorage.getAuthHeader();
    if (!authHeader) {
      return { success: false, error: '未登录' };
    }

    try {
      const response = await fetch('/api/data-card-recycle', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader
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
    const authHeader = await authStorage.getAuthHeader();
    if (!authHeader) {
      return { success: false, error: '未登录' };
    }

    try {
      const response = await fetch(`/api/data-card-recycle?id=${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': authHeader }
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
  async getFavorites(options?: { type?: 'character' | 'scenario'; idsOnly?: boolean }) {
    const authHeader = await authStorage.getAuthHeader();
    if (!authHeader) return { success: false, favorites: [] };

    const params = new URLSearchParams();
    if (options?.type) {
      params.append('type', options.type);
    }
    if (options?.idsOnly) {
      params.append('idsOnly', '1');
    }

    const response = await fetch(`/api/favorites${params.size ? `?${params.toString()}` : ''}`, {
      headers: { 'Authorization': authHeader }
    });

    if (!response.ok) {
      return { success: false, favorites: [] };
    }

    return response.json();
  },

  async add(cardId: string) {
    const authHeader = await authStorage.getAuthHeader();
    if (!authHeader) {
      return { success: false, error: '未登录' };
    }

    const response = await fetch('/api/favorites', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      },
      body: JSON.stringify({ cardId })
    });

    return response.json();
  },

  async remove(cardId: string) {
    const authHeader = await authStorage.getAuthHeader();
    if (!authHeader) {
      return { success: false, error: '未登录' };
    }

    const response = await fetch('/api/favorites', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      },
      body: JSON.stringify({ cardId })
    });

    return response.json();
  }
};

export const deckApi = {
  async getMyDecks(): Promise<{ decks: any[]; capacity?: number; deckCount?: number } | null> {
    const authHeader = await authStorage.getAuthHeader();
    if (!authHeader) return null;

    try {
      const response = await fetch('/api/decks', {
        headers: { Authorization: authHeader }
      });

      if (!response.ok) return null;
      return response.json();
    } catch (error) {
      console.error('Get my decks error:', error);
      return null;
    }
  },

  async createDeck(payload: { name: string; description?: string; isPublic?: number }): Promise<any | null> {
    const authHeader = await authStorage.getAuthHeader();
    if (!authHeader) return { success: false, error: '未登录' };

    try {
      const response = await fetch('/api/decks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader
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
    const authHeader = await authStorage.getAuthHeader();
    if (!authHeader) return false;

    try {
      const response = await fetch('/api/decks', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader
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
    const authHeader = await authStorage.getAuthHeader();
    if (!authHeader) return false;

    try {
      const response = await fetch(`/api/decks?id=${encodeURIComponent(deckId)}`, {
        method: 'DELETE',
        headers: { Authorization: authHeader }
      });
      return response.ok;
    } catch (error) {
      console.error('Delete deck error:', error);
      return false;
    }
  },

  async getDeckCards(deckId: string): Promise<{ deck: any; cards: any[] } | null> {
    const authHeader = await authStorage.getAuthHeader();
    if (!authHeader) return null;

    try {
      const response = await fetch(`/api/deck-cards?deckId=${encodeURIComponent(deckId)}`, {
        headers: { Authorization: authHeader }
      });

      if (!response.ok) return null;
      return response.json();
    } catch (error) {
      console.error('Get deck cards error:', error);
      return null;
    }
  },

  async addDeckCards(deckId: string, cardIds: string[]): Promise<any | null> {
    const authHeader = await authStorage.getAuthHeader();
    if (!authHeader) return { success: false, error: '未登录' };

    try {
      const response = await fetch('/api/deck-cards', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader
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
    const authHeader = await authStorage.getAuthHeader();
    if (!authHeader) return false;

    try {
      const response = await fetch('/api/deck-cards', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader
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
    const authHeader = await authStorage.getAuthHeader();
    if (!authHeader) return { success: false, error: '未登录' };

    try {
      const response = await fetch('/api/deck-cards', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader
        },
        body: JSON.stringify({ deckId, action: 'pruneInaccessible' })
      });
      return response.json();
    } catch (error) {
      console.error('Prune deck cards error:', error);
      return { success: false, error: '网络错误' };
    }
  },

  async getPublicDecks(params: { limit: number; offset: number; search?: string; sortBy?: 'likes' | 'favorites' | 'created_at' }): Promise<any[]> {
    try {
      const qs = new URLSearchParams();
      qs.set('limit', String(params.limit));
      qs.set('offset', String(params.offset));
      if (params.search) qs.set('search', params.search);
      if (params.sortBy) qs.set('sortBy', params.sortBy);

      const response = await fetch(`/api/public-decks?${qs.toString()}`);
      if (!response.ok) return [];
      const data = await response.json();
      return data.decks || [];
    } catch (error) {
      console.error('Get public decks error:', error);
      return [];
    }
  },

  async getPublicDeckDetail(deckId: string): Promise<{ deck: any; cards: any[] } | null> {
    try {
      const response = await fetch(`/api/public-decks?id=${encodeURIComponent(deckId)}`);
      if (!response.ok) return null;
      return response.json();
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
    const authHeader = await authStorage.getAuthHeader();
    if (!authHeader) return [];

    try {
      const response = await fetch('/api/deck-favorites?idsOnly=1', {
        headers: { Authorization: authHeader }
      });
      if (!response.ok) return [];
      const data = await response.json();
      return data.ids || [];
    } catch (error) {
      console.error('Get deck favorite ids error:', error);
      return [];
    }
  },

  async getFavorites(): Promise<any[]> {
    const authHeader = await authStorage.getAuthHeader();
    if (!authHeader) return [];

    try {
      const response = await fetch('/api/deck-favorites', {
        headers: { Authorization: authHeader }
      });
      if (!response.ok) return [];
      const data = await response.json();
      return data.decks || [];
    } catch (error) {
      console.error('Get deck favorites error:', error);
      return [];
    }
  },

  async addFavorite(deckId: string): Promise<boolean> {
    const authHeader = await authStorage.getAuthHeader();
    if (!authHeader) return false;

    try {
      const response = await fetch('/api/deck-favorites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader
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
    const authHeader = await authStorage.getAuthHeader();
    if (!authHeader) return false;

    try {
      const response = await fetch('/api/deck-favorites', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader
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
