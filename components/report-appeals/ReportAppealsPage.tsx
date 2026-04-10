import { useEffect, useState } from 'react';

import { authStorage } from '@/lib/auth';
import { REPORT_APPEAL_REASON_OPTIONS, type ReportAppealDetailDto, type ReportAppealEntryDto, type ReportAppealListDto, type SubmitReportAppealResult } from '@/lib/report-appeals/types';
import ReportAppealForm from '@/components/report-appeals/ReportAppealForm';
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

const fetchJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await authStorage.fetch(url, init);
  const payload = (await response.json()) as T;
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
};

export function ReportAppealsPage({
  query = {},
  initialHistory = null,
  initialEntry = null,
  initialDetail = null,
}: ReportAppealsPageProps) {
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
        const nextHistory = await fetchJson<ReportAppealListDto>('/api/report-appeals');
        if (!cancelled) {
          setHistory(nextHistory);
        }

        if (query.appealId) {
          const nextDetail = await fetchJson<ReportAppealDetailDto>(
            `/api/report-appeals/detail?appealId=${encodeURIComponent(query.appealId)}`,
          );
          if (!cancelled) {
            setDetail(nextDetail);
          }
          return;
        }

        if (query.reportCaseId) {
          const nextEntry = await fetchJson<ReportAppealEntryDto>(
            `/api/report-appeals/entry?reportCaseId=${encodeURIComponent(query.reportCaseId)}`,
          );
          if (!cancelled) {
            setEntry(nextEntry);
            setDetail(nextEntry.existingAppeal ? ({
              ...nextEntry.existingAppeal,
              details: '',
              references: [],
              caseSnapshot: {
                status: nextEntry.caseStatus ?? 'resolved',
                resolutionCode: nextEntry.caseResolutionCode,
                updatedAt: nextEntry.caseUpdatedAtSnapshot ?? '',
              },
              currentCase: {
                status: nextEntry.caseStatus ?? 'resolved',
                resolutionCode: nextEntry.caseResolutionCode,
                closedAt: null,
                updatedAt: nextEntry.caseUpdatedAtSnapshot ?? '',
              },
            } as ReportAppealDetailDto) : null);
          }
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
  }, [initialDetail, initialEntry, initialHistory, query.appealId, query.reportCaseId]);

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

  const activeCard = detail
    ? <ReportAppealHistoryCard appeal={detail} emphasized onWithdraw={handleWithdraw} />
    : entry?.existingAppeal
      ? <ReportAppealHistoryCard appeal={entry.existingAppeal} emphasized onWithdraw={handleWithdraw} />
      : entry?.eligible && entry.targetCard && entry.caseUpdatedAtSnapshot
        ? (
            <ReportAppealForm
              reportCaseId={entry.reportCaseId}
              caseUpdatedAtSnapshot={entry.caseUpdatedAtSnapshot}
              targetCardName={entry.targetCard.name}
              reasonOptions={entry.reasonOptions.length > 0 ? entry.reasonOptions : REPORT_APPEAL_REASON_OPTIONS}
              submitting={submitting}
              error={error}
              onSubmit={async (input) => {
                setSubmitting(true);
                setError(null);
                try {
                  const result = await fetchJson<SubmitReportAppealResult>('/api/report-appeals', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(input),
                  });
                  const nextDetail = await fetchJson<ReportAppealDetailDto>(
                    `/api/report-appeals/detail?appealId=${encodeURIComponent(result.appealId)}`,
                  );
                  setDetail(nextDetail);
                } catch (nextError) {
                  setError(nextError instanceof Error ? nextError.message : '提交申诉失败');
                } finally {
                  setSubmitting(false);
                }
              }}
            />
          )
        : null;

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
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
