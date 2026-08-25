'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { betaAccessConfig } from '@/config/beta-access';
import { evaluateBetaAccess, getBetaAccessFeature, matchBetaAccessRequirement } from '@/lib/beta-access';
import { useBetaAccessStatus } from '@/lib/beta-access-client';
import { useAuth } from '@/lib/useAuth';

const formatCount = (value: number) => new Intl.NumberFormat('zh-CN').format(value);

type RequirementStatus = 'met' | 'missing' | 'unknown';

type RequirementStatusMeta = {
  label: string;
  className: string;
};

const requirementStatusMap: Record<RequirementStatus, RequirementStatusMeta> = {
  met: { label: '已满足', className: 'border-emerald-300/70 text-emerald-100 bg-emerald-500/10' },
  missing: { label: '未满足', className: 'border-rose-300/70 text-rose-100 bg-rose-500/10' },
  unknown: { label: '待核验', className: 'border-purple-200/70 text-purple-100 bg-purple-500/10' },
};

interface BetaAccessPageProps {
  rawFeature?: string | null;
}

export function BetaAccessPage({ rawFeature = null }: BetaAccessPageProps) {
  const router = useRouter();
  const feature = getBetaAccessFeature(rawFeature);
  const resolvedFeatureId = feature?.id ?? 'magic-tea-party';

  const { userBadges, isAuthenticated, loading, badgesLoading } = useAuth();
  const accessState = useBetaAccessStatus({
    featureId: resolvedFeatureId,
    isAuthenticated,
    loading,
    badges: userBadges,
    badgesLoading,
  });

  const evaluation = useMemo(() => {
    return evaluateBetaAccess(feature?.id ?? null, userBadges, accessState.stats);
  }, [feature?.id, userBadges, accessState.stats]);

  const showRequirements = Boolean(feature) && (feature?.showRequirements ?? betaAccessConfig.showRequirementsByDefault);

  const resolveRequirementStatus = (requirement: Parameters<typeof matchBetaAccessRequirement>[0]): RequirementStatus => {
    if (loading || badgesLoading || !isAuthenticated) return 'unknown';
    if (requirement.type !== 'badge' && !accessState.stats) return 'unknown';
    return matchBetaAccessRequirement(requirement, accessState.stats, userBadges) ? 'met' : 'missing';
  };

  const allOf = feature?.requirements.allOf ?? [];
  const anyOf = feature?.requirements.anyOf ?? [];

  const [autoRedirectCountdown, setAutoRedirectCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (!feature || !evaluation.allowed || !isAuthenticated) {
      setAutoRedirectCountdown(null);
      return;
    }
    let countdown = 3;
    setAutoRedirectCountdown(countdown);
    const intervalId = window.setInterval(() => {
      countdown -= 1;
      setAutoRedirectCountdown(countdown);
    }, 1000);
    const timeoutId = window.setTimeout(() => {
      void router.replace(feature.href);
    }, 3000);
    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, [evaluation.allowed, feature, isAuthenticated, router]);

  const statusText = (() => {
    if (loading || accessState.status === 'loading') return '正在核验权限…';
    if (!isAuthenticated) return '尚未登录，无法验证内测资格。';
    if (accessState.status === 'error') return accessState.error || '暂时无法核验权限。';
    if (feature && evaluation.allowed) return '检测到你已满足条件，正在为你放行。';
    return '该功能仍处于内测阶段，尚未对所有用户开放。';
  })();

  return (
    <>
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-violet-800 to-indigo-900 text-white font-sans relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 left-10 text-6xl animate-pulse">🌸</div>
          <div className="absolute top-20 right-20 text-4xl animate-bounce">🌿</div>
          <div className="absolute top-1/3 left-1/4 text-5xl animate-pulse">🌺</div>
          <div className="absolute top-2/3 right-1/3 text-3xl animate-bounce">🍃</div>
          <div className="absolute bottom-20 left-20 text-4xl animate-pulse">🌹</div>
          <div className="absolute bottom-10 right-10 text-5xl animate-bounce">🌷</div>
          <div className="absolute top-1/2 left-10 text-3xl animate-pulse">🌻</div>
          <div className="absolute top-1/4 right-1/4 text-4xl animate-bounce">🌼</div>
        </div>

        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute animate-float w-2 h-2 bg-purple-300 rounded-full opacity-60" style={{ top: '20%', left: '15%', animationDelay: '0s' }}></div>
          <div className="absolute animate-float w-1 h-1 bg-violet-300 rounded-full opacity-70" style={{ top: '40%', left: '80%', animationDelay: '1s' }}></div>
          <div className="absolute animate-float w-3 h-3 bg-pink-300 rounded-full opacity-50" style={{ top: '60%', left: '25%', animationDelay: '2s' }}></div>
          <div className="absolute animate-float w-1 h-1 bg-purple-200 rounded-full opacity-80" style={{ top: '80%', left: '70%', animationDelay: '3s' }}></div>
        </div>

        <div className="container mx-auto px-4 pb-8 pt-4 relative z-10">
          <div className="text-center text-purple-100 mb-2">权限审查结果</div>
          <div className="bg-gradient-to-r from-pink-600 via-purple-600 to-violet-600 border-2 border-pink-400 rounded-lg p-6 mb-6 text-center shadow-2xl relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent opacity-10 animate-pulse"></div>
            <div className="relative z-10">
              <div className="text-4xl font-semibold text-purple-100" style={{ padding: '2rem' }}>
                未 获 授 权
              </div>
            </div>
          </div>

          <div className="text-center text-sm text-purple-200 mb-8">
            <div>{statusText}</div>
            <div className="mt-2">
              {feature ? (
                <span>
                  你正在访问：<span className="text-pink-200">{feature.title}</span>
                </span>
              ) : (
                <span>你正在访问一个尚未登记的内测入口。</span>
              )}
            </div>
          </div>

          <div className="bg-gradient-to-b from-purple-900 to-violet-900 border-2 border-pink-500 rounded-lg p-8 mb-8 shadow-2xl relative">
            <div
              className="absolute inset-0 rounded-lg opacity-20 bg-no-repeat bg-center bg-contain"
              style={{
                backgroundImage: 'url(/arrest-frame.svg)',
                backgroundSize: 'contain',
                backgroundPosition: 'center',
              }}
            ></div>
            <div className="absolute top-4 right-4 text-2xl animate-spin">✨</div>
            <div className="absolute bottom-4 left-4 text-2xl animate-bounce">✨</div>

            <div className="relative text-center space-y-6">
              <div className="text-2xl font-serif text-pink-300">魔法国度魔事院</div>
              <div className="text-sm text-purple-200 tracking-widest">
                M A G I C A L &nbsp; K I N G D O M &nbsp; B U R E A U &nbsp; O F &nbsp; M A G I C A L &nbsp; A F F A I R S
              </div>
              <div className="text-lg text-purple-100">
                {feature?.summary ?? '当前功能仍处于内测阶段，授权正在分批开放。'}
              </div>
              <div className="text-purple-100 space-y-2">
                <p className="flex items-center justify-center gap-2">⚠️ 矢车菊权杖严正声明 ⚠️</p>
                <p className="text-xl flex items-center justify-center gap-2">未经魔事院授权不得访问</p>
              </div>
            </div>
          </div>

          {feature && evaluation.allowed && isAuthenticated ? (
            <div className="bg-purple-950/70 border border-emerald-400/70 rounded-lg p-6 mb-8 shadow-2xl">
              <div className="text-emerald-100 text-lg font-semibold">权限已通过</div>
              <p className="text-sm text-emerald-100/80 mt-2">
                系统已确认你的内测资格{autoRedirectCountdown !== null ? `，${autoRedirectCountdown} 秒后自动放行。` : '。'}
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link
                  href={feature.href}
                  className="rounded-full border border-emerald-200/70 px-5 py-2 text-sm text-emerald-100 hover:bg-emerald-400/10"
                >
                  立即进入 {feature.title}
                </Link>
                <Link
                  href="/"
                  className="rounded-full border border-purple-200/70 px-5 py-2 text-sm text-purple-100 hover:bg-purple-400/10"
                >
                  返回首页
                </Link>
              </div>
            </div>
          ) : showRequirements ? (
            <div className="bg-purple-950/70 border border-pink-400/80 rounded-lg p-6 mb-8 shadow-2xl">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-pink-200 text-lg font-semibold">准入条件</div>
                  <p className="text-sm text-purple-100/80 mt-2">满足条件后可获得相应访问授权。</p>
                </div>
                {accessState.stats ? (
                  <div className="grid grid-cols-3 gap-3 text-center text-xs text-purple-100/80">
                    <div>
                      <div className="text-[10px] uppercase tracking-widest">公开卡数量</div>
                      <div className="text-base font-semibold text-white">{formatCount(accessState.stats.publicCards)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-widest">公开卡使用</div>
                      <div className="text-base font-semibold text-white">{formatCount(accessState.stats.publicUsageTotal)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-widest">公开卡收藏</div>
                      <div className="text-base font-semibold text-white">{formatCount(accessState.stats.publicFavoriteTotal)}</div>
                    </div>
                  </div>
                ) : null}
              </div>

              {allOf.length > 0 ? (
                <div className="mt-5">
                  <div className="text-xs text-purple-200 mb-2">需要满足全部条件</div>
                  <div className="space-y-2">
                    {allOf.map((req, index) => {
                      const status = resolveRequirementStatus(req);
                      const statusMeta = requirementStatusMap[status];
                      return (
                        <div key={`all-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-purple-700/60 bg-purple-900/60 px-4 py-3">
                          <span className="text-sm text-purple-100">{req.label}</span>
                          <span className={`rounded-full border px-3 py-1 text-xs ${statusMeta.className}`}>{statusMeta.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {anyOf.length > 0 ? (
                <div className="mt-5">
                  <div className="text-xs text-purple-200 mb-2">满足任一条件即可</div>
                  <div className="space-y-2">
                    {anyOf.map((req, index) => {
                      const status = resolveRequirementStatus(req);
                      const statusMeta = requirementStatusMap[status];
                      return (
                        <div key={`any-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-purple-700/60 bg-purple-900/60 px-4 py-3">
                          <span className="text-sm text-purple-100">{req.label}</span>
                          <span className={`rounded-full border px-3 py-1 text-xs ${statusMeta.className}`}>{statusMeta.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {!isAuthenticated ? (
                <div className="mt-5 text-xs text-purple-100/80">
                  提示：登录后才能核验徽章与数据卡统计。
                </div>
              ) : null}

              {feature && evaluation.allowed && isAuthenticated ? (
                <div className="mt-5 text-xs text-emerald-100/80">检测到你已满足条件，如仍被拦截请刷新或稍后再试。</div>
              ) : null}
            </div>
          ) : (
            <div className="bg-purple-950/70 border border-pink-400/80 rounded-lg p-6 mb-8 shadow-2xl text-sm text-purple-100/80">
              本次内测条件暂不对外公开，授权将通过魔事院系统自动下发。
            </div>
          )}

          {!isAuthenticated ? (
            <div className="bg-purple-950/60 border border-pink-300/70 rounded-lg p-4 text-sm text-purple-100 mb-6">
              尚未登录。请先前往 <Link href="/character-manager" className="text-pink-200 hover:underline">角色管理器</Link> 完成登录，再返回进行授权核验。
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-center gap-4 text-sm">
            <Link href="/" className="rounded-full border border-pink-200/70 px-5 py-2 text-pink-100 hover:bg-pink-400/10">
              返回首页
            </Link>
            <Link href="/me" className="rounded-full border border-purple-200/70 px-5 py-2 text-purple-100 hover:bg-purple-400/10">
              个人页与徽章
            </Link>
            <Link href="/badge-manager" className="rounded-full border border-purple-200/70 px-5 py-2 text-purple-100 hover:bg-purple-400/10">
              徽章管理
            </Link>
          </div>

          <div className="mt-8 text-center text-xs text-purple-300">本拦截提示由魔法国度魔事院发布</div>
        </div>

        <style jsx>{`
          @keyframes float {
            0%, 100% { transform: translateY(0px) rotate(0deg); }
            50% { transform: translateY(-20px) rotate(180deg); }
          }
          .animate-float {
            animation: float 4s ease-in-out infinite;
          }
        `}</style>
      </div>
    </>
  );
}
