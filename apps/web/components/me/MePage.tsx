'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';

import type { NewsReport } from '@/components/BattleReportCard';
import Footer from '@/components/Footer';
import { BattleReportCardModal } from '@/components/me/BattleReportCardModal';
import { BattleReportDetailsModal } from '@/components/me/BattleReportDetailsModal';
import { BattleReportsPanel } from '@/components/me/BattleReportsPanel';
import { AccountSecurityPanel } from '@/components/me/AccountSecurityPanel';
import { AuthMigrationPanel } from '@/components/me/AuthMigrationPanel';
import { MeTabs } from '@/components/me/MeTabs';
import { PvpMatchDetailsModal } from '@/components/me/PvpMatchDetailsModal';
import { PvpMatchesPanel } from '@/components/me/PvpMatchesPanel';
import { ProfileHeader } from '@/components/me/ProfileHeader';
import { ProfileCardModal } from '@/components/me/ProfileCardModal';
import { ProfileSettingsPanel } from '@/components/me/ProfileSettingsPanel';
import { generationApiFetch } from '@/lib/hono-api-client';
import { useAuth } from '@/lib/useAuth';

type MeTab = 'reports' | 'pvp' | 'settings';

const parseMeTabFromSearch = (search: string): MeTab | null => {
  const params = new URLSearchParams(search);
  const tab = params.get('tab');
  if (tab === 'reports' || tab === 'pvp' || tab === 'settings') return tab;
  if (params.get('token')) return 'settings';
  return null;
};

export function MePage() {
  const { user, userBadges, isAuthenticated, loading } = useAuth();
  const [tab, setTab] = useState<MeTab>('reports');

  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [showReportDetails, setShowReportDetails] = useState(false);

  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [showMatchDetails, setShowMatchDetails] = useState(false);

  const [generated, setGenerated] = useState<{
    report: NewsReport;
    generationId?: string;
    generationMode?: string | null;
    liveBody?: string;
  } | null>(null);
  const [showCardModal, setShowCardModal] = useState(false);

  const [showProfileCardModal, setShowProfileCardModal] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncTabFromQuery = () => {
      const nextTab = parseMeTabFromSearch(window.location.search);
      if (nextTab) setTab(nextTab);
    };

    syncTabFromQuery();
    window.addEventListener('popstate', syncTabFromQuery);
    return () => window.removeEventListener('popstate', syncTabFromQuery);
  }, []);

  const regenerateMutation = useMutation({
    mutationFn: async (generationId: string) => {
      const res = await generationApiFetch(`/api/me/battle-reports/${generationId}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '重新生成失败');
      return data as { report: NewsReport; liveBody?: string; generationId?: string; generationMode?: string | null };
    },
    onSuccess: (data) => {
      setGenerated(data);
      setShowCardModal(true);
    },
  });

  const retentionNotice = (
    <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-900">
      提示：受资源限制，战报记录与 PVP 记录 <span className="font-semibold">随时可能被清理</span>，不保证长期保存。建议你及时保存战报卡片图片/Markdown 作为留档。
    </div>
  );

  return (
    <>
      <div className="magic-background-white">
        <div className="container">
          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h1 className="text-xl font-bold">个人页</h1>
              <div className="flex items-center gap-3">
                <Link href="/pvp" className="text-sm text-blue-600 hover:underline">
                  PVP 大厅
                </Link>
                <Link href="/" className="text-sm text-blue-600 hover:underline">
                  返回首页
                </Link>
              </div>
            </div>

            {loading ? <div className="mt-3 text-sm text-gray-600">加载中…</div> : null}

            {!loading && !isAuthenticated ? (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                你尚未登录。请先前往 <Link href="/character-manager" className="underline">角色管理器</Link> 完成登录后再访问个人页。
              </div>
            ) : null}

            {!loading && isAuthenticated && user ? (
              <ProfileHeader
                user={user}
                badges={userBadges}
                onOpenSettings={() => setTab('settings')}
                onOpenProfileCard={() => setShowProfileCardModal(true)}
              />
            ) : null}

            <div className="mt-4">{retentionNotice}</div>

            <div className="mt-4">
              <MeTabs value={tab} onChange={setTab} />
            </div>

            {tab === 'reports' ? (
              <BattleReportsPanel
                isAuthenticated={Boolean(isAuthenticated)}
                onOpenDetails={(generationId) => {
                  setActiveReportId(generationId);
                  setShowReportDetails(true);
                }}
                onRegenerate={(generationId) => regenerateMutation.mutate(generationId)}
                isRegenerating={regenerateMutation.isPending}
                regenerateError={regenerateMutation.error ? (regenerateMutation.error as Error).message : null}
              />
            ) : null}

            {tab === 'pvp' ? (
              <PvpMatchesPanel
                isAuthenticated={Boolean(isAuthenticated)}
                myUserId={user?.id ?? null}
                onOpenMatchDetails={(matchId) => {
                  setActiveMatchId(matchId);
                  setShowMatchDetails(true);
                }}
              />
            ) : null}

            {tab === 'settings' ? (
              <div className="mt-4">
                <AuthMigrationPanel userId={user?.id ?? null} />
                <ProfileSettingsPanel userId={user?.id ?? null} />
                <AccountSecurityPanel userId={user?.id ?? null} username={user?.username ?? null} />
              </div>
            ) : null}
          </div>

          <Footer />
        </div>
      </div>

      <BattleReportDetailsModal
        isOpen={showReportDetails}
        generationId={activeReportId}
        onClose={() => setShowReportDetails(false)}
        onRegenerate={(generationId) => regenerateMutation.mutate(generationId)}
        isRegenerating={regenerateMutation.isPending}
        regenerateError={regenerateMutation.error ? (regenerateMutation.error as Error).message : null}
      />

      <PvpMatchDetailsModal
        isOpen={showMatchDetails}
        matchId={activeMatchId}
        myUserId={user?.id ?? null}
        onClose={() => setShowMatchDetails(false)}
        onOpenBattleReport={(generationId) => {
          setShowMatchDetails(false);
          setActiveMatchId(null);
          setActiveReportId(generationId);
          setShowReportDetails(true);
        }}
      />

      <BattleReportCardModal
        isOpen={showCardModal}
        generationId={generated?.generationId ?? null}
        generationMode={generated?.generationMode ?? null}
        report={generated?.report ?? null}
        liveBody={generated?.liveBody ?? null}
        onClose={() => setShowCardModal(false)}
      />

      <ProfileCardModal isOpen={showProfileCardModal} onClose={() => setShowProfileCardModal(false)} />
    </>
  );
}
