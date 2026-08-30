import { useState } from 'react';

import { REPORT_APPEAL_REASON_OPTIONS, type ReportAppealReasonOption, type ReportAppealReferenceDraft } from '@/lib/report-appeals/types';

type ReportAppealFormProps = {
  reportCaseId: string;
  caseUpdatedAtSnapshot: string;
  targetCardName: string;
  reasonOptions?: ReportAppealReasonOption[];
  submitting?: boolean;
  error?: string | null;
  onSubmit?: ((input: {
    reportCaseId: string;
    caseUpdatedAtSnapshot: string;
    appealReasonCode: string;
    details: string;
    references: ReportAppealReferenceDraft[];
  }) => void | Promise<void>) | null;
};

export const getReportAppealFormIdentity = (input: {
  reportCaseId: string;
  caseUpdatedAtSnapshot: string;
}) => `${input.reportCaseId}:${input.caseUpdatedAtSnapshot}`;

export function ReportAppealForm({
  reportCaseId,
  caseUpdatedAtSnapshot,
  targetCardName,
  reasonOptions = REPORT_APPEAL_REASON_OPTIONS,
  submitting = false,
  error = null,
  onSubmit = null,
}: ReportAppealFormProps) {
  const [appealReasonCode, setAppealReasonCode] = useState(reasonOptions[0]?.code ?? 'other');
  const [details, setDetails] = useState('');
  const [references, setReferences] = useState<ReportAppealReferenceDraft[]>([]);

  const updateReference = (index: number, next: Partial<ReportAppealReferenceDraft>) => {
    setReferences((current) =>
      current.map((reference, currentIndex) => (currentIndex === index ? { ...reference, ...next } : reference)),
    );
  };

  return (
    <form
      className="rounded-2xl border border-gray-200 bg-white p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit?.({
          reportCaseId,
          caseUpdatedAtSnapshot,
          appealReasonCode,
          details,
          references: references.filter((reference) => reference.referenceId?.trim()),
        });
      }}
    >
      <div className="space-y-2">
        <h2 className="text-base font-semibold text-gray-900">提交申诉</h2>
        <p className="text-sm text-gray-600">你正在对「{targetCardName}」的处理结果提交申诉。</p>
      </div>

      <fieldset className="mt-4 space-y-2">
        <legend className="text-sm font-medium text-gray-800">申诉理由</legend>
        {reasonOptions.map((option) => (
          <label key={option.code} className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 px-3 py-3">
            <input
              type="radio"
              name="appealReasonCode"
              value={option.code}
              checked={appealReasonCode === option.code}
              onChange={() => setAppealReasonCode(option.code)}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium text-gray-900">{option.label}</span>
              <span className="block text-xs text-gray-500">{option.description}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <label className="mt-4 block">
        <span className="text-sm font-medium text-gray-800">补充说明</span>
        <textarea
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          rows={5}
          className="mt-2 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-800"
          placeholder="请说明你认为当前处理结果存在的问题或遗漏的上下文。"
        />
      </label>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-gray-800">补充引用</h3>
          <button
            type="button"
            onClick={() =>
              setReferences((current) => [
                ...current,
                { referenceType: 'public_data_card', referenceId: '', note: '' },
              ])
            }
            className="rounded-lg border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50"
          >
            添加引用
          </button>
        </div>
        <div className="mt-2 space-y-3">
          {references.map((reference, index) => (
            <div key={`reference-${index}`} className="rounded-xl border border-gray-200 p-3">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-xs text-gray-600">
                  引用类型
                  <select
                    value={reference.referenceType}
                    onChange={(event) =>
                      updateReference(index, {
                        referenceType: event.target.value as ReportAppealReferenceDraft['referenceType'],
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-2 text-sm text-gray-800"
                  >
                    <option value="public_data_card">公开数据卡</option>
                    <option value="encyclopedia_entry">百科条目</option>
                  </select>
                </label>
                <label className="text-xs text-gray-600">
                  引用 ID
                  <input
                    value={reference.referenceId}
                    onChange={(event) => updateReference(index, { referenceId: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-2 text-sm text-gray-800"
                  />
                </label>
              </div>
              <label className="mt-3 block text-xs text-gray-600">
                备注
                <textarea
                  value={reference.note ?? ''}
                  onChange={(event) => updateReference(index, { note: event.target.value })}
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-2 text-sm text-gray-800"
                />
              </label>
            </div>
          ))}
          {references.length === 0 ? (
            <p className="text-xs text-gray-500">当前没有补充引用，可直接提交文字申诉。</p>
          ) : null}
        </div>
      </div>

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      <div className="mt-5 flex justify-end">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:bg-rose-300"
        >
          {submitting ? '提交中...' : '提交申诉'}
        </button>
      </div>
    </form>
  );
}

export default ReportAppealForm;
