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
  async getCards(search?: string, sortBy?: 'likes' | 'usage' | 'created_at'): Promise<any[]> {
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
  async createCard(type: 'character' | 'scenario', name: string, description: string, data: any, isPublic: boolean = false): Promise<{
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
  async updateCard(id: string, name: string, description: string, isPublic?: boolean): Promise<{
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
  }
};