import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { CrowdReviewCurrentCaseCard } from '@/components/investigation/CrowdReviewCurrentCaseCard';
import { authStorage } from '@/lib/auth';
import type {
  AssignCurrentCaseResult,
  CrowdReviewCurrentCaseDto,
  CrowdReviewSummaryDto,
} from '@/lib/crowd-review/types';
import { useAuth } from '@/lib/useAuth';

type InvestigationAuthState = 'loading' | 'anonymous' | 'authenticated';

export type InvestigationPageState = {
  authState: InvestigationAuthState;
  summary: CrowdReviewSummaryDto | null;
  currentCase: CrowdReviewCurrentCaseDto | null;
  loading: boolean;
  error: string | null;
};

const createDefaultState = (authState: InvestigationAuthState): InvestigationPageState => ({
  authState,
  summary: null,
  currentCase: null,
  loading: authState !== 'anonymous',
  error: null,
});

const readErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  if (payload && typeof payload.error === 'string' && payload.error.trim().length > 0) {
    return payload.error;
  }
  return fallback;
};

const isCompletedCurrentCase = (currentCase: CrowdReviewCurrentCaseDto | null): boolean =>
  currentCase != null &&
  currentCase.postVoteSummary != null &&
  (
    currentCase.assignmentStatus === 'voted' ||
    currentCase.assignmentStatus === 'abstained' ||
    currentCase.assignmentStatus === 'expired' ||
    currentCase.assignmentStatus === 'revoked'
  );

export function InvestigationPage({
  initialStateOverride,
}: {
  initialStateOverride?: Partial<InvestigationPageState>;
}) {
  const auth = useAuth();
  const isStaticOverride = initialStateOverride != null;
  const effectiveAuthState: InvestigationAuthState = isStaticOverride
    ? (initialStateOverride?.authState ?? 'anonymous')
    : auth.loading
      ? 'loading'
      : auth.isAuthenticated
        ? 'authenticated'
        : 'anonymous';

  const [state, setState] = useState<InvestigationPageState>(() => ({
    ...createDefaultState(effectiveAuthState),
    ...initialStateOverride,
  }));
  const [assigning, setAssigning] = useState(false);

  const loadPageData = useCallback(async () => {
    if (isStaticOverride || effectiveAuthState === 'loading') {
      return;
    }

    setState((current) => ({
      ...current,
      authState: effectiveAuthState,
      loading: true,
      error: null,
    }));

    try {
      const summaryResponse =
        effectiveAuthState === 'authenticated'
          ? await authStorage.fetch('/api/crowd-review/summary', {
              method: 'GET',
              cache: 'no-store',
            })
          : await fetch('/api/crowd-review/summary', {
              method: 'GET',
              cache: 'no-store',
              credentials: 'same-origin',
            });

      if (!summaryResponse.ok) {
        throw new Error(await readErrorMessage(summaryResponse, '调查院状态加载失败'));
      }

      const summary = (await summaryResponse.json()) as CrowdReviewSummaryDto;
      let currentCase: CrowdReviewCurrentCaseDto | null = null;

      if (effectiveAuthState === 'authenticated' && summary.eligible && summary.hasCurrentAssignment) {
        const currentResponse = await authStorage.fetch('/api/crowd-review/current', {
          method: 'GET',
          cache: 'no-store',
        });

        if (currentResponse.ok) {
          currentCase = (await currentResponse.json()) as CrowdReviewCurrentCaseDto;
        } else if (currentResponse.status !== 404) {
          throw new Error(await readErrorMessage(currentResponse, '当前案件加载失败'));
        }
      }

      setState({
        authState: effectiveAuthState,
        summary,
        currentCase,
        loading: false,
        error: null,
      });
    } catch (loadError) {
      setState((current) => ({
        ...current,
        authState: effectiveAuthState,
        loading: false,
        error: loadError instanceof Error ? loadError.message : '调查院状态加载失败',
      }));
    }
  }, [effectiveAuthState, isStaticOverride]);

  useEffect(() => {
    if (isStaticOverride) {
      return;
    }

    void loadPageData();
  }, [isStaticOverride, loadPageData]);

  const refreshSummaryAfterCaseCompletion = useCallback(async () => {
    if (isStaticOverride || effectiveAuthState !== 'authenticated') {
      return;
    }

    try {
      const summaryResponse = await authStorage.fetch('/api/crowd-review/summary', {
        method: 'GET',
        cache: 'no-store',
      });

      if (!summaryResponse.ok) {
        throw new Error(await readErrorMessage(summaryResponse, '调查院状态加载失败'));
      }

      const summary = (await summaryResponse.json()) as CrowdReviewSummaryDto;
      setState((current) => ({
        ...current,
        authState: effectiveAuthState,
        summary,
        currentCase: summary.hasCurrentAssignment ? current.currentCase : (isCompletedCurrentCase(current.currentCase) ? current.currentCase : null),
        error: null,
      }));
    } catch (refreshError) {
      setState((current) => ({
        ...current,
        error: refreshError instanceof Error ? refreshError.message : '调查院状态加载失败',
      }));
    }
  }, [effectiveAuthState, isStaticOverride]);

  const handleAssignCurrentCase = async () => {
    if (isStaticOverride || effectiveAuthState !== 'authenticated') {
      return;
    }

    setAssigning(true);
    setState((current) => ({ ...current, error: null }));

    try {
      const response = await authStorage.fetch('/api/crowd-review/current/assign', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const payload = (await response.json().catch(() => null)) as
        | AssignCurrentCaseResult
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(
          payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
            ? payload.error
            : '领取案件失败',
        );
      }

      if (!payload || !('currentCase' in payload)) {
        throw new Error('领取案件失败');
      }

      setState((current) => ({
        ...current,
        summary: current.summary
          ? {
              ...current.summary,
              eligible: true,
              inspectorStatus: 'active',
              hasCurrentAssignment: true,
              hasCrowdReviewPending: true,
            }
          : current.summary,
        currentCase: payload.currentCase,
        error: null,
      }));
    } catch (assignError) {
      setState((current) => ({
        ...current,
        error: assignError instanceof Error ? assignError.message : '领取案件失败',
      }));
    } finally {
      setAssigning(false);
    }
  };

  const updateCurrentCase = (nextCase: CrowdReviewCurrentCaseDto) => {
    setState((current) => ({
      ...current,
      currentCase: nextCase,
    }));

    if (isCompletedCurrentCase(nextCase)) {
      void refreshSummaryAfterCaseCompletion();
    }
  };

  const summary = state.summary;
  const showAnonymousState = state.authState === 'anonymous';
  const showIneligibleState =
    summary != null &&
    !summary.eligible &&
    (
      summary.inspectorStatus === 'suspended' ||
      summary.inspectorStatus === 'ineligible' ||
      summary.inspectorStatus === 'revoked'
    );
  const showAssignableState =
    summary != null &&
    summary.eligible &&
    summary.inspectorStatus === 'active' &&
    !summary.hasCurrentAssignment &&
    (!state.currentCase || isCompletedCurrentCase(state.currentCase));

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.16),_transparent_34%),linear-gradient(180deg,_#fffbeb_0%,_#fff7ed_34%,_#f8fafc_100%)] px-4 py-8 text-gray-900 dark:bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.12),_transparent_30%),linear-gradient(180deg,_#020617_0%,_#111827_48%,_#0f172a_100%)] dark:text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <section className="rounded-[32px] border border-white/70 bg-white/85 p-6 shadow-xl backdrop-blur dark:border-slate-700/70 dark:bg-slate-950/75">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-amber-600 dark:text-amber-200">
            Investigation
          </p>
          <h1 className="mt-2 text-3xl font-bold">调查院</h1>
          <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-slate-300">
            面向公开数据卡的众查入口。这里会显示你当前可处理的案件与调查员状态。
          </p>
        </section>

        {state.error ? (
          <section className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-200">
            {state.error}
          </section>
        ) : null}

        {state.loading ? (
          <section className="rounded-3xl border border-white/70 bg-white/75 px-6 py-10 text-center text-sm text-gray-500 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-400">
            正在加载调查院状态…
          </section>
        ) : null}

        {!state.loading && showAnonymousState ? (
          <section className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-lg dark:border-slate-700/70 dark:bg-slate-950/80">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-50">请先登录</h2>
            <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-slate-300">
              登录后可查看调查员资格、领取众查案件并提交处理结论。
            </p>
            <Link
              href="/character-manager"
              className="mt-5 inline-flex rounded-full bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-500"
            >
              前往登录
            </Link>
          </section>
        ) : null}

        {!state.loading && showIneligibleState ? (
          <section className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-lg dark:border-slate-700/70 dark:bg-slate-950/80">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-50">当前不可参与众查</h2>
            <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-slate-300">
              {summary?.statusReason ?? '当前账号尚未满足调查员资格要求。'}
            </p>
          </section>
        ) : null}

        {!state.loading && showAssignableState ? (
          <section className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-lg dark:border-slate-700/70 dark:bg-slate-950/80">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-50">当前没有已领取案件</h2>
            <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-slate-300">
              {summary?.hasCrowdReviewPending
                ? '现在有新的众查案件可处理，你可以直接领取当前案件。'
                : '当前案件池为空，稍后再来查看。'}
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleAssignCurrentCase()}
                disabled={assigning || !summary?.hasCrowdReviewPending}
                className="inline-flex rounded-full bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
              >
                {assigning ? '领取中…' : '领取当前案件'}
              </button>
              <button
                type="button"
                onClick={() => void loadPageData()}
                className="inline-flex rounded-full border border-gray-300 bg-white/80 px-5 py-2.5 text-sm font-semibold text-gray-700 transition hover:border-amber-300 hover:text-amber-700 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200"
              >
                刷新状态
              </button>
            </div>
          </section>
        ) : null}

        {!state.loading && state.currentCase ? (
          <CrowdReviewCurrentCaseCard currentCase={state.currentCase} onCaseUpdated={updateCurrentCase} />
        ) : null}
      </div>
    </main>
  );
}
