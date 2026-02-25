import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { quickCheck } from '@/lib/sensitive-word-filter';
import TurnstileWidget, { TurnstileRef } from '../Turnstile';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLogin: (
    identifier: string,
    credential: string,
    turnstileToken: string,
    mode: 'password' | 'legacy',
  ) => Promise<void>;
  onRegister: (username: string, email: string, turnstileToken: string, password?: string) => Promise<void>;
  authMessage: { type: 'error' | 'success'; text: string } | null;
  generatedAuthKey: string | null;
}

type LoginMethod = 'password' | 'legacy';

type AuthFormState = {
  username: string;
  email: string;
  authKey: string;
  password: string;
  confirmPassword: string;
};

const EMPTY_FORM: AuthFormState = {
  username: '',
  email: '',
  authKey: '',
  password: '',
  confirmPassword: '',
};

export default function AuthModal({
  isOpen,
  onClose,
  onLogin,
  onRegister,
  authMessage,
  generatedAuthKey,
}: AuthModalProps) {
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('password');
  const [authForm, setAuthForm] = useState<AuthFormState>(EMPTY_FORM);
  const [turnstileToken, setTurnstileToken] = useState<string>('');
  const [usernameError, setUsernameError] = useState<string>('');
  const [emailError, setEmailError] = useState<string>('');
  const [passwordError, setPasswordError] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const turnstileRef = useRef<TurnstileRef>(null);

  const resetCaptcha = () => {
    setTurnstileToken('');
    turnstileRef.current?.reset();
  };

  useEffect(() => {
    if (!isOpen) {
      setAuthMode('login');
      setLoginMethod('password');
      setAuthForm(EMPTY_FORM);
      setTurnstileToken('');
      setUsernameError('');
      setEmailError('');
      setPasswordError('');
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const validateEmail = (email: string) => {
    if (!email.trim()) {
      setEmailError('');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setEmailError('请输入有效的邮箱地址');
      return;
    }
    setEmailError('');
  };

  const validateUsername = async (username: string) => {
    if (!username.trim()) {
      setUsernameError('');
      return;
    }

    if (username.length < 2 || username.length > 20) {
      setUsernameError('用户名长度必须在2-20个字符之间');
      return;
    }

    try {
      const sensitiveCheck = await quickCheck(username);
      if (sensitiveCheck.hasSensitiveWords) {
        setUsernameError('用户名包含不当内容，请重新输入');
        return;
      }
      setUsernameError('');
    } catch (error) {
      console.error('Username validation failed:', error);
      setUsernameError('');
    }
  };

  const validateRegisterPassword = (password: string, confirmPassword: string) => {
    if (!password && !confirmPassword) {
      setPasswordError('');
      return;
    }

    if (password.length < 8) {
      setPasswordError('密码至少需要 8 位字符');
      return;
    }

    if (confirmPassword && password !== confirmPassword) {
      setPasswordError('两次输入的密码不一致');
      return;
    }

    setPasswordError('');
  };

  useEffect(() => {
    if (authMode === 'register') {
      validateRegisterPassword(authForm.password, authForm.confirmPassword);
    } else {
      setPasswordError('');
    }
  }, [authForm.password, authForm.confirmPassword, authMode]);

  useEffect(() => {
    if (authMessage && isSubmitting) {
      if (authMessage.type === 'error') {
        resetCaptcha();
      }
      setIsSubmitting(false);
    }
  }, [authMessage, isSubmitting]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!turnstileToken) return;

    if (authMode === 'register' && (usernameError || emailError || passwordError)) {
      return;
    }

    setIsSubmitting(true);
    try {
      if (authMode === 'register') {
        const password = authForm.password.trim();
        await onRegister(
          authForm.username.trim(),
          authForm.email.trim(),
          turnstileToken,
          password.length > 0 ? password : undefined,
        );
        return;
      }

      if (loginMethod === 'password') {
        await onLogin(authForm.email.trim(), authForm.password, turnstileToken, 'password');
        return;
      }

      await onLogin(authForm.username.trim(), authForm.authKey, turnstileToken, 'legacy');
    } finally {
      // 由 authMessage 监听统一结束提交态与重置验证码
    }
  };

  const switchMode = () => {
    setAuthMode(authMode === 'login' ? 'register' : 'login');
    setLoginMethod('password');
    setAuthForm(EMPTY_FORM);
    setUsernameError('');
    setEmailError('');
    setPasswordError('');
    resetCaptcha();
  };

  const switchLoginMethod = (method: LoginMethod) => {
    setLoginMethod(method);
    setEmailError('');
    setPasswordError('');
    resetCaptcha();
  };

  const handleTurnstileVerify = (token: string) => {
    setTurnstileToken(token);
  };

  const canSubmit =
    Boolean(turnstileToken) &&
    !isSubmitting &&
    !(authMode === 'login' && loginMethod === 'password' && Boolean(emailError)) &&
    !(authMode === 'register' && (Boolean(usernameError) || Boolean(emailError) || Boolean(passwordError)));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-md rounded-lg bg-white p-6">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-2xl leading-none text-gray-400 hover:text-gray-600"
          aria-label="关闭"
        >
          ×
        </button>
        <h2 className="mb-4 pr-8 text-xl font-bold">
          {generatedAuthKey && authMode === 'register' ? '注册成功' : authMode === 'login' ? '登录' : '注册'}
        </h2>

        <div className="mb-3 rounded border border-yellow-200 bg-yellow-50 p-2 text-xs text-yellow-800">
          <span className="font-medium">实验性功能：</span> 用户系统目前处于测试阶段，功能可能不稳定。
        </div>

        {authMessage ? (
          <div
            className={`mb-4 rounded-md p-3 text-sm ${
              authMessage.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
            }`}
          >
            {authMessage.text}
          </div>
        ) : null}

        {generatedAuthKey && authMode === 'register' ? (
          <div className="mb-4">
            <div className="mb-4 rounded border border-green-200 bg-green-50 p-4">
              <p className="mb-2 text-sm font-semibold text-green-800">您的登录密钥（请立即复制保存）：</p>
              <code className="block break-all rounded border border-green-300 bg-white p-2 text-xs">
                {generatedAuthKey}
              </code>
              <p className="mt-2 text-xs text-red-600">请勿和他人分享，如果丢失则无法找回。</p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(generatedAuthKey);
                  }}
                  className="flex-1 rounded bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700"
                >
                  复制密钥
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 rounded bg-gray-600 px-3 py-2 text-sm text-white hover:bg-gray-700"
                >
                  关闭
                </button>
              </div>
            </div>
            <div className="text-center text-sm text-gray-600">请妥善保存您的登录密钥，下次登录时将需要使用。</div>
          </div>
        ) : (
          <>
            <form onSubmit={handleSubmit} className="space-y-4">
              {authMode === 'login' ? (
                <div className="grid grid-cols-2 gap-2 rounded-md bg-gray-100 p-1">
                  <button
                    type="button"
                    onClick={() => switchLoginMethod('password')}
                    className={`rounded px-2 py-2 text-sm font-medium ${
                      loginMethod === 'password' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'
                    }`}
                  >
                    密码登录
                  </button>
                  <button
                    type="button"
                    onClick={() => switchLoginMethod('legacy')}
                    className={`rounded px-2 py-2 text-sm font-medium ${
                      loginMethod === 'legacy' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'
                    }`}
                  >
                    旧密钥登录
                  </button>
                </div>
              ) : null}

              {authMode === 'register' || loginMethod === 'legacy' ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">用户名</label>
                  <input
                    type="text"
                    value={authForm.username}
                    onChange={(e) => {
                      const value = e.target.value;
                      setAuthForm((prev) => ({ ...prev, username: value }));
                      if (authMode === 'register') {
                        void validateUsername(value);
                      } else {
                        setUsernameError('');
                      }
                    }}
                    className={`input-field ${usernameError ? 'border-red-300 focus:border-red-500' : ''}`}
                    placeholder="请输入用户名"
                    required={authMode === 'register' || loginMethod === 'legacy'}
                  />
                  {usernameError ? <p className="mt-1 text-sm text-red-600">{usernameError}</p> : null}
                </div>
              ) : null}

              {authMode === 'register' || loginMethod === 'password' ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">邮箱地址</label>
                  <input
                    type="email"
                    value={authForm.email}
                    onChange={(e) => {
                      const value = e.target.value;
                      setAuthForm((prev) => ({ ...prev, email: value }));
                      validateEmail(value);
                    }}
                    className={`input-field ${emailError ? 'border-red-300 focus:border-red-500' : ''}`}
                    placeholder="请输入邮箱地址"
                    required={authMode === 'register' || loginMethod === 'password'}
                  />
                  {emailError ? <p className="mt-1 text-sm text-red-600">{emailError}</p> : null}
                </div>
              ) : null}

              {authMode === 'register' || loginMethod === 'password' ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">密码</label>
                  <input
                    type="password"
                    value={authForm.password}
                    onChange={(e) => {
                      const value = e.target.value;
                      setAuthForm((prev) => ({ ...prev, password: value }));
                    }}
                    className={`input-field ${passwordError ? 'border-red-300 focus:border-red-500' : ''}`}
                    placeholder={authMode === 'register' ? '设置登录密码（可留空走旧版密钥注册）' : '请输入密码'}
                    required={loginMethod === 'password' && authMode === 'login'}
                    minLength={authMode === 'register' ? 0 : 8}
                  />
                </div>
              ) : null}

              {authMode === 'register' ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">确认密码</label>
                  <input
                    type="password"
                    value={authForm.confirmPassword}
                    onChange={(e) => {
                      const value = e.target.value;
                      setAuthForm((prev) => ({ ...prev, confirmPassword: value }));
                    }}
                    className={`input-field ${passwordError ? 'border-red-300 focus:border-red-500' : ''}`}
                    placeholder="再次输入密码（可留空）"
                  />
                  {passwordError ? <p className="mt-1 text-sm text-red-600">{passwordError}</p> : null}
                  <p className="mt-1 text-xs text-gray-500">填写密码将使用新账号体系；留空则兼容旧版密钥注册。</p>
                </div>
              ) : null}

              {authMode === 'login' && loginMethod === 'legacy' ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">登录密钥</label>
                  <input
                    value={authForm.authKey}
                    type="password"
                    onChange={(e) => setAuthForm((prev) => ({ ...prev, authKey: e.target.value }))}
                    className="input-field"
                    placeholder="请输入您的登录密钥"
                    required
                  />
                </div>
              ) : null}

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">安全验证</label>
                <TurnstileWidget ref={turnstileRef} onVerify={handleTurnstileVerify} />
              </div>

              <button
                type="submit"
                disabled={!canSubmit}
                className={`generate-button w-full ${!canSubmit ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                {isSubmitting ? '验证中...' : authMode === 'login' ? '登录' : '注册'}
              </button>
            </form>

            <div className="mt-2 text-center text-sm text-gray-600">
              {authMode === 'login' ? '还没有账号？' : '已有账号？'}
              <button onClick={switchMode} className="ml-1 font-medium text-purple-600 hover:text-purple-700">
                {authMode === 'login' ? '去注册' : '去登录'}
              </button>
            </div>
            <div className="mt-2 text-center text-sm text-gray-600">
              <Link href="/password-recovery" className="font-medium text-purple-600 hover:text-purple-700">
                找回密钥
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
