'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

const STORAGE_PREFIX = 'mahoshojo:me:profile';
const AVATAR_KEY = `${STORAGE_PREFIX}:avatarDataUrl`;
const SIGNATURE_KEY = `${STORAGE_PREFIX}:signature`;
const PROFILE_EVENT = `${STORAGE_PREFIX}:changed`;

const MAX_SIGNATURE_LENGTH = 120;
const AVATAR_SIZE = 256;
const MAX_AVATAR_DATAURL_LENGTH = 2_000_000;

function safeGetItem(key: string) {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, value);
}

function safeRemoveItem(key: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(key);
}

function notifyProfileChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(PROFILE_EVENT));
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

function dataUrlToImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('解析图片失败'));
    img.src = dataUrl;
  });
}

function renderAvatarDataUrl(img: HTMLImageElement) {
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持 Canvas');

  const sx = img.naturalWidth;
  const sy = img.naturalHeight;
  const size = Math.min(sx, sy);
  const startX = Math.floor((sx - size) / 2);
  const startY = Math.floor((sy - size) / 2);

  ctx.clearRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  ctx.drawImage(img, startX, startY, size, size, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

  const webp = canvas.toDataURL('image/webp', 0.82);
  if (webp.startsWith('data:image/webp')) return webp;
  return canvas.toDataURL('image/jpeg', 0.86);
}

async function processAvatarFile(file: File) {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
  const dataUrl = await fileToDataUrl(file);
  const img = await dataUrlToImage(dataUrl);
  return renderAvatarDataUrl(img);
}

export type LocalProfileState = {
  loaded: boolean;
  avatarDataUrl: string | null;
  signature: string;
  error: string | null;
  setSignature: (next: string) => void;
  setAvatarFromFile: (file: File) => Promise<void>;
  clearAvatar: () => void;
  clearSignature: () => void;
};

export function useLocalProfile(): LocalProfileState {
  const [loaded, setLoaded] = useState(false);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [signature, setSignatureState] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const syncFromStorage = () => {
      const avatar = safeGetItem(AVATAR_KEY);
      const sig = safeGetItem(SIGNATURE_KEY);
      setAvatarDataUrl(avatar);
      setSignatureState(sig || '');
    };

    syncFromStorage();
    setLoaded(true);

    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.storageArea !== window.localStorage) return;
      if (e.key === AVATAR_KEY) setAvatarDataUrl(e.newValue);
      if (e.key === SIGNATURE_KEY) setSignatureState(e.newValue || '');
    };
    const onProfileChanged = () => syncFromStorage();
    window.addEventListener('storage', onStorage);
    window.addEventListener(PROFILE_EVENT, onProfileChanged);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(PROFILE_EVENT, onProfileChanged);
    };
  }, []);

  const setSignature = useCallback((next: string) => {
    setError(null);
    const trimmed = next.replace(/\r\n/g, '\n');
    const capped = trimmed.slice(0, MAX_SIGNATURE_LENGTH);
    setSignatureState(capped);
    try {
      if (capped) safeSetItem(SIGNATURE_KEY, capped);
      else safeRemoveItem(SIGNATURE_KEY);
      notifyProfileChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存签名失败（可能是浏览器存储空间不足）');
    }
  }, []);

  const clearSignature = useCallback(() => setSignature(''), [setSignature]);

  const clearAvatar = useCallback(() => {
    setError(null);
    setAvatarDataUrl(null);
    try {
      safeRemoveItem(AVATAR_KEY);
      notifyProfileChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : '清除头像失败');
    }
  }, []);

  const setAvatarFromFile = useCallback(async (file: File) => {
    setError(null);
    try {
      const processed = await processAvatarFile(file);
      if (processed.length > MAX_AVATAR_DATAURL_LENGTH) {
        throw new Error('头像体积过大，建议换一张更小的图片');
      }
      setAvatarDataUrl(processed);
      safeSetItem(AVATAR_KEY, processed);
      notifyProfileChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存头像失败');
    }
  }, []);

  return useMemo(
    () => ({
      loaded,
      avatarDataUrl,
      signature,
      error,
      setSignature,
      setAvatarFromFile,
      clearAvatar,
      clearSignature,
    }),
    [loaded, avatarDataUrl, signature, error, setSignature, setAvatarFromFile, clearAvatar, clearSignature],
  );
}
