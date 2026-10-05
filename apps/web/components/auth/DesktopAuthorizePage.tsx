'use client';

import { useState } from 'react';

import type {
  DesktopAuthGrantResponse,
  DesktopAuthorizeQuery,
} from '@mahoshojo/contracts/desktop-cloud';

import AuthModal from '@/components/CharManager/AuthModal';
import { useAuth } from '@/lib/useAuth';

/**
 * `desktop-auth-v1` 的浏览器授权页。
 *
 * 只负责「确认登录身份 → 调用 grant 端点 → 跳回 loopback」三步：
 * - 参数非法时明确报错，绝不静默放行（协议校验由 Server Component 完成；
 *   本组件对 contracts 只有 type import，loopback schema 不进客户端 bundle）；
 * - 未登录时打开复用登录弹层，登录成功后留在本页继续；
 * - 跳转地址完全由服务端 grant 响应给出，本页不自行拼接 code/state。
 */

type AuthorizePhase =
  | { kind: 'confirm' }
  | { kind: 'submitting' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; message: string };

interface DesktopAuthorizePageProps {
  /** Server Component 已按 `desktop-auth-v1` 校验过的授权参数；null 表示参数非法。 */
  grant: DesktopAuthorizeQuery | null;
  /** grant 签发端点的同源相对路径（由服务端注入，客户端不依赖契约运行时代码）。 */
  grantPath: string;
}

const INVALID_PARAMS_MESSAGE = '授权参数无效或不完整。请回到桌面应用重新发起登录。';

export function DesktopAuthorizePage({ grant, grantPath }: DesktopAuthorizePageProps) {
  const { isAuthenticated, loading, user, login, register } = useAuth();

  const [phase, setPhase] = useState<AuthorizePhase>({ kind: 'confirm' });
  const [authMessage, setAuthMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const confirmGrant = async (grant: DesktopAuthorizeQuery) => {
    setPhase({ kind: 'submitting' });
    try {
      const response = await fetch(grantPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: grant.state,
          codeChallenge: grant.code_challenge,
          codeChallengeMethod: grant.code_challenge_method,
          redirectUri: grant.redirect_uri,
        }),
      });
      const payload = (await response.json().catch(() => null)) as Partial<DesktopAuthGrantResponse> | null;
      if (!response.ok || typeof payload?.redirectUrl !== 'string') {
        const message = payload && typeof (payload as { error?: unknown }).error === 'string'
          ? (payload as { error: string }).error
          : '授权失败，请稍后重试。';
        setPhase({ kind: 'failed', message });
        return;
      }
      // 导航到服务端给出的 loopback 回跳地址；此后本页生命周期结束。
      window.location.assign(payload.redirectUrl);
    } catch {
      setPhase({ kind: 'failed', message: '网络异常，授权未完成。' });
    }
  };

  const renderCard = (children: React.ReactNode) => (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-md">{children}</div>
    </div>
  );

  if (!grant) {
    return renderCard(
      <>
        <h1 className="mb-4 text-xl font-bold text-gray-800">桌面端授权</h1>
        <p className="text-sm text-red-600">{INVALID_PARAMS_MESSAGE}</p>
      </>,
    );
  }

  if (phase.kind === 'cancelled') {
    return renderCard(
      <>
        <h1 className="mb-4 text-xl font-bold text-gray-800">已取消授权</h1>
        <p className="text-sm text-gray-600">桌面应用不会获得您的账号访问权限。您可以直接关闭本页。</p>
      </>,
    );
  }

  if (phase.kind === 'failed') {
    return renderCard(
      <>
        <h1 className="mb-4 text-xl font-bold text-gray-800">授权未完成</h1>
        <p className="text-sm text-red-600">{phase.message}</p>
      </>
    );
  }

  if (loading) {
    return renderCard(<p className="text-sm text-gray-600">正在检查登录状态…</p>);
  }

  if (!isAuthenticated) {
    return renderCard(
      <>
        <h1 className="mb-4 text-xl font-bold text-gray-800">桌面端授权</h1>
        <p className="mb-4 text-sm text-gray-600">
          桌面应用「MahoShojo 客户端」请求访问您的账号。请先登录后再确认授权。
        </p>
        <button
          type="button"
          className="generate-button w-full"
          onClick={() => setAuthModalOpen(true)}
        >
          登录 / 注册
        </button>
        <button
          type="button"
          className="mt-3 w-full rounded-md border border-gray-300 py-2 text-sm text-gray-600 hover:bg-gray-50"
          onClick={() => setPhase({ kind: 'cancelled' })}
        >
          取消授权
        </button>
        <AuthModal
          isOpen={authModalOpen}
          onClose={() => setAuthModalOpen(false)}
          onLogin={async (identifier, credential, turnstileToken, mode) => {
            setAuthMessage(null);
            const result = await login(identifier, credential, turnstileToken, mode);
            if (result?.success) {
              setAuthModalOpen(false);
            } else {
              setAuthMessage({ type: 'error', text: result?.error || '登录失败，请重试。' });
            }
            return result;
          }}
          onRegister={async (username, email, turnstileToken, password) => {
            setAuthMessage(null);
            const result = await register(username, email, turnstileToken, password);
            if (result?.success) {
              setAuthModalOpen(false);
            } else {
              setAuthMessage({ type: 'error', text: result?.error || '注册失败，请重试。' });
            }
          }}
          authMessage={authMessage}
        />
      </>,
    );
  }

  return renderCard(
    <>
      <h1 className="mb-4 text-xl font-bold text-gray-800">桌面端授权</h1>
      <p className="mb-2 text-sm text-gray-600">
        桌面应用「MahoShojo 客户端」请求以您的账号
        <span className="mx-1 font-medium text-gray-800">{user?.username ?? '当前账号'}</span>
        登录。
      </p>
      <p className="mb-6 text-sm text-gray-500">
        确认后将回到桌面应用完成登录；应用只能访问您的账号信息与您主动发起的在线操作。
      </p>
      <button
        type="button"
        className={`generate-button w-full ${phase.kind === 'submitting' ? 'cursor-not-allowed opacity-50' : ''}`}
        disabled={phase.kind === 'submitting'}
        onClick={() => void confirmGrant(grant)}
      >
        {phase.kind === 'submitting' ? '正在授权…' : '授权并返回应用'}
      </button>
      <button
        type="button"
        className="mt-3 w-full rounded-md border border-gray-300 py-2 text-sm text-gray-600 hover:bg-gray-50"
        disabled={phase.kind === 'submitting'}
        onClick={() => setPhase({ kind: 'cancelled' })}
      >
        取消授权
      </button>
    </>,
  );
}
