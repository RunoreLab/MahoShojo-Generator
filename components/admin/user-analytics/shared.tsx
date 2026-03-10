import React from 'react';

import type { CohortGranularity } from '@/lib/admin/user-analytics-display';

export type OverviewStats = {
  totalUsers: number;
  trackedUsers: number;
  untrackedUsers: number;
  activeUsers24h: number;
  activeUsers7d: number;
  activeUsers30d: number;
  activityCoverageRate: number;
  activityTrackingOk: boolean;
  lookbackDays: number;
  generationTotal: number;
  generationCompleted: number;
  generationAborted: number;
  generationFailed: number;
  generationAbortFailRate: number;
  generationDistinctUsers: number;
  generationOrphanUserEvents: number;
  generationPerTrackedUser: number;
};

export type FrequencyBucket = {
  key: string;
  label: string;
  count: number;
  share: number;
};

export type FrequencyStats = {
  sample: 'active7d' | 'tracked' | 'all';
  profile: 'v20260209';
  lookbackDays: number;
  sampleUsers: number;
  avgTotalCount: number;
  avgSuccessRate: number;
  highPlusUsers: number;
  veryHighPlusUsers: number;
  extremeUsers: number;
  highPlusShare: number;
  veryHighPlusShare: number;
  extremeShare: number;
  buckets: FrequencyBucket[];
  activityTrackingOk: boolean;
};

export type RetentionPoint = {
  key: 'd1' | 'd7' | 'd30' | 'd90';
  label: string;
  days: number;
  eligible: number;
  retained: number;
  rate: number;
};

export type RetentionStats = {
  totalUsers: number;
  avgObservedRetentionDays: number;
  medianObservedRetentionDays: number;
  p90ObservedRetentionDays: number;
  cohortGranularity: 'week' | 'month';
  cohortLookbackDays: number;
  cohorts: Array<{
    cohortKey: string;
    cohortSize: number;
    d7Eligible: number;
    d7Retained: number;
    d7Rate: number;
    d30Eligible: number;
    d30Retained: number;
    d30Rate: number;
  }>;
  points: RetentionPoint[];
  activityTrackingOk: boolean;
};

export type CompositionBucket = {
  key: string;
  label: string;
  count: number;
  share: number;
};

export type CompositionStats = {
  activeWindowDays: number;
  cohortGranularity: 'week' | 'month';
  cohortLookbackDays: number;
  sampleUsers: number;
  newUsers: number;
  oldUsers: number;
  newUsersShare: number;
  avgTenureDays: number;
  medianTenureDays: number;
  p90TenureDays: number;
  buckets: CompositionBucket[];
  cohorts: Array<{
    cohortKey: string;
    sampleUsers: number;
    newUsers: number;
    newUsersShare: number;
    avgTenureDays: number;
  }>;
  activityTrackingOk: boolean;
};

export type TrendPoint = {
  date: string;
  newUsers: number;
  newUsers7dAvg: number;
  totalUsers: number;
  generationTotal: number;
  generationCompleted: number;
  generationAborted: number;
  generationFailed: number;
  generationDistinctUsers: number;
  authSuccess: number;
  authFailure: number;
};

export type ActivityTrendPoint = {
  date: string;
  totalUsers: number;
  trackedUsers: number;
  untrackedUsers: number;
  activeUsers24h: number;
  activeUsers7d: number;
  activeUsers30d: number;
  activityCoverageRate: number;
};

export type FrequencyTrendPoint = {
  date: string;
  sample: 'active7d' | 'tracked' | 'all';
  sampleUsers: number;
  highPlusUsers: number;
  veryHighPlusUsers: number;
  extremeUsers: number;
  highPlusShare: number;
  veryHighPlusShare: number;
  extremeShare: number;
};

export type TrendStats = {
  lookbackDays: number;
  authAvailableFrom: string | null;
  activityAvailableFrom: string | null;
  frequencyAvailableFrom: string | null;
  frequencyTrendLookbackDays: number;
  frequencyTrendProfile: 'v20260209';
  points: TrendPoint[];
  activityPoints: ActivityTrendPoint[];
  frequencyPoints: FrequencyTrendPoint[];
};

export type ApiResponse = {
  success: boolean;
  section: 'all';
  stats: {
    overview: OverviewStats;
    frequency: FrequencyStats;
    retention: RetentionStats;
    composition: CompositionStats;
    trends: TrendStats;
  };
  meta: {
    generatedAt: string;
    lookbackDays: number;
    frequencySample: 'active7d' | 'tracked' | 'all';
    activeWindowDays: number;
    cohort: 'week' | 'month';
    frequencyProfile: 'v20260209';
  };
  error?: string;
};

export type FrequencySample = 'active7d' | 'tracked' | 'all';
export type CsvCell = string | number | boolean | null | undefined;

export const formatPercent = (value: number): string => `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`;
export const formatNumber = (value: number): string => (Number.isFinite(value) ? Math.round(value).toLocaleString('zh-CN') : '0');

export const normalizeIsoTimestamp = (value?: string | null): string => {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
};

export function StatCard(props: { title: string; value: string; note?: string; icon: React.ElementType; color: string }) {
  const { title, value, note, icon: Icon, color } = props;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-full ${color}`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <p className="text-sm font-medium text-slate-600">{title}</p>
      </div>
      <p className="text-3xl font-semibold text-slate-900">{value}</p>
      {note ? <p className="mt-2 text-xs leading-5 text-slate-500">{note}</p> : null}
    </div>
  );
}

export type UserAnalyticsHeaderProps = {
  lookbackDays: number;
  setLookbackDays: (value: number) => void;
  activeWindowDays: number;
  setActiveWindowDays: (value: number) => void;
  frequencySample: FrequencySample;
  setFrequencySample: (value: FrequencySample) => void;
  cohort: CohortGranularity;
  setCohort: (value: CohortGranularity) => void;
  generatedAt?: string;
  snapshotRunning: boolean;
  refreshing: boolean;
  snapshotMessage: string | null;
  onRunDailySnapshot: () => Promise<void>;
  onBackfillDailySnapshot: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onExportOverviewSnapshotCsv: () => void;
  onExportOverviewTrendCsv: () => void;
  onExportActivityTrendCsv: () => void;
  onExportFrequencyCsv: () => void;
  onExportFrequencyTrendCsv: () => void;
  onExportRetentionCsv: () => void;
  onExportCompositionCsv: () => void;
  onExportZipBundle: () => void;
  canExportOverview: boolean;
  canExportTrends: boolean;
  canExportActivityTrends: boolean;
  canExportFrequency: boolean;
  canExportFrequencyTrends: boolean;
  canExportRetention: boolean;
  canExportComposition: boolean;
  canExportBundle: boolean;
};
