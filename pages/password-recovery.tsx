import { useState, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import TurnstileWidget, { TurnstileRef } from '@/components/Turnstile';

interface RecoveryMessage {
  type: 'success' | 'error';
  text: string;
}

const PasswordRecoveryPage = () => {
  const [form, setForm] = useState({ username: '', email: '' });
  const [turnstileToken, setTurnstileToken] = useState('');
  const [message, setMessage] = useState<RecoveryMessage | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const turnstileRef = useRef<TurnstileRef>(null);
  const successHint = '如果您输入的内容正确，密码则会发送到您的邮箱中。 \n 如果输入的内容不正确，则不会有密码发送。';

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
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
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: form.username.trim(),
          email: form.email.trim(),
          turnstileToken
        })
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({
          type: 'success',
          text: data.message || successHint
        });
        setForm({ username: '', email: '' });
      } else {
        setMessage({
          type: 'error',
          text: data.error || '请求失败，请稍后重试。'
        });
      }
    } catch (error) {
      console.error('Recovery request failed:', error);
      setMessage({
        type: 'error',
        text: '请求失败，请检查网络连接或稍后重试。'
      });
    } finally {
      setIsSubmitting(false);
      setTurnstileToken('');
      turnstileRef.current?.reset();
    }
  };

  const isSuccess = message?.type === 'success';

  return (
    <>
      <Head>
        <title>找回密码 - MahoShojo Generator</title>
      </Head>
      <div className="magic-background-white min-h-screen">
        <div className="container py-12">
          <div className="card max-w-lg mx-auto">
            <h1 className="text-2xl font-bold text-center mb-4">找回密码</h1>
            {!isSuccess && (
              <p className="text-sm text-gray-600 text-center mb-6">
                请输入您注册时使用的用户名、邮箱，并完成验证码验证。
              </p>
            )}

            {!isSuccess && message && (
              <div
                className={`mb-6 p-3 rounded-md text-sm ${message.type === 'success'
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-red-100 text-red-700'
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
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    用户名
                  </label>
                  <input
                    type="text"
                    value={form.username}
                    onChange={(event) => setForm({ ...form, username: event.target.value })}
                    className="input-field"
                    placeholder="请输入用户名"
                    required
                    maxLength={20}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    邮箱地址
                  </label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(event) => setForm({ ...form, email: event.target.value })}
                    className="input-field"
                    placeholder="请输入邮箱地址"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    验证码
                  </label>
                  <TurnstileWidget
                    ref={turnstileRef}
                    onVerify={setTurnstileToken}
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting || !turnstileToken}
                  className={`w-full generate-button ${isSubmitting || !turnstileToken ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {isSubmitting ? '提交中...' : '发送找回邮件'}
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
