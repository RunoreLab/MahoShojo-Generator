// 此文件由 scripts/generate-hono-route-manifest.mjs 自动生成，请勿手工编辑。
import type { RouteDefinition, RouteModule } from '@/server/routes/types';

export const routeDefinitions: RouteDefinition[] = [
  {
    id: "me/battle-reports/[generationId]/regenerate",
    pattern: "/api/me/battle-reports/:generationId/regenerate",
    adapter: "legacy-next",
    load: () => import("../../app/api/me/battle-reports/[generationId]/regenerate/route") as unknown as Promise<RouteModule>,
  },
  {
    id: "arena/session/generate-next",
    pattern: "/api/arena/session/generate-next",
    adapter: "legacy-next",
    load: () => import("../../app/api/arena/session/generate-next/route") as unknown as Promise<RouteModule>,
  },
  {
    id: "arena/generate",
    pattern: "/api/arena/generate",
    adapter: "legacy-next",
    load: () => import("../../app/api/arena/generate/route") as unknown as Promise<RouteModule>,
  },
  {
    id: "arena/generate-stream",
    pattern: "/api/arena/generate-stream",
    adapter: "legacy-next",
    load: () => import("../../app/api/arena/generate-stream/route") as unknown as Promise<RouteModule>,
  },
  {
    id: "creator/generate",
    pattern: "/api/creator/generate",
    adapter: "shared-service",
    load: () => import("../adapters/creator/generate") as unknown as Promise<RouteModule>,
  },
  {
    id: "creator/generate-stream",
    pattern: "/api/creator/generate-stream",
    adapter: "shared-service",
    load: () => import("../adapters/creator/generate-stream") as unknown as Promise<RouteModule>,
  },
  {
    id: "magic-tavern/generate-choices",
    pattern: "/api/magic-tavern/generate-choices",
    adapter: "legacy-next",
    load: () => import("../../app/api/magic-tavern/generate-choices/route") as unknown as Promise<RouteModule>,
  },
  {
    id: "magic-tavern/generate-stream",
    pattern: "/api/magic-tavern/generate-stream",
    adapter: "legacy-next",
    load: () => import("../../app/api/magic-tavern/generate-stream/route") as unknown as Promise<RouteModule>,
  },
  {
    id: "magic-tea-party/generate-choices",
    pattern: "/api/magic-tea-party/generate-choices",
    adapter: "legacy-next",
    load: () => import("../../app/api/magic-tea-party/generate-choices/route") as unknown as Promise<RouteModule>,
  },
  {
    id: "magic-tea-party/generate-stream",
    pattern: "/api/magic-tea-party/generate-stream",
    adapter: "legacy-next",
    load: () => import("../../app/api/magic-tea-party/generate-stream/route") as unknown as Promise<RouteModule>,
  },
  {
    id: "magic-tea-party/generate-updates",
    pattern: "/api/magic-tea-party/generate-updates",
    adapter: "legacy-next",
    load: () => import("../../app/api/magic-tea-party/generate-updates/route") as unknown as Promise<RouteModule>,
  },
  {
    id: "generate-battle-story",
    pattern: "/api/generate-battle-story",
    adapter: "legacy-next",
    load: () => import("../../app/api/generate-battle-story/route") as unknown as Promise<RouteModule>,
  },
  {
    id: "generate-canshou",
    pattern: "/api/generate-canshou",
    adapter: "shared-service",
    load: () => import("../adapters/generate-canshou") as unknown as Promise<RouteModule>,
  },
  {
    id: "generate-canshou-stream",
    pattern: "/api/generate-canshou-stream",
    adapter: "shared-service",
    load: () => import("../adapters/generate-canshou-stream") as unknown as Promise<RouteModule>,
  },
  {
    id: "generate-free",
    pattern: "/api/generate-free",
    adapter: "shared-service",
    load: () => import("../adapters/generate-free") as unknown as Promise<RouteModule>,
  },
  {
    id: "generate-free-stream",
    pattern: "/api/generate-free-stream",
    adapter: "shared-service",
    load: () => import("../adapters/generate-free-stream") as unknown as Promise<RouteModule>,
  },
  {
    id: "generate-game-card",
    pattern: "/api/generate-game-card",
    adapter: "shared-service",
    load: () => import("../adapters/generate-game-card") as unknown as Promise<RouteModule>,
  },
  {
    id: "generate-magical-girl",
    pattern: "/api/generate-magical-girl",
    adapter: "shared-service",
    load: () => import("../adapters/generate-magical-girl") as unknown as Promise<RouteModule>,
  },
  {
    id: "generate-magical-girl-details",
    pattern: "/api/generate-magical-girl-details",
    adapter: "legacy-next",
    load: () => import("../../app/api/generate-magical-girl-details/route") as unknown as Promise<RouteModule>,
  },
  {
    id: "generate-magical-girl-details-stream",
    pattern: "/api/generate-magical-girl-details-stream",
    adapter: "legacy-next",
    load: () => import("../../app/api/generate-magical-girl-details-stream/route") as unknown as Promise<RouteModule>,
  },
  {
    id: "generate-scenario",
    pattern: "/api/generate-scenario",
    adapter: "shared-service",
    load: () => import("../adapters/generate-scenario") as unknown as Promise<RouteModule>,
  },
  {
    id: "generate-scenario-stream",
    pattern: "/api/generate-scenario-stream",
    adapter: "shared-service",
    load: () => import("../adapters/generate-scenario-stream") as unknown as Promise<RouteModule>,
  },
  {
    id: "generate-sublimation",
    pattern: "/api/generate-sublimation",
    adapter: "legacy-next",
    load: () => import("../../app/api/generate-sublimation/route") as unknown as Promise<RouteModule>,
  },
  {
    id: "generate-sublimation-stream",
    pattern: "/api/generate-sublimation-stream",
    adapter: "legacy-next",
    load: () => import("../../app/api/generate-sublimation-stream/route") as unknown as Promise<RouteModule>,
  },
];

