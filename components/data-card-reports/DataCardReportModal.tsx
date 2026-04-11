import React, { useEffect, useState } from 'react';

import { normalizePublicDataCardReferenceId } from '@/lib/data-card-reports/public-reference-id';
import type {
  DataCardReportDraft,
  DataCardReportReasonOption,
  DataCardReportReferenceType,
  NormalizedReportReference,
} from '@/lib/data-card-reports/types';

export type DataCardReportModalProps = {
  isOpen: boolean;
  cardName: string;
  reasons: DataCardReportReasonOption[];
  initialReport: DataCardReportDraft | null;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (draft: DataCardReportDraft) => void;
};

const serializeReferences = (
  references: NormalizedReportReference[],
  referenceType: DataCardReportReferenceType,
): string =>
  references
    .filter((reference) => reference.referenceType === referenceType)
    .map((reference) => reference.referenceId)
    .join('\n');

const buildReferenceNoteKey = (
  referenceType: DataCardReportReferenceType,
  referenceId: string,
): string => `${referenceType}:${referenceId}`;

const buildExistingReferenceNoteMap = (references: NormalizedReportReference[]): Map<string, string | null> =>
  new Map(
    references.map((reference) => [
      buildReferenceNoteKey(reference.referenceType, reference.referenceId),
      reference.note ?? null,
    ]),
  );

const parseReferenceIds = (
  value: string,
  referenceType: DataCardReportReferenceType,
  startOrder: number,
  existingNoteByReference: Map<string, string | null>,
): NormalizedReportReference[] =>
  Array.from(
    new Set(
      value
        .split('\n')
        .map((item) =>
          referenceType === 'public_data_card' ? normalizePublicDataCardReferenceId(item) : item.trim(),
        )
        .filter(Boolean),
    ),
  ).map((referenceId, index) => ({
    referenceType,
    referenceId,
    note: existingNoteByReference.get(buildReferenceNoteKey(referenceType, referenceId)) ?? null,
    sortOrder: startOrder + index,
  }));

export const buildReportReferencesFromModalFields = (input: {
  initialReferences: NormalizedReportReference[];
  publicDataCardRefs: string;
  encyclopediaRefs: string;
}): NormalizedReportReference[] => {
  const existingNoteByReference = buildExistingReferenceNoteMap(input.initialReferences);
  const publicRefs = parseReferenceIds(input.publicDataCardRefs, 'public_data_card', 0, existingNoteByReference);
  const encyclopediaRefs = parseReferenceIds(
    input.encyclopediaRefs,
    'encyclopedia_entry',
    publicRefs.length,
    existingNoteByReference,
  );
  return [...publicRefs, ...encyclopediaRefs];
};

export function DataCardReportModal({
  isOpen,
  cardName,
  reasons,
  initialReport,
  submitting,
  error,
  onClose,
  onSubmit,
}: DataCardReportModalProps) {
  const [reasonCode, setReasonCode] = useState(reasons[0]?.code ?? 'plagiarism');
  const [details, setDetails] = useState('');
  const [publicDataCardRefs, setPublicDataCardRefs] = useState('');
  const [encyclopediaRefs, setEncyclopediaRefs] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setReasonCode(initialReport?.reasonCode ?? reasons[0]?.code ?? 'plagiarism');
    setDetails(initialReport?.details ?? '');
    setPublicDataCardRefs(serializeReferences(initialReport?.references ?? [], 'public_data_card'));
    setEncyclopediaRefs(serializeReferences(initialReport?.references ?? [], 'encyclopedia_entry'));
  }, [initialReport, isOpen, reasons]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-gray-200 px-6 py-4">
          <div className="text-lg font-semibold text-gray-900">
            {initialReport ? '编辑我的举报' : '举报数据卡'}
          </div>
          <div className="mt-1 text-sm text-gray-500">目标：{cardName}</div>
        </div>

        <div className="space-y-5 px-6 py-5">
          <section className="space-y-3">
            <div className="text-sm font-medium text-gray-800">举报理由</div>
            <div className="space-y-2">
              {reasons.map((reason) => (
                <label
                  key={reason.code}
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 px-4 py-3 hover:border-pink-300"
                >
                  <input
                    type="radio"
                    name="data-card-report-reason"
                    checked={reasonCode === reason.code}
                    onChange={() => setReasonCode(reason.code)}
                    className="mt-1"
                  />
                  <span className="space-y-1">
                    <span className="block text-sm font-medium text-gray-900">{reason.label}</span>
                    <span className="block text-xs text-gray-500">{reason.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <label className="block text-sm font-medium text-gray-800" htmlFor="data-card-report-details">
              补充说明
            </label>
            <textarea
              id="data-card-report-details"
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              rows={4}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-pink-400"
              placeholder="可补充说明问题位置、影响或上下文。"
            />
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-800" htmlFor="data-card-report-public-refs">
                引用公开数据卡
              </label>
              <textarea
                id="data-card-report-public-refs"
                value={publicDataCardRefs}
                onChange={(event) => setPublicDataCardRefs(event.target.value)}
                rows={4}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-pink-400"
                placeholder="每行一个公开卡 ID 或链接"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-800" htmlFor="data-card-report-encyclopedia-refs">
                引用百科条目
              </label>
              <textarea
                id="data-card-report-encyclopedia-refs"
                value={encyclopediaRefs}
                onChange={(event) => setEncyclopediaRefs(event.target.value)}
                rows={4}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-pink-400"
                placeholder="每行一个百科 slug"
              />
            </div>
          </section>

          {error ? <div className="text-sm text-red-600">{error}</div> : null}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            disabled={submitting}
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => {
              onSubmit({
                reasonCode,
                details: details.trim() ? details.trim() : null,
                references: buildReportReferencesFromModalFields({
                  initialReferences: initialReport?.references ?? [],
                  publicDataCardRefs,
                  encyclopediaRefs,
                }),
              });
            }}
            className="rounded-xl bg-pink-600 px-4 py-2 text-sm font-medium text-white hover:bg-pink-700 disabled:bg-pink-300"
            disabled={submitting}
          >
            {submitting ? '提交中...' : initialReport ? '更新举报' : '提交举报'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default DataCardReportModal;
