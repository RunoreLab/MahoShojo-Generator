import { useEffect, useState } from 'react';

import { authStorage } from '@/lib/auth';
import type {
  CrowdReviewCurrentCaseDto,
  SubmitCrowdReviewDecisionResult,
} from '@/lib/crowd-review/types';

type CrowdReviewCurrentCaseCardProps = {
  currentCase: CrowdReviewCurrentCaseDto;
  onCaseUpdated?: (next: CrowdReviewCurrentCaseDto) => void;
};

const DECISION_LABELS: Record<'violation' | 'no_violation' | 'abstain', string> = {
  violation: '支持违规',
  no_violation: '支持不违规',
  abstain: '弃权',
};

export function CrowdReviewCurrentCaseCard({
  currentCase,
  onCaseUpdated,
}: CrowdReviewCurrentCaseCardProps) {
  const [caseState, setCaseState] = useState(currentCase);
  const [submittingDecision, setSubmittingDecision] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCaseState(currentCase);
    setError(null);
    setSubmittingDecision(null);
  }, [currentCase]);

  const handleSubmitDecision = async (decision: 'violation' | 'no_violation' | 'abstain') => {
    setSubmittingDecision(decision);
    setError(null);

    try {
      const response = await authStorage.fetch('/api/crowd-review/current/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          assignmentId: caseState.assignmentId,
          decision,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | SubmitCrowdReviewDecisionResult
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(
          payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
            ? payload.error
            : '提交处理结论失败',
        );
      }

      if (!payload || !('assignmentStatus' in payload) || !('postVoteSummary' in payload)) {
        throw new Error('提交处理结论失败');
      }

      const nextCase: CrowdReviewCurrentCaseDto = {
        ...caseState,
        assignmentStatus: payload.assignmentStatus,
        postVoteSummary: payload.postVoteSummary,
      };
      setCaseState(nextCase);
      onCaseUpdated?.(nextCase);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '提交处理结论失败');
    } finally {
      setSubmittingDecision(null);
    }
  };

  const showDecisionButtons = caseState.postVoteSummary == null;

  return (
    <article className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-xl backdrop-blur dark:border-slate-700/70 dark:bg-slate-950/80">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-600 dark:text-amber-200">
            Current Case
          </p>
          <h2 className="mt-2 text-2xl font-bold text-gray-900 dark:text-slate-50">
            当前案件：{caseState.targetSnapshot?.name ?? '匿名公开数据卡'}
          </h2>
          <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-slate-300">
            该页面仅展示匿名化摘要。投票前不会展示票况，也不会展示其他调查员的选择。
          </p>
        </div>

        <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-100">
          <div>派单时间：{new Date(caseState.assignedAt).toLocaleString('zh-CN', { hour12: false })}</div>
          <div className="mt-1">截止时间：{new Date(caseState.expiresAt).toLocaleString('zh-CN', { hour12: false })}</div>
        </div>
      </div>

      {caseState.targetSnapshot?.description ? (
        <section className="mt-5 rounded-3xl bg-gray-50 px-5 py-4 text-sm leading-6 text-gray-700 dark:bg-slate-900/80 dark:text-slate-200">
          {caseState.targetSnapshot.description}
        </section>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <section className="rounded-3xl border border-white/70 bg-white/70 p-4 dark:border-slate-700 dark:bg-slate-900/70">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">举报理由</h3>
          <ul className="mt-3 space-y-2 text-sm text-gray-600 dark:text-slate-300">
            {caseState.reportSummary.reasonLabels.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="rounded-3xl border border-white/70 bg-white/70 p-4 dark:border-slate-700 dark:bg-slate-900/70">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">说明摘要</h3>
          <ul className="mt-3 space-y-2 text-sm text-gray-600 dark:text-slate-300">
            {caseState.reportSummary.details.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="rounded-3xl border border-white/70 bg-white/70 p-4 dark:border-slate-700 dark:bg-slate-900/70">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">参考材料</h3>
          <ul className="mt-3 space-y-2 text-sm text-gray-600 dark:text-slate-300">
            {caseState.reportSummary.references.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>

      <section className="mt-5 rounded-3xl border border-dashed border-amber-200 bg-amber-50/80 px-5 py-4 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100">
        <h3 className="font-semibold">处理提醒</h3>
        <ul className="mt-3 space-y-2">
          {caseState.ruleHints.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      {error ? (
        <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-400/30 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      {showDecisionButtons ? (
        <div className="mt-5 flex flex-wrap gap-3">
          {caseState.availableDecisions.map((decision) => (
            <button
              key={decision}
              type="button"
              onClick={() => void handleSubmitDecision(decision)}
              disabled={submittingDecision !== null}
              className="inline-flex rounded-full bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-gray-700 disabled:cursor-wait disabled:opacity-60 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
            >
              {submittingDecision === decision ? '提交中…' : DECISION_LABELS[decision]}
            </button>
          ))}
        </div>
      ) : null}

      {caseState.postVoteSummary ? (
        <section className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm leading-6 text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-100">
          <h3 className="font-semibold">本次提交已记录</h3>
          <p className="mt-2">{caseState.postVoteSummary.summaryText}</p>
        </section>
      ) : null}
    </article>
  );
}
