export type DataCardReportReasonCode =
  | 'plagiarism'
  | 'harassment_or_hate'
  | 'sexual_or_excessive_gore'
  | 'illegal_or_dangerous'
  | 'spam_or_malicious_noise'
  | 'rule_violation_other';

export type DataCardReportReferenceType = 'public_data_card' | 'encyclopedia_entry';

export type DataCardReportSubmissionDecision =
  | 'created'
  | 'updated'
  | 'noop_duplicate_payload'
  | 'rejected_rate_limited'
  | 'rejected_screened';

export type DataCardReportReasonOption = {
  code: DataCardReportReasonCode;
  label: string;
  description: string;
};

export type DataCardReportReferenceDraft = {
  referenceType: DataCardReportReferenceType;
  referenceId: string;
  note?: string | null;
};

export type NormalizedReportReference = {
  referenceType: DataCardReportReferenceType;
  referenceId: string;
  note: string | null;
  sortOrder: number;
};

export type DataCardReportDraft = {
  reasonCode: DataCardReportReasonCode;
  details: string | null;
  references: NormalizedReportReference[];
};

export type DataCardReportCapabilityDto = {
  canReport: boolean;
  reportDisabledReason: string | null;
  hasOpenCase: boolean;
  myActiveReport: DataCardReportDraft | null;
  reasons: DataCardReportReasonOption[];
  caseSummary: {
    caseId: string;
    reportCount: number;
    reasonLabels: string[];
    referenceSummary: string[];
  } | null;
};
