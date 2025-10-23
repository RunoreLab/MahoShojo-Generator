import React, { useState, useEffect, useRef } from 'react';
import TurnstileWidget, { TurnstileRef } from '../Turnstile';
import { quickCheck } from '@/lib/sensitive-word-filter';
import Link from 'next/link';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLogin: (username: string, authKey: string, turnstileToken: string) => Promise<void>;
  onRegister: (username: string, email: string, turnstileToken: string) => Promise<void>;
  authMessage: { type: 'error' | 'success', text: string } | null;
  generatedAuthKey: string | null;
}

export default function AuthModal({
  isOpen,
  onClose,
  onLogin,
  onRegister,
  authMessage,
  generatedAuthKey
}: AuthModalProps) {
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authForm, setAuthForm] = useState({ username: '', email: '', authKey: '' });
  const [turnstileToken, setTurnstileToken] = useState<string>('');
  const [usernameError, setUsernameError] = useState<string>('');
  const [emailError, setEmailError] = useState<string>('');
  const turnstileRef = useRef<TurnstileRef>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 重置表单当模态框关闭时
  useEffect(() => {
    if (!isOpen) {
      setAuthForm({ username: '', email: '', authKey: '' });
      setTurnstileToken('');
      setUsernameError('');
      setEmailError('');
      setAuthMode('login');
      setIsSubmitting(false);
    }
  }, [isOpen]);

  // 验证邮箱格式
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

  // 验证用户名
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

  // 处理邮箱输入变化
  const handleEmailChange = (value: string) => {
    setAuthForm({ ...authForm, email: value });
    if (authMode === 'register') {
      validateEmail(value);
    }
  };

  // 处理用户名输入变化
  const handleUsernameChange = (value: string) => {
    setAuthForm({ ...authForm, username: value });
    // 注册模式下才需要验证敏感词
    if (authMode === 'register') {
      validateUsername(value);
    } else {
      setUsernameError('');
    }
  };

  // 监听认证消息变化
  useEffect(() => {
    if (authMessage && isSubmitting) {
      if (authMessage.type === 'error') {
        // 登录/注册失败，重置Turnstile以获取新token
        turnstileRef.current?.reset();
        setTurnstileToken('');
      } else if (authMessage.type === 'success') {
        // 登录/注册成功，保持当前状态
        // 模态框关闭会在父组件中处理
      }
      setIsSubmitting(false);
    }
  }, [authMessage, isSubmitting]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!turnstileToken) {
      return; // Turnstile验证必须完成
    }

    // 注册模式下检查用户名错误
    if (authMode === 'register' && (usernameError || emailError)) {
      return;
    }

    setIsSubmitting(true);
    try {
      if (authMode === 'register') {
        await onRegister(authForm.username, authForm.email, turnstileToken);
      } else {
        await onLogin(authForm.username, authForm.authKey, turnstileToken);
      }
    } finally {
      // 如果没有错误，setIsSubmitting会在useEffect中处理
      // 如果有错误，也会在useEffect中处理并重置
    }
  };

  const switchMode = () => {
    setAuthMode(authMode === 'login' ? 'register' : 'login');
    setAuthForm({ username: '', email: '', authKey: '' });
    setUsernameError('');
    setEmailError('');
    setTurnstileToken(''); // 重置turnstile token
    turnstileRef.current?.reset(); // 重置turnstile组件
  };

  const handleTurnstileVerify = (token: string) => {
    setTurnstileToken(token);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg p-6 max-w-md w-full relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-2xl leading-none"
          aria-label="关闭"
        >
          ×
        </button>
        <h2 className="text-xl font-bold mb-4 pr-8">
          {generatedAuthKey && authMode === 'register' ? '注册成功' : (authMode === 'login' ? '登录' : '注册')}
        </h2>

        {/* 实验性功能警告 */}
        <div className="mb-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
          <span className="font-medium">⚠️ 实验性功能：</span> 用户系统目前处于测试阶段，功能可能不稳定。
        </div>

        {authMessage && (
          <div className={`mb-4 p-3 rounded-md text-sm ${authMessage.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
            }`}>
            {authMessage.text}
          </div>
        )}

        {generatedAuthKey && authMode === 'register' ? (
          /* 注册成功显示区域 */
          <div className="mb-4">
            <div className="p-4 bg-green-50 border border-green-200 rounded mb-4">
              <p className="text-sm font-semibold text-green-800 mb-2">
                您的登录密钥（请立即复制保存）：
              </p>
              <code className="block p-2 bg-white rounded text-xs break-all border border-green-300">
                {generatedAuthKey}
              </code>
              <p className="text-xs text-red-600 mt-2">
                ⚠️ 请勿和他人分享，如果丢失则无法找回
              </p>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(generatedAuthKey);
                  }}
                  className="flex-1 px-3 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700"
                >
                  复制密钥
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 px-3 py-2 bg-gray-600 text-white rounded text-sm hover:bg-gray-700"
                >
                  关闭
                </button>
              </div>
            </div>
            <div className="text-center text-sm text-gray-600">
              请妥善保存您的登录密钥，下次登录时将需要使用。
            </div>
          </div>
        ) : (
          /* 原有的表单区域 */
          <>
            <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              用户名
            </label>
            <input
              type="text"
              value={authForm.username}
              onChange={(e) => handleUsernameChange(e.target.value)}
              className={`input-field ${usernameError ? 'border-red-300 focus:border-red-500' : ''}`}
              placeholder="请输入用户名"
              required
            />
            {usernameError && (
              <p className="mt-1 text-sm text-red-600">{usernameError}</p>
            )}
          </div>

          {authMode === 'register' ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  邮箱地址
                </label>
                <input
                  type="email"
                  value={authForm.email}
                  onChange={(e) => handleEmailChange(e.target.value)}
                  className={`input-field ${emailError ? 'border-red-300 focus:border-red-500' : ''}`}
                  placeholder="请输入邮箱地址"
                  required
                />
                {emailError && (
                  <p className="mt-1 text-sm text-red-600">{emailError}</p>
                )}
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-4">
                  注册完成后将生成唯一的登录密钥，请妥善保管。
                </p>
              </div>
            </>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                登录密钥
              </label>
              <input
                value={authForm.authKey}
                type="password"
                onChange={(e) => setAuthForm({ ...authForm, authKey: e.target.value })}
                className="input-field"
                placeholder="请输入您的登录密钥"
                required
              />
            </div>
          )}

          {/* Turnstile验证码 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              安全验证
            </label>
            <TurnstileWidget ref={turnstileRef} onVerify={handleTurnstileVerify} />
          </div>

          <button
            type="submit"
            disabled={!turnstileToken || isSubmitting || (authMode === 'register' && (!!usernameError || !!emailError))}
            className={`w-full generate-button ${(!turnstileToken || isSubmitting || (authMode === 'register' && (!!usernameError || !!emailError))) ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {isSubmitting ? '验证中...' : (authMode === 'login' ? '登录' : '注册')}
          </button>
        </form>

        <div className="mt-2 text-center text-sm text-gray-600">
          {authMode === 'login' ? '还没有账号？' : '已有账号？'}
          <button
            onClick={switchMode}
            className="ml-1 text-purple-600 hover:text-purple-700 font-medium"
          >
            {authMode === 'login' ? '去注册' : '去登录'}
          </button>
        </div>
        <div className="mt-2 text-center text-sm text-gray-600">
          <Link href="/password-recovery" className="text-purple-600 hover:text-purple-700 font-medium">找回密钥</Link>
        </div>
        </>
        )}
      </div>
    </div>
  );
}