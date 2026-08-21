// 此文件由 scripts/generate-hono-route-manifest.mjs 自动生成，请勿手工编辑。
import type { LegacyRouteDefinition, LegacyRouteModule } from '@/server/legacy/types';

export const legacyRouteDefinitions: LegacyRouteDefinition[] = [
  {
    id: "me/battle-reports/[generationId]/regenerate",
    pattern: "/api/me/battle-reports/:generationId/regenerate",
    load: () => import("../../app/api/me/battle-reports/[generationId]/regenerate/route") as unknown as Promise<LegacyRouteModule>,
  },
  {
    id: "arena/session/generate-next",
    pattern: "/api/arena/session/generate-next",
    load: () => import("../../app/api/arena/session/generate-next/route") as unknown as Promise<LegacyRouteModule>,
  },
  {
    id: "arena/generate",
    pattern: "/api/arena/generate",
    load: () => import("../../app/api/arena/generate/route") as unknown as Promise<LegacyRouteModule>,
  },
  {
    id: "arena/generate-stream",
    pattern: "/api/arena/generate-stream",
    load: () => import("../../app/api/arena/generate-stream/route") as unknown as Promise<LegacyRouteModule>,
  },
  {
    id: "creator/generate",
    pattern: "/api/creator/generate",
    load: () => import("../../app/api/creator/generate/route") as unknown as Promise<LegacyRouteModule>,
  },
  {
    id: "creator/generate-stream",
    pattern: "/api/creator/generate-stream",
    load: () => import("../../app/api/creator/generate-stream/route") as unknown as Promise<LegacyRouteModule>,
  },
  {
    id: "magic-tavern/generate-choices",
    pattern: "/api/magic-tavern/generate-choices",
    load: () => import("../../app/api/magic-tavern/generate-choices/route") as unknown as Promise<LegacyRouteModule>,
  },
  {
    id: "magic-tavern/generate-stream",
    pattern: "/api/magic-tavern/generate-stream",
    load: () => import("../../app/api/magic-tavern/generate-stream/route") as unknown as Promise<LegacyRouteModule>,
  },
  {
    id: "magic-tea-party/generate-choices",
    pattern: "/api/magic-tea-party/generate-choices",
    load: () => import("../../app/api/magic-tea-party/generate-choices/route") as unknown as Promise<LegacyRouteModule>,
  },
  {
    id: "magic-tea-party/generate-stream",
    pattern: "/api/magic-tea-party/generate-stream",
    load: () => import("../../app/api/magic-tea-party/generate-stream/route") as unknown as Promise<LegacyRouteModule>,
  },
  {
    id: "magic-tea-party/generate-updates",
    pattern: "/api/magic-tea-party/generate-updates",
    load: () => import("../../app/api/magic-tea-party/generate-updates/route") as unknown as Promise<LegacyRouteModule>,
  },
  {
    id: "generate-battle-story",
    pattern: "/api/generate-battle-story",
    load: () => import("../../app/api/generate-battle-story/route") as unknown as Promise<LegacyRouteModule>,
  },
  {
    id: "generate-canshou",
    pattern: "/api/generate-canshou",
    load: () => import("../../app/api/generate-canshou/route") as unknown as Promise<LegacyRouteModule>,
  },
  {
    id: "generate-canshou-stream",
    pattern: "/api/generate-canshou-stream",
    load: () => import("../../app/api/generate-canshou-stream/route") as unknown as Promise<LegacyRouteModule>,
  },
  {
    id: "generate-free",
    pattern: "/api/generate-free",
    load: () => import("../../app/api/generate-free/route") as unknown as Promise<LegacyRouteModule>,
  },
  {
    id: "generate-free-stream",
    pattern: "/api/generate-free-stream",
    load: () => import("../../app/api/generate-free-stream/route") as unknown as Promise<LegacyRouteModule>,
  },
  {
    id: "generate-game-card",
    pattern: "/api/generate-game-card",
    load: () => import("../../app/api/generate-game-card/route") as unknown as Promise<LegacyRouteModule>,
  },
  {
    id: "generate-magical-girl",
    pattern: "/api/generate-magical-girl",
    load: () => import("../../app/api/generate-magical-girl/route") as unknown as Promise<LegacyRouteModule>,
  },
  {
    id: "generate-magical-girl-details",
    pattern: "/api/generate-magical-girl-details",
    load: () => import("../../app/api/generate-magical-girl-details/route") as unknown as Promise<LegacyRouteModule>,
  },
  {
    id: "generate-magical-girl-details-stream",
    pattern: "/api/generate-magical-girl-details-stream",
    load: () => import("../../app/api/generate-magical-girl-details-stream/route") as unknown as Promise<LegacyRouteModule>,
  },
  {
    id: "generate-scenario",
    pattern: "/api/generate-scenario",
    load: () => import("../../app/api/generate-scenario/route") as unknown as Promise<LegacyRouteModule>,
  },
  {
    id: "generate-scenario-stream",
    pattern: "/api/generate-scenario-stream",
    load: () => import("../../app/api/generate-scenario-stream/route") as unknown as Promise<LegacyRouteModule>,
  },
  {
    id: "generate-sublimation",
    pattern: "/api/generate-sublimation",
    load: () => import("../../app/api/generate-sublimation/route") as unknown as Promise<LegacyRouteModule>,
  },
  {
    id: "generate-sublimation-stream",
    pattern: "/api/generate-sublimation-stream",
    load: () => import("../../app/api/generate-sublimation-stream/route") as unknown as Promise<LegacyRouteModule>,
  },
];

