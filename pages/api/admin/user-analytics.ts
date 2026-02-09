import {
  getAdminUserAnalyticsFrequency,
  getAdminUserAnalyticsComposition,
  getAdminUserAnalyticsOverview,
  getAdminUserAnalyticsRetention,
  type AdminCohortGranularity,
  type AdminFrequencySample,
  type AdminUserAnalyticsSection,
} from '@/lib/database/admin-user-analytics';
import { withEdgeCache } from '@/lib/edge-cache';
import type { NextRequest } from 'next/server';

export const runtime = 'edge';

const parseLookbackDays = (value: string | null): number => {
  const parsed = Number.parseInt((value || '').trim(), 10);
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(7, Math.min(365, parsed));
};

const parseSection = (value: string | null): AdminUserAnalyticsSection => {
  if (value === 'overview') return 'overview';
  if (value === 'frequency') return 'frequency';
  if (value === 'retention') return 'retention';
  if (value === 'composition') return 'composition';
  return 'all';
};

const parseSample = (value: string | null): AdminFrequencySample => {
  if (value === 'all') return 'all';
  if (value === 'tracked') return 'tracked';
  return 'active7d';
};

const parseActiveWindowDays = (value: string | null): number => {
  const parsed = Number.parseInt((value || '').trim(), 10);
  if (!Number.isFinite(parsed)) return 7;
  return Math.max(1, Math.min(180, parsed));
};

const parseCohort = (value: string | null): AdminCohortGranularity => {
  if (value === 'month') return 'month';
  return 'week';
};

export default async function handler(req: NextRequest) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
  }

  const url = new URL(req.url);
  const section = parseSection(url.searchParams.get('section'));
  const lookbackDays = parseLookbackDays(url.searchParams.get('lookbackDays'));
  const frequencySample = parseSample(url.searchParams.get('frequencySample'));
  const activeWindowDays = parseActiveWindowDays(url.searchParams.get('activeWindowDays'));
  const cohort = parseCohort(url.searchParams.get('cohort'));
  const frequencyProfile = 'v20260209';

  const ttlSeconds = section === 'overview' ? 60 : 120;
  const cacheKey = `https://admin-user-analytics.internal/${section}?lookbackDays=${lookbackDays}&frequencySample=${frequencySample}&activeWindowDays=${activeWindowDays}&cohort=${cohort}&frequencyProfile=${frequencyProfile}`;

  return withEdgeCache(
    req,
    { key: cacheKey, ttlSeconds },
    async () => {
      try {
        const generatedAt = new Date().toISOString();

        if (section === 'overview') {
          const overview = await getAdminUserAnalyticsOverview(lookbackDays);
          return new Response(
            JSON.stringify({
              success: true,
              section,
              stats: overview,
              meta: { generatedAt, lookbackDays },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        if (section === 'frequency') {
          const frequency = await getAdminUserAnalyticsFrequency({
            sample: frequencySample,
            profile: frequencyProfile,
            lookbackDays,
          });
          return new Response(
            JSON.stringify({
              success: true,
              section,
              stats: frequency,
              meta: { generatedAt, lookbackDays, frequencySample, frequencyProfile },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        if (section === 'retention') {
          const retention = await getAdminUserAnalyticsRetention({ cohort, lookbackDays });
          return new Response(
            JSON.stringify({
              success: true,
              section,
              stats: retention,
              meta: { generatedAt, cohort, lookbackDays },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        if (section === 'composition') {
          const composition = await getAdminUserAnalyticsComposition({
            activeWindowDays,
            cohort,
            lookbackDays,
          });
          return new Response(
            JSON.stringify({
              success: true,
              section,
              stats: composition,
              meta: { generatedAt, activeWindowDays, cohort, lookbackDays },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        const [overview, frequency, retention, composition] = await Promise.all([
          getAdminUserAnalyticsOverview(lookbackDays),
          getAdminUserAnalyticsFrequency({
            sample: frequencySample,
            profile: frequencyProfile,
            lookbackDays,
          }),
          getAdminUserAnalyticsRetention({ cohort, lookbackDays }),
          getAdminUserAnalyticsComposition({
            activeWindowDays,
            cohort,
            lookbackDays,
          }),
        ]);

        return new Response(
          JSON.stringify({
            success: true,
            section,
            stats: { overview, frequency, retention, composition },
            meta: { generatedAt, lookbackDays, frequencySample, activeWindowDays, cohort, frequencyProfile },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      } catch (error) {
        console.error('[Admin API] 获取用户分析数据失败:', error);
        return new Response(
          JSON.stringify({ success: false, error: '获取用户分析数据失败' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        );
      }
    },
  );
}
