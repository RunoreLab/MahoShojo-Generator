import type { UserBadge } from '@/types/badge';
import {
  betaAccessConfig,
  type BetaAccessFeatureConfig,
  type BetaAccessFeatureId,
  type BetaAccessRequirement,
} from '@/config/beta-access';

export type BetaAccessStats = {
  publicCards: number;
  publicUsageTotal: number;
  publicFavoriteTotal: number;
};

export type BetaAccessEvaluation = {
  feature: BetaAccessFeatureConfig | null;
  allowed: boolean;
  allOfSatisfied: boolean;
  anyOfSatisfied: boolean;
  missingAllOf: BetaAccessRequirement[];
  missingAnyOf: BetaAccessRequirement[];
};

export const getBetaAccessFeature = (featureId?: string | null): BetaAccessFeatureConfig | null => {
  if (!featureId) return null;
  const key = featureId as BetaAccessFeatureId;
  return betaAccessConfig.features[key] ?? null;
};

export const buildBetaAccessUrl = (featureId: BetaAccessFeatureId): string => {
  return `/beta-access?feature=${featureId}`;
};

const hasBadge = (badges: UserBadge[] | null | undefined, requirement: BetaAccessRequirement): boolean => {
  if (requirement.type !== 'badge') return false;
  if (!badges || badges.length === 0) return false;
  const nameSet = new Set(requirement.badgeNames.map((name) => name.trim()).filter(Boolean));
  const idSet = new Set((requirement.badgeIds ?? []).map((id) => id.trim()).filter(Boolean));
  return badges.some((badge) => {
    const badgeName = badge.badge?.name?.trim();
    const badgeId = badge.badge?.id?.trim() || badge.badgeId?.trim();
    return (badgeName && nameSet.has(badgeName)) || (badgeId && idSet.has(badgeId));
  });
};

export const matchBetaAccessRequirement = (
  requirement: BetaAccessRequirement,
  stats: BetaAccessStats | null,
  badges: UserBadge[] | null | undefined
): boolean => {
  switch (requirement.type) {
    case 'badge':
      return hasBadge(badges, requirement);
    case 'publicUsage':
      return Boolean(stats && stats.publicUsageTotal >= requirement.min);
    case 'publicFavorites':
      return Boolean(stats && stats.publicFavoriteTotal >= requirement.min);
    case 'publicCards':
      return Boolean(stats && stats.publicCards >= requirement.min);
    default:
      return false;
  }
};

export const evaluateBetaAccess = (
  featureId: BetaAccessFeatureId | string | null | undefined,
  badges: UserBadge[] | null | undefined,
  stats: BetaAccessStats | null
): BetaAccessEvaluation => {
  const feature = getBetaAccessFeature(featureId ?? null);
  if (!feature) {
    return {
      feature: null,
      allowed: true,
      allOfSatisfied: true,
      anyOfSatisfied: true,
      missingAllOf: [],
      missingAnyOf: [],
    };
  }

  const allOf = feature.requirements.allOf ?? [];
  const anyOf = feature.requirements.anyOf ?? [];

  const allOfSatisfied = allOf.every((req) => matchBetaAccessRequirement(req, stats, badges));
  const anyOfSatisfied = anyOf.length === 0 ? true : anyOf.some((req) => matchBetaAccessRequirement(req, stats, badges));

  return {
    feature,
    allowed: allOfSatisfied && anyOfSatisfied,
    allOfSatisfied,
    anyOfSatisfied,
    missingAllOf: allOf.filter((req) => !matchBetaAccessRequirement(req, stats, badges)),
    missingAnyOf: anyOf.filter((req) => !matchBetaAccessRequirement(req, stats, badges)),
  };
};
