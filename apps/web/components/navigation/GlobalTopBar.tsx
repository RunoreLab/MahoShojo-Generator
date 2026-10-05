'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { AVAILABLE, type CapabilitySnapshot } from '@mahoshojo/ui-web/capability';
import { NAV_GROUPS } from '@mahoshojo/ui-web/navigation';
import {
  ProductTopBar,
  TOPBAR_PRODUCT_HREFS,
  type TopBarAccountState,
} from '@mahoshojo/ui-web/shell';

import AuthModal from '@/components/CharManager/AuthModal';
import { useTopBarMessages } from '@/components/navigation/useTopBarMessages';
import { useTopBarProfile } from '@/components/navigation/useTopBarProfile';
import UserTitle from '@/components/UserTitle';
import { useAuth } from '@/lib/useAuth';

/**
 * Web 宿主侧能力快照：产品导航、顶栏路径在 Web 全部已交付——
 * 能力投影的职责不是复刻 Web 的真值表，而是让共享顶栏在两宿主消费同一份
 * CapabilityAvailability 语义（DESK-ONLINE-014 的共源约束）。
 */
const WEB_CAPABILITIES: CapabilitySnapshot = Object.fromEntries(
  [
    ...TOPBAR_PRODUCT_HREFS,
    ...NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href)),
  ].map((href) => [href, AVAILABLE]),
);

interface GlobalTopBarProps {
  pathname: string;
  defaultMobileOpen?: boolean;
}

/**
 * Web 顶栏装配层：`@mahoshojo/ui-web` 的 `ProductTopBar` 是唯一产品实现，
 * 本组件只负责注入 Web 宿主事实——Next Router 接管、Web 账号/头像/消息
 * hooks、AuthModal 与登录注册闭环。展示结构、导航分组、文案与 aria 全部
 * 在共享层闭合（DESK-ONLINE-008 / DESK-ONLINE-014）。
 */
export function GlobalTopBar({ pathname, defaultMobileOpen = false }: GlobalTopBarProps) {
  const router = useRouter();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMessage, setAuthMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(
    null,
  );
  const { isAuthenticated, user, userBadges, loading, login, register, logout } = useAuth();
  const { unreadTotal, hasCrowdReviewPending } = useTopBarMessages(
    user?.id ?? null,
    isAuthenticated,
  );
  const { avatarDataUrl } = useTopBarProfile(user?.id ?? null, isAuthenticated);

  const handleRegister = async (
    username: string,
    email: string,
    turnstileToken: string,
    password: string,
  ) => {
    setAuthMessage(null);
    const result = await register(username, email, turnstileToken, password);
    if (!result.success) {
      setAuthMessage({ type: 'error', text: result.error || '注册失败' });
      return;
    }
    setShowAuthModal(false);
  };

  const handleLogin = async (
    identifier: string,
    credential: string,
    turnstileToken: string,
    mode: 'password' | 'legacy',
  ) => {
    setAuthMessage(null);
    const result = await login(identifier, credential, turnstileToken, mode);
    if (result.success) {
      setShowAuthModal(false);
    } else {
      setAuthMessage({ type: 'error', text: result.error || '登录失败' });
    }
    return result;
  };

  const openAuthModal = () => {
    setAuthMessage(null);
    setShowAuthModal(true);
  };

  const account: TopBarAccountState = loading
    ? { kind: 'loading' }
    : isAuthenticated && user
      ? {
          kind: 'signed-in',
          username: user.username,
          avatarDataUrl,
          title: (
            <UserTitle
              badges={userBadges}
              className="hidden max-w-40 overflow-hidden lg:inline-flex"
              showBadges
            />
          ),
        }
      : { kind: 'signed-out' };

  return (
    <>
      <ProductTopBar
        pathname={pathname}
        capabilities={WEB_CAPABILITIES}
        logoSrc="/favicon.svg"
        account={account}
        messages={
          isAuthenticated ? { unreadTotal, hasCrowdReviewPending } : undefined
        }
        onNavigate={(href, event) => {
          // 只接管普通主键点击：修饰键（Ctrl/Cmd/Shift/Alt）与非主键点击
          // 必须落回浏览器原生锚点语义（新标签/新窗口）——共源前 next/link
          // 在这些情况下从不执行客户端导航，接管它们是一次行为回归。
          if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          ) {
            return;
          }
          event.preventDefault();
          router.push(href);
        }}
        // Web 端允许站外链接走浏览器原生 `target="_blank"`——提供 handler
        // 即声明宿主具备站外能力且不拦截默认行为。
        onNavigateExternal={() => undefined}
        onRequestAuth={openAuthModal}
        onSignOut={() => {
          void logout();
        }}
        defaultMobileOpen={defaultMobileOpen}
      />

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => {
          setShowAuthModal(false);
          setAuthMessage(null);
        }}
        onLogin={handleLogin}
        onRegister={handleRegister}
        authMessage={authMessage}
      />
    </>
  );
}
