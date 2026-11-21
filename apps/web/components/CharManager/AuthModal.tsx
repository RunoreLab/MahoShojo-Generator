import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { KeyRound } from 'lucide-react';
import { loginWithPasskeyAndSyncAuthState } from '@/lib/auth-client-store';
import { supportsPasskeys, usePasskeysEnabled } from '@/lib/auth/passkey-client';
import { quickCheck } from '@/lib/sensitive-word-filter';
import {
  PASSWORD_MIN_LENGTH,
  evaluatePasswordStrength,
  getPasswordPolicySummaryMessage,
  getPasswordStrengthLabel,
  validatePasswordPolicy,
} from '@/lib/auth/password-policy';
import TurnstileWidget, { TurnstileRef } from '../Turnstile';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLogin: (
    identifier: string,
    credential: string,
    turnstileToken: string,
    mode: 'password' | 'legacy',
  ) => Promise<{ requiresTurnstile?: boolean } | void>;
  onRegister: (username: string, email: string, turnstileToken: string, password: string) => Promise<void>;
  authMessage: { type: 'error' | 'success'; text: string } | null;
  onPasskeySuccess?: () => void;
  /**
   * 隐藏「旧密钥登录」选项，用于必须建立 Better Auth 会话的入口。
   * 密码和通行密钥都可以建立正式会话。
   */
  passwordLoginOnly?: boolean;
}

type LoginMethod = 'password' | 'legacy';

type AuthFormState = {
  username: string;
  identifier: string;
  authKey: string;
  password: string;
  confirmPassword: string;
};

const EMPTY_FORM: AuthFormState = {
  username: '',
  identifier: '',
  authKey: '',
  password: '',
  confirmPassword: '',
};

const getStrengthBarClassName = (score: number): string => {
  if (score >= 3) return 'bg-green-500';
  if (score >= 2) return 'bg-yellow-500';
  return 'bg-red-500';
};

export default function AuthModal({
  isOpen,
  onClose,
  onLogin,
  onRegister,
  authMessage,
  onPasskeySuccess,
  passwordLoginOnly = false,
}: AuthModalProps) {
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('password');
  const effectiveLoginMethod: LoginMethod = passwordLoginOnly ? 'password' : loginMethod;
  const [authForm, setAuthForm] = useState<AuthFormState>(EMPTY_FORM);
  const [turnstileToken, setTurnstileToken] = useState<string>('');
  const [loginRequiresTurnstile, setLoginRequiresTurnstile] = useState(false);
  const [usernameError, setUsernameError] = useState<string>('');
  const [identifierError, setIdentifierError] = useState<string>('');
  const [passwordError, setPasswordError] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [passkeyPending, setPasskeyPending] = useState(false);
  const [passkeyError, setPasskeyError] = useState('');
  const passkeyAttempt = useRef<AbortController | null>(null);
  const passkeysEnabled = usePasskeysEnabled(isOpen && authMode === 'login' && supportsPasskeys());
  const turnstileRef = useRef<TurnstileRef>(null);

  const passwordStrength = evaluatePasswordStrength(authForm.password);
  const passwordStrengthPercent = Math.round((passwordStrength.score / Math.max(1, passwordStrength.maxScore)) * 100);

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
      setLoginRequiresTurnstile(false);
      setUsernameError('');
      setIdentifierError('');
      setPasswordError('');
      setIsSubmitting(false);
      setPasskeyPending(false);
      setPasskeyError('');
    }
    return () => passkeyAttempt.current?.abort();
  }, [isOpen]);

  const validateEmail = (email: string) => {
    if (!email.trim()) {
      setIdentifierError('');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setIdentifierError('请输入有效的邮箱地址');
      return;
    }
    setIdentifierError('');
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

  const validateRegisterPassword = (password: string, confirmPassword: string, username: string, email: string) => {
    if (!password && !confirmPassword) {
      setPasswordError('');
      return;
    }

    if (!password) {
      setPasswordError('请设置登录密码');
      return;
    }

    const passwordPolicy = validatePasswordPolicy(password, {
      username,
      email,
    });
    if (!passwordPolicy.ok) {
      setPasswordError(getPasswordPolicySummaryMessage(passwordPolicy.issues) || '密码不符合要求');
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
      validateRegisterPassword(authForm.password, authForm.confirmPassword, authForm.username, authForm.identifier);
    } else {
      setPasswordError('');
    }
  }, [authForm.password, authForm.confirmPassword, authForm.username, authForm.identifier, authMode]);

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
    if (passkeyAttempt.current) return;
    setPasskeyError('');
    const requiresTurnstile = authMode === 'register' || loginRequiresTurnstile;
    if (requiresTurnstile && !turnstileToken) return;

    if (authMode === 'register') {
      const username = authForm.username.trim();
      const email = authForm.identifier.trim();
      const password = authForm.password;
      const passwordPolicy = validatePasswordPolicy(password, { username, email });

      if (!username || !email || !password) {
        setPasswordError('请完整填写注册信息');
        return;
      }

      if (usernameError || identifierError || passwordError || !passwordPolicy.ok) {
        setPasswordError(getPasswordPolicySummaryMessage(passwordPolicy.issues) || passwordError);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      if (authMode === 'register') {
        await onRegister(authForm.username.trim(), authForm.identifier.trim(), turnstileToken, authForm.password);
        return;
      }

      if (effectiveLoginMethod === 'password') {
        const result = await onLogin(authForm.identifier.trim(), authForm.password, turnstileToken, 'password');
        if (result?.requiresTurnstile) setLoginRequiresTurnstile(true);
        return;
      }

      const result = await onLogin(authForm.username.trim(), authForm.authKey, turnstileToken, 'legacy');
      if (result?.requiresTurnstile) setLoginRequiresTurnstile(true);
    } finally {
      // 由 authMessage 监听统一结束提交态与重置验证码
    }
  };

  const switchMode = () => {
    setAuthMode(authMode === 'login' ? 'register' : 'login');
    setLoginMethod('password');
    setAuthForm(EMPTY_FORM);
    setLoginRequiresTurnstile(false);
    setUsernameError('');
    setIdentifierError('');
    setPasswordError('');
    setPasskeyError('');
    resetCaptcha();
  };

  const switchLoginMethod = (method: LoginMethod) => {
    setLoginMethod(method);
    setLoginRequiresTurnstile(false);
    setIdentifierError('');
    setPasswordError('');
    setPasskeyError('');
    resetCaptcha();
  };

  const handlePasskey = async () => {
    if (passkeyAttempt.current || isSubmitting) return;
    const attempt = new AbortController();
    passkeyAttempt.current = attempt;
    setPasskeyPending(true);
    setPasskeyError('');
    try {
      const result = await loginWithPasskeyAndSyncAuthState(attempt.signal);
      if (result.success) {
        onClose();
        onPasskeySuccess?.();
      } else if (!attempt.signal.aborted) {
        setPasskeyError(result.error || '通行密钥登录失败。');
      }
    } catch (error) {
      if (!attempt.signal.aborted) {
        setPasskeyError(error instanceof Error ? error.message : '通行密钥登录失败。');
      }
    } finally {
      if (passkeyAttempt.current === attempt) {
        passkeyAttempt.current = null;
        setPasskeyPending(false);
      }
    }
  };

  const shouldShowTurnstile = authMode === 'register' || loginRequiresTurnstile;
  const canSubmit =
    (!shouldShowTurnstile || Boolean(turnstileToken)) &&
    !isSubmitting && !passkeyPending &&
    !(authMode === 'register' && (!authForm.password || Boolean(usernameError) || Boolean(identifierError) || Boolean(passwordError))) &&
    !(authMode === 'login' && effectiveLoginMethod === 'password' && !authForm.identifier.trim());

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
        <h2 className="mb-4 pr-8 text-xl font-bold">{authMode === 'login' ? '登录' : '注册'}</h2>

        <div className="mb-3 rounded border border-yellow-200 bg-yellow-50 p-2 text-xs text-yellow-800">
          <span className="font-medium">迁移提示：</span> 新注册账号已强制使用密码登录，旧版密钥登录将逐步下线。
        </div>

        {authMessage && !passkeyPending && !passkeyError ? (
          <div
            className={`mb-4 rounded-md p-3 text-sm ${
              authMessage.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
            }`}
          >
            {authMessage.text}
          </div>
        ) : null}

        {passkeysEnabled ? (
          <div className="mb-4">
            <button
              type="button"
              className="flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-(--app-border-strong) bg-(--app-surface) px-3 py-2 text-sm font-medium text-(--app-text) focus-visible:outline-2 focus-visible:outline-(--app-accent-strong) disabled:opacity-50"
              onClick={() => void handlePasskey()}
              disabled={isSubmitting || passkeyPending}
            >
              <KeyRound size={16} aria-hidden="true" />
              {passkeyPending ? '正在验证通行密钥…' : '使用通行密钥登录'}
            </button>
            {passkeyError ? <p role="alert" className="mt-2 text-sm text-(--app-text)">{passkeyError}</p> : null}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          {authMode === 'login' && !passwordLoginOnly ? (
            <div className="grid grid-cols-2 gap-2 rounded-md bg-gray-100 p-1">
              <button
                type="button"
                disabled={passkeyPending}
                onClick={() => switchLoginMethod('password')}
                className={`rounded px-2 py-2 text-sm font-medium ${
                  loginMethod === 'password' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'
                }`}
              >
                密码登录
              </button>
              <button
                type="button"
                disabled={passkeyPending}
                onClick={() => switchLoginMethod('legacy')}
                className={`rounded px-2 py-2 text-sm font-medium ${
                  loginMethod === 'legacy' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'
                }`}
              >
                旧密钥登录
              </button>
            </div>
          ) : null}

          {authMode === 'register' || effectiveLoginMethod === 'legacy' ? (
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
                required={authMode === 'register' || effectiveLoginMethod === 'legacy'}
              />
              {usernameError ? <p className="mt-1 text-sm text-red-600">{usernameError}</p> : null}
            </div>
          ) : null}

          {authMode === 'register' || effectiveLoginMethod === 'password' ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                {authMode === 'register' ? '邮箱地址' : '登录标识（邮箱 / 用户名 / ID）'}
              </label>
              <input
                type={authMode === 'register' ? 'email' : 'text'}
                value={authForm.identifier}
                onChange={(e) => {
                  const value = e.target.value;
                  setAuthForm((prev) => ({ ...prev, identifier: value }));
                  if (authMode === 'register') {
                    validateEmail(value);
                  } else {
                    setIdentifierError('');
                  }
                }}
                className={`input-field ${identifierError ? 'border-red-300 focus:border-red-500' : ''}`}
                placeholder={authMode === 'register' ? '请输入邮箱地址' : '请输入邮箱、用户名或用户 ID'}
                required
              />
              {identifierError ? <p className="mt-1 text-sm text-red-600">{identifierError}</p> : null}
            </div>
          ) : null}

          {authMode === 'register' || effectiveLoginMethod === 'password' ? (
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
                placeholder={authMode === 'register' ? '设置登录密码' : '请输入密码'}
                required
                minLength={PASSWORD_MIN_LENGTH}
              />
            </div>
          ) : null}

          {authMode === 'register' ? (
            <div>
              <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                <div className="flex items-center justify-between text-xs text-gray-600">
                  <span>密码强度</span>
                  <span>
                    {getPasswordStrengthLabel(passwordStrength.level)}（{passwordStrength.score}/{passwordStrength.maxScore}）
                  </span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-gray-200">
                  <div
                    className={`h-full rounded-full transition-all ${getStrengthBarClassName(passwordStrength.score)}`}
                    style={{ width: `${passwordStrengthPercent}%` }}
                  />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-gray-600">
                  <span>{passwordStrength.hasLowercase ? '✓' : '○'} 小写字母</span>
                  <span>{passwordStrength.hasUppercase ? '✓' : '○'} 大写字母</span>
                  <span>{passwordStrength.hasDigit ? '✓' : '○'} 数字</span>
                  <span>{passwordStrength.hasSymbol ? '✓' : '○'} 符号</span>
                </div>
              </div>

              <label className="mb-1 mt-3 block text-sm font-medium text-gray-700">确认密码</label>
              <input
                type="password"
                value={authForm.confirmPassword}
                onChange={(e) => {
                  const value = e.target.value;
                  setAuthForm((prev) => ({ ...prev, confirmPassword: value }));
                }}
                className={`input-field ${passwordError ? 'border-red-300 focus:border-red-500' : ''}`}
                placeholder="再次输入密码"
                required
                minLength={PASSWORD_MIN_LENGTH}
              />
              {passwordError ? <p className="mt-1 text-sm text-red-600">{passwordError}</p> : null}
              <p className="mt-1 text-xs text-gray-500">
                密码至少 {PASSWORD_MIN_LENGTH} 位，且需包含大写/小写/数字/符号中的至少 3 类。
              </p>
            </div>
          ) : null}

          {authMode === 'login' && effectiveLoginMethod === 'legacy' ? (
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

          {shouldShowTurnstile ? (
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">安全验证</label>
              <TurnstileWidget ref={turnstileRef} onVerify={setTurnstileToken} />
            </div>
          ) : null}

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
          <button onClick={switchMode} disabled={passkeyPending} className="ml-1 font-medium text-purple-600 hover:text-purple-700">
            {authMode === 'login' ? '去注册' : '去登录'}
          </button>
        </div>
        <div className="mt-2 text-center text-sm text-gray-600">
          <Link href="/password-recovery" className="font-medium text-purple-600 hover:text-purple-700">
            找回密钥
          </Link>
        </div>
      </div>
    </div>
  );
}
