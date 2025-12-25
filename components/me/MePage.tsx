'use client';

import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';

import type { NewsReport } from '@/components/BattleReportCard';
import Footer from '@/components/Footer';
import { BattleReportCardModal } from '@/components/me/BattleReportCardModal';
import { BattleReportDetailsModal } from '@/components/me/BattleReportDetailsModal';
import { BattleReportsPanel } from '@/components/me/BattleReportsPanel';
import { MeTabs } from '@/components/me/MeTabs';
import { PvpMatchDetailsModal } from '@/components/me/PvpMatchDetailsModal';
import { PvpMatchesPanel } from '@/components/me/PvpMatchesPanel';
import { authStorage } from '@/lib/auth';
import { useAuth } from '@/lib/useAuth';

export function MePage() {
  const { user, isAuthenticated, loading } = useAuth();
  const [tab, setTab] = useState<'reports' | 'pvp' | 'settings'>('reports');

  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [showReportDetails, setShowReportDetails] = useState(false);

  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [showMatchDetails, setShowMatchDetails] = useState(false);

  const [generated, setGenerated] = useState<{ report: NewsReport; generationId?: string; liveBody?: string } | null>(null);
  const [showCardModal, setShowCardModal] = useState(false);

  const regenerateMutation = useMutation({
    mutationFn: async (generationId: string) => {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) throw new Error('未登录');
      const res = await fetch(`/api/me/battle-reports/${generationId}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '重新生成失败');
      return data as { report: NewsReport; liveBody?: string; generationId?: string };
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
      <Head>
        <title>个人页 - MahoShojo Generator</title>
        <meta name="description" content="查看战报记录、PVP 战绩与个人设置" />
      </Head>

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
              <div className="mt-3 rounded-xl border bg-white p-4 text-sm">
                当前用户：
                <span className="ml-1 font-semibold">
                  {user.prefix ? `${user.prefix} ` : ''}
                  {user.username}
                </span>
                <span className="ml-2 text-xs text-gray-600">ID：{user.id}</span>
              </div>
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
                <div className="font-semibold mb-2">个人设置（预留）</div>
                <div className="rounded-xl border bg-white p-4 text-sm text-gray-700">
                  <div className="mb-2">此区域将用于后续实现：</div>
                  <ul className="list-disc list-inside space-y-1">
                    <li>改绑邮箱</li>
                    <li>修改密码</li>
                    <li>修改用户名</li>
                  </ul>
                  <div className="text-xs text-gray-500 mt-2">当前版本仅预留入口，功能后续逐步上线。</div>
                </div>
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
        report={generated?.report ?? null}
        liveBody={generated?.liveBody ?? null}
        onClose={() => setShowCardModal(false)}
      />
    </>
  );
}
