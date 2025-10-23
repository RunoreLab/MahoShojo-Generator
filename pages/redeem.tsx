import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useAuth } from '@/lib/useAuth';
import { authStorage } from '@/lib/auth';
import Footer from '@/components/Footer';

const RedeemPage: React.FC = () => {
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const [code, setCode] = useState('');
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success', text: string } | null>(null);

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isAuthenticated) {
      setMessage({ type: 'error', text: '请先登录后再兑换' });
      return;
    }

    if (!code.trim()) {
      setMessage({ type: 'error', text: '请输入兑换码' });
      return;
    }

    setIsRedeeming(true);
    setMessage(null);

    try {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) {
        setMessage({ type: 'error', text: '认证信息无效，请重新登录' });
        setIsRedeeming(false);
        return;
      }

      const response = await fetch('/api/redeem-code', {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ code: code.trim() })
      });

      const data = await response.json();

      if (data.success) {
        setMessage({ type: 'success', text: data.message });
        setCode('');
        // 3秒后自动返回
        setTimeout(() => {
          router.push('/character-manager');
        }, 3000);
      } else {
        setMessage({ type: 'error', text: data.error || '兑换失败' });
      }
    } catch {
      setMessage({ type: 'error', text: '网络错误，请重试' });
    } finally {
      setIsRedeeming(false);
    }
  };

  return (
    <>
      <Head>
        <title>兑换中心 - MahoShojo Generator</title>
      </Head>
      <div className="magic-background-white">
        <div className="container">
          <div className="card max-w-2xl mx-auto">
            {/* 返回按钮 */}
            <div className="mb-4">
              <Link
                href="/character-manager"
                className="inline-flex items-center text-pink-600 hover:text-pink-700 text-sm font-medium"
              >
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                返回角色管理中心
              </Link>
            </div>

            <div className="text-center mb-6">
              <h1 className="text-3xl font-bold text-gray-800 mb-2">兑换中心</h1>
            </div>

            {/* 用户信息显示 */}
            {isAuthenticated ? (
              <div className="mb-6 p-4 bg-pink-50 rounded-lg">
                <p className="text-sm text-gray-600">
                  当前登录用户：<span className="font-semibold text-pink-700">{user?.username}</span>
                </p>
              </div>
            ) : (
              <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm text-yellow-800">
                  ⚠️ 您尚未登录，请先
                  <Link href="/character-manager" className="text-pink-600 hover:text-pink-700 font-medium underline ml-1">
                    登录账户
                  </Link>
                  {' '}后再进行兑换
                </p>
              </div>
            )}

            {/* 兑换表单 */}
            <form onSubmit={handleRedeem} className="space-y-4">
              <div>
                <label htmlFor="redeem-code" className="block text-sm font-medium text-gray-700 mb-2">
                  兑换码
                </label>
                <input
                  id="redeem-code"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="请输入兑换码，例如：A3F8-E9C2-1D4B"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 text-center text-lg font-mono"
                  disabled={isRedeeming || !isAuthenticated}
                  autoComplete="off"
                  maxLength={14}
                />
                <p className="text-xs text-gray-500 mt-2 text-center">
                  兑换码不区分大小写，需要带连字符
                </p>
              </div>

              {message && (
                <div className={`p-4 rounded-lg text-sm ${
                  message.type === 'error'
                    ? 'bg-red-50 text-red-700 border border-red-200'
                    : 'bg-green-50 text-green-700 border border-green-200'
                }`}>
                  {message.text}
                  {message.type === 'success' && (
                    <p className="mt-2 text-xs">正在返回角色管理中心...</p>
                  )}
                </div>
              )}

              <button
                type="submit"
                className="w-full px-6 py-3 bg-pink-600 text-white rounded-lg hover:bg-pink-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
                disabled={isRedeeming || !isAuthenticated || !code.trim()}
              >
                {isRedeeming ? '兑换中...' : '确认兑换'}
              </button>
            </form>

            {/* 使用说明 */}
            <div className="mt-8 p-4 bg-gray-50 rounded-lg">
              <h3 className="font-semibold text-gray-800 mb-2">💡 使用说明</h3>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• 每个兑换码只能使用一次</li>
                <li>• 兑换码不区分大小写</li>
                <li>• 如果兑换失败，请检查兑换码是否正确或已被使用</li>
              </ul>
            </div>
          </div>

          <div className="text-center mt-8">
            <Link href="/" className="footer-link">返回首页</Link>
          </div>
          <Footer />
        </div>
      </div>
    </>
  );
};

export default RedeemPage;
