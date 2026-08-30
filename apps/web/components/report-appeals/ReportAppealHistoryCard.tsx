import type { ReportAppealDetailDto, ReportAppealSummaryDto } from '@/lib/report-appeals/types';

type ReportAppealHistoryCardProps = {
  appeal: ReportAppealSummaryDto | ReportAppealDetailDto;
  emphasized?: boolean;
  onWithdraw?: ((appealId: string) => void) | null;
};

const statusLabelMap: Record<string, string> = {
  submitted: '已提交',
  under_review: '复核中',
  resolved: '已结案',
  withdrawn: '已撤回',
};

const resolutionLabelMap: Record<string, string> = {
  upheld: '维持原判',
  overturned_no_violation: '改判为不违规',
  reopened_under_review: '转人工继续处理',
};

const reportCaseStatusLabelMap: Record<string, string> = {
  open: '待处理',
  under_review: '处理中',
  resolved: '已结案',
  dismissed: '已驳回',
};

const reportCaseResolutionLabelMap: Record<string, string> = {
  confirmed_violation: '确认违规',
  content_removed: '内容已移除',
  self_remediated: '已自行整改',
  no_violation: '不违规',
};

const formatCaseSummary = (input: {
  status: string;
  resolutionCode: string | null;
  updatedAt: string;
  closedAt?: string | null;
}) => {
  const parts = [`状态：${reportCaseStatusLabelMap[input.status] ?? input.status}`];
  if (input.resolutionCode) {
    parts.push(reportCaseResolutionLabelMap[input.resolutionCode] ?? input.resolutionCode);
  }
  parts.push(`更新时间：${input.updatedAt}`);
  if (input.closedAt) {
    parts.push(`结案时间：${input.closedAt}`);
  }
  return parts.join(' · ');
};

export function ReportAppealHistoryCard({ appeal, emphasized = false, onWithdraw = null }: ReportAppealHistoryCardProps) {
  const canWithdraw = appeal.status === 'submitted' || appeal.status === 'under_review';
  const hasDetailFields = 'details' in appeal;

  return (
    <article
      className={`rounded-xl border px-4 py-4 ${
        emphasized ? 'border-rose-300 bg-rose-50/60' : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{appeal.targetCardName}</h3>
          <p className="mt-1 text-xs text-gray-500">
            申诉状态：{statusLabelMap[appeal.status] ?? appeal.status}
            {appeal.resolutionCode ? ` · ${resolutionLabelMap[appeal.resolutionCode] ?? appeal.resolutionCode}` : ''}
          </p>
        </div>
        {canWithdraw && onWithdraw ? (
          <button
            type="button"
            onClick={() => onWithdraw(appeal.appealId)}
            className="rounded-lg border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50"
          >
            撤回申诉
          </button>
        ) : null}
      </div>

      <dl className="mt-3 grid gap-2 text-xs text-gray-600">
        <div>
          <dt className="inline text-gray-500">申诉编号：</dt>
          <dd className="inline">{appeal.appealId}</dd>
        </div>
        <div>
          <dt className="inline text-gray-500">提交时间：</dt>
          <dd className="inline">{appeal.createdAt}</dd>
        </div>
        {appeal.resolutionNote ? (
          <div>
            <dt className="block text-gray-500">复核说明</dt>
            <dd className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{appeal.resolutionNote}</dd>
          </div>
        ) : null}
        {hasDetailFields ? (
          <>
            <div>
              <dt className="block text-gray-500">申诉说明</dt>
              <dd className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{appeal.details}</dd>
            </div>
            <div>
              <dt className="block text-gray-500">提交证据</dt>
              <dd className="mt-1">
                {appeal.references.length > 0 ? (
                  <ul className="space-y-2 text-sm text-gray-700">
                    {appeal.references.map((reference) => (
                      <li
                        key={`${reference.referenceType}:${reference.referenceId}:${reference.sortOrder}`}
                        className="rounded-lg bg-gray-50 px-3 py-2"
                      >
                        {reference.urlSnapshot ? (
                          <a
                            href={reference.urlSnapshot}
                            className="font-medium text-rose-700 underline underline-offset-2"
                          >
                            {reference.labelSnapshot}
                          </a>
                        ) : (
                          <span className="font-medium text-gray-800">{reference.labelSnapshot}</span>
                        )}
                        {reference.note ? <p className="mt-1 text-gray-600">备注：{reference.note}</p> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-sm text-gray-500">未提交引用证据</div>
                )}
              </dd>
            </div>
            <div>
              <dt className="block text-gray-500">案件快照</dt>
              <dd className="mt-1 text-sm text-gray-700">{formatCaseSummary(appeal.caseSnapshot)}</dd>
            </div>
            <div>
              <dt className="block text-gray-500">当前案件</dt>
              <dd className="mt-1 text-sm text-gray-700">{formatCaseSummary(appeal.currentCase)}</dd>
            </div>
          </>
        ) : null}
      </dl>
    </article>
  );
}

export default ReportAppealHistoryCard;
