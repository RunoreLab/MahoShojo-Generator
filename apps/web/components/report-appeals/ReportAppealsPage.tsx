'use client';

import { useEffect, useState } from 'react';

import { authStorage } from '@/lib/auth';
import {
  REPORT_APPEAL_REASON_OPTIONS,
  type ReportAppealDetailDto,
  type ReportAppealEntryDto,
  type ReportAppealListDto,
  type ReportAppealReferenceDraft,
  type SubmitReportAppealResult,
} from '@/lib/report-appeals/types';
import ReportAppealForm, { getReportAppealFormIdentity } from '@/components/report-appeals/ReportAppealForm';
import ReportAppealHistoryCard from '@/components/report-appeals/ReportAppealHistoryCard';

type QueryState = {
  reportCaseId?: string | null;
  appealId?: string | null;
};

type ReportAppealsPageProps = {
  query?: QueryState;
  initialHistory?: ReportAppealListDto | null;
  initialEntry?: ReportAppealEntryDto | null;
  initialDetail?: ReportAppealDetailDto | null;
};

type ReportAppealFormEntry = ReportAppealEntryDto & {
  caseUpdatedAtSnapshot: string;
  targetCard: { id: string; name: string };
};

export type SubmitReportAppealPayload = {
  reportCaseId: string;
  caseUpdatedAtSnapshot: string;
  appealReasonCode: string;
  details: string;
  references: ReportAppealReferenceDraft[];
};

const shouldRenderAppealForm = ({
  reportCaseId,
  entry,
  detail,
}: {
  reportCaseId: string | null;
  entry: ReportAppealEntryDto | null;
  detail: ReportAppealDetailDto | null;
}) => {
  if (!reportCaseId) return false;
  if (!entry?.eligible || !entry.targetCard || !entry.caseUpdatedAtSnapshot) return false;
  if (detail) return detail.status === 'withdrawn';
  if (entry.existingAppeal) return entry.existingAppeal.status === 'withdrawn';
  return true;
};

const isReportAppealFormEntry = (entry: ReportAppealEntryDto | null): entry is ReportAppealFormEntry =>
  Boolean(entry?.eligible && entry.targetCard && entry.caseUpdatedAtSnapshot);

const fetchJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await authStorage.fetch(url, init);
  const payload = (await response.json()) as T;
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
};

export async function loadReportAppealsPageData(
  query: QueryState,
  fetcher: <T>(url: string, init?: RequestInit) => Promise<T> = fetchJson,
): Promise<{
  history: ReportAppealListDto;
  entry: ReportAppealEntryDto | null;
  detail: ReportAppealDetailDto | null;
}> {
  const history = await fetcher<ReportAppealListDto>('/api/report-appeals');

  if (query.appealId) {
    return {
      history,
      entry: null,
      detail: await fetcher<ReportAppealDetailDto>(
        `/api/report-appeals/detail?appealId=${encodeURIComponent(query.appealId)}`,
      ),
    };
  }

  if (query.reportCaseId) {
    const entry = await fetcher<ReportAppealEntryDto>(
      `/api/report-appeals/entry?reportCaseId=${encodeURIComponent(query.reportCaseId)}`,
    );
    const detail = entry.existingAppeal
      ? await fetcher<ReportAppealDetailDto>(
          `/api/report-appeals/detail?appealId=${encodeURIComponent(entry.existingAppeal.appealId)}`,
        )
      : null;

    return { history, entry, detail };
  }

  return { history, entry: null, detail: null };
}

export async function submitReportAppealAndRefreshPageData(
  input: SubmitReportAppealPayload,
  fetcher: <T>(url: string, init?: RequestInit) => Promise<T> = fetchJson,
): Promise<{
  submitResult: SubmitReportAppealResult;
  history: ReportAppealListDto;
  entry: ReportAppealEntryDto | null;
  detail: ReportAppealDetailDto | null;
}> {
  const submitResult = await fetcher<SubmitReportAppealResult>('/api/report-appeals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const refreshed = await loadReportAppealsPageData({ reportCaseId: input.reportCaseId }, fetcher);

  return {
    submitResult,
    ...refreshed,
  };
}

export function ReportAppealsPage({
  query = {},
  initialHistory = null,
  initialEntry = null,
  initialDetail = null,
}: ReportAppealsPageProps) {
  const reportCaseId = query.reportCaseId ?? null;
  const appealId = query.appealId ?? null;
  const [history, setHistory] = useState<ReportAppealListDto | null>(initialHistory);
  const [entry, setEntry] = useState<ReportAppealEntryDto | null>(initialEntry);
  const [detail, setDetail] = useState<ReportAppealDetailDto | null>(initialDetail);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyWithdrawnState = (appealId: string) => {
    setDetail((current) =>
      current && current.appealId === appealId
        ? {
            ...current,
            status: 'withdrawn',
            resolutionCode: null,
          }
        : current,
    );
    setEntry((current) =>
      current?.existingAppeal?.appealId === appealId
        ? {
            ...current,
            existingAppeal: {
              ...current.existingAppeal,
              status: 'withdrawn',
              resolutionCode: null,
            },
          }
        : current,
    );
    setHistory((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) =>
              item.appealId === appealId ? { ...item, status: 'withdrawn', resolutionCode: null } : item,
            ),
          }
        : current,
    );
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const loaded = await loadReportAppealsPageData({ reportCaseId, appealId });
        if (!cancelled) {
          setHistory(loaded.history);
          setEntry(loaded.entry);
          setDetail(loaded.detail);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : '加载申诉页面失败');
        }
      }
    };

    if (!initialHistory && !initialEntry && !initialDetail) {
      void load();
    }

    return () => {
      cancelled = true;
    };
  }, [appealId, initialDetail, initialEntry, initialHistory, reportCaseId]);

  const handleWithdraw = async (appealId: string) => {
    setError(null);
    try {
      await fetchJson('/api/report-appeals/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appealId }),
      });
      applyWithdrawnState(appealId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '撤回申诉失败');
    }
  };

  const activeAppealFormEntry = shouldRenderAppealForm({ reportCaseId, entry, detail })
    && isReportAppealFormEntry(entry)
    ? entry
    : null;

  const activeCard = activeAppealFormEntry
    ? (
        <ReportAppealForm
          key={getReportAppealFormIdentity({
            reportCaseId: activeAppealFormEntry.reportCaseId,
            caseUpdatedAtSnapshot: activeAppealFormEntry.caseUpdatedAtSnapshot,
          })}
          reportCaseId={activeAppealFormEntry.reportCaseId}
          caseUpdatedAtSnapshot={activeAppealFormEntry.caseUpdatedAtSnapshot}
          targetCardName={activeAppealFormEntry.targetCard.name}
          reasonOptions={
            activeAppealFormEntry.reasonOptions.length > 0
              ? activeAppealFormEntry.reasonOptions
              : REPORT_APPEAL_REASON_OPTIONS
          }
          submitting={submitting}
          error={error}
          onSubmit={async (input) => {
            setSubmitting(true);
            setError(null);
            try {
              const refreshed = await submitReportAppealAndRefreshPageData(input);
              setHistory(refreshed.history);
              setEntry(refreshed.entry);
              setDetail(refreshed.detail);
            } catch (nextError) {
              setError(nextError instanceof Error ? nextError.message : '提交申诉失败');
            } finally {
              setSubmitting(false);
            }
          }}
        />
      )
    : detail
      ? <ReportAppealHistoryCard appeal={detail} emphasized onWithdraw={handleWithdraw} />
      : entry?.existingAppeal
        ? <ReportAppealHistoryCard appeal={entry.existingAppeal} emphasized onWithdraw={handleWithdraw} />
        : null;

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 pb-8 pt-4">
      <section className="space-y-2">
        <p className="text-xs uppercase tracking-[0.24em] text-rose-600">Report Appeals</p>
        <h1 className="text-2xl font-semibold text-gray-900">处理结果申诉</h1>
        <p className="text-sm text-gray-600">
          这里集中显示你的公开数据卡处理结果申诉记录。来自消息页和公开卡详情的入口都会落到这里。
        </p>
      </section>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      {activeCard}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-900">申诉历史</h2>
          <span className="text-xs text-gray-500">{history?.items.length ?? 0} 条</span>
        </div>

        {history && history.items.length > 0 ? (
          <div className="space-y-3">
            {history.items.map((item) => (
              <ReportAppealHistoryCard
                key={item.appealId}
                appeal={item}
                onWithdraw={handleWithdraw}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-sm text-gray-500">
            暂无申诉记录
          </div>
        )}
      </section>
    </main>
  );
}

export default ReportAppealsPage;
