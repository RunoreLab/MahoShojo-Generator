import { useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import TurnstileWidget, { TurnstileRef } from '@/components/Turnstile';

interface RecoveryMessage {
  type: 'success' | 'error';
  text: string;
}

const REQUEST_SUCCESS_HINT = '如果您输入的信息正确，系统会向邮箱发送一次性重置链接，请在 15 分钟内完成重置。';
const RESET_SUCCESS_HINT = '登录密钥已重置成功，请使用新密钥登录。';

const generateAuthKeySuggestion = (): string => {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const PasswordRecoveryPage = () => {
  const router = useRouter();
  const resetToken = useMemo(() => {
    const value = router.query.token;
    if (Array.isArray(value)) return value[0] ?? '';
    return typeof value === 'string' ? value.trim() : '';
  }, [router.query.token]);
  const isResetMode = resetToken.length > 0;

  const [requestForm, setRequestForm] = useState({ username: '', email: '' });
  const [resetForm, setResetForm] = useState({ newAuthKey: '', confirmAuthKey: '' });
  const [turnstileToken, setTurnstileToken] = useState('');
  const [message, setMessage] = useState<RecoveryMessage | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const turnstileRef = useRef<TurnstileRef>(null);

  const handleRequestSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!turnstileToken) {
      setMessage({ type: 'error', text: '请完成验证码验证后再提交。' });
      return;
    }

    setIsSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch('/api/auth/recover', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: requestForm.username.trim(),
          email: requestForm.email.trim(),
          turnstileToken,
        }),
      });

      const data = await response.json();
      if (response.ok) {
        setMessage({
          type: 'success',
          text: data.message || REQUEST_SUCCESS_HINT,
        });
        setRequestForm({ username: '', email: '' });
      } else {
        setMessage({
          type: 'error',
          text: data.error || '请求失败，请稍后重试。',
        });
      }
    } catch (error) {
      console.error('Recovery request failed:', error);
      setMessage({
        type: 'error',
        text: '请求失败，请检查网络连接或稍后重试。',
      });
    } finally {
      setIsSubmitting(false);
      setTurnstileToken('');
      turnstileRef.current?.reset();
    }
  };

  const handleResetSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);

    const newAuthKey = resetForm.newAuthKey.trim();
    const confirmAuthKey = resetForm.confirmAuthKey.trim();
    if (!newAuthKey || !confirmAuthKey) {
      setMessage({ type: 'error', text: '请填写并确认新的登录密钥。' });
      return;
    }

    if (newAuthKey !== confirmAuthKey) {
      setMessage({ type: 'error', text: '两次输入的登录密钥不一致。' });
      return;
    }

    if (newAuthKey.length < 16 || newAuthKey.length > 128) {
      setMessage({ type: 'error', text: '登录密钥长度需在 16 到 128 个字符之间。' });
      return;
    }

    if (/\s/.test(newAuthKey)) {
      setMessage({ type: 'error', text: '登录密钥不能包含空白字符。' });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/auth/recover/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token: resetToken,
          newAuthKey,
        }),
      });

      const data = await response.json();
      if (response.ok) {
        setMessage({
          type: 'success',
          text: data.message || RESET_SUCCESS_HINT,
        });
        setResetForm({ newAuthKey: '', confirmAuthKey: '' });
      } else {
        setMessage({
          type: 'error',
          text: data.error || '重置失败，请稍后重试。',
        });
      }
    } catch (error) {
      console.error('Recovery reset failed:', error);
      setMessage({
        type: 'error',
        text: '请求失败，请检查网络连接或稍后重试。',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const isSuccess = message?.type === 'success';

  return (
    <>
      <Head>
        <title>{isResetMode ? '设置新登录密钥' : '找回登录密钥'} - MahoShojo Generator</title>
      </Head>
      <div className="magic-background-white min-h-screen">
        <div className="container py-12">
          <div className="card max-w-lg mx-auto">
            <h1 className="text-2xl font-bold text-center mb-4">{isResetMode ? '设置新登录密钥' : '找回登录密钥'}</h1>

            {!isSuccess && (
              <p className="text-sm text-gray-600 text-center mb-6">
                {isResetMode
                  ? '请设置新的登录密钥。重置链接仅可使用一次，过期后请重新发起找回。'
                  : '请输入注册用户名和邮箱，系统会发送一次性重置链接。'}
              </p>
            )}

            {!isSuccess && message && (
              <div
                className={`mb-6 p-3 rounded-md text-sm ${
                  message.type === 'success' ? 'bg-blue-100 text-blue-800' : 'bg-red-100 text-red-700'
                }`}
              >
                {message.text}
              </div>
            )}

            {isSuccess ? (
              <div className="py-10 text-center">
                <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-green-100">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    className="h-14 w-14 text-green-600"
                  >
                    <path
                      fill="currentColor"
                      d="M12 2a10 10 0 1 0 10 10A10.011 10.011 0 0 0 12 2m5 7.59l-5.66 5.65a1 1 0 0 1-1.41 0L7 12.3a1 1 0 1 1 1.41-1.41l2.21 2.2 4.95-4.94A1 1 0 0 1 17 9.59"
                    />
                  </svg>
                </div>
                <p className="text-base text-gray-700">{message?.text}</p>
              </div>
            ) : isResetMode ? (
              <form onSubmit={handleResetSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">新登录密钥</label>
                  <input
                    type="text"
                    value={resetForm.newAuthKey}
                    onChange={(event) => setResetForm({ ...resetForm, newAuthKey: event.target.value })}
                    className="input-field"
                    placeholder="请输入新的登录密钥"
                    required
                    minLength={16}
                    maxLength={128}
                    autoComplete="off"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">确认新登录密钥</label>
                  <input
                    type="text"
                    value={resetForm.confirmAuthKey}
                    onChange={(event) => setResetForm({ ...resetForm, confirmAuthKey: event.target.value })}
                    className="input-field"
                    placeholder="请再次输入新的登录密钥"
                    required
                    minLength={16}
                    maxLength={128}
                    autoComplete="off"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const suggestion = generateAuthKeySuggestion();
                    setResetForm({ newAuthKey: suggestion, confirmAuthKey: suggestion });
                  }}
                  className="w-full border border-blue-200 rounded-md py-2 text-sm text-blue-700 hover:bg-blue-50"
                >
                  自动生成安全密钥
                </button>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`w-full generate-button ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {isSubmitting ? '提交中...' : '确认重置'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleRequestSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">用户名</label>
                  <input
                    type="text"
                    value={requestForm.username}
                    onChange={(event) => setRequestForm({ ...requestForm, username: event.target.value })}
                    className="input-field"
                    placeholder="请输入用户名"
                    required
                    maxLength={20}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">邮箱地址</label>
                  <input
                    type="email"
                    value={requestForm.email}
                    onChange={(event) => setRequestForm({ ...requestForm, email: event.target.value })}
                    className="input-field"
                    placeholder="请输入邮箱地址"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">验证码</label>
                  <TurnstileWidget ref={turnstileRef} onVerify={setTurnstileToken} />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting || !turnstileToken}
                  className={`w-full generate-button ${
                    isSubmitting || !turnstileToken ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  {isSubmitting ? '提交中...' : '发送重置链接'}
                </button>
              </form>
            )}

            <div className="mt-6 text-center">
              <Link href="/character-manager" className="footer-link">
                返回角色管理中心
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default PasswordRecoveryPage;
