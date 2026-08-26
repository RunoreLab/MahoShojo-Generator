// 此文件由 apps/api/scripts/generate-route-manifest.mjs 自动生成，请勿手工编辑。
import type { RouteDefinition, RouteModule } from '#/routes/types';

export const routeDefinitions: RouteDefinition[] = [
  {
    id: "arena/generations/[generationId]/cancel",
    pattern: "/api/arena/generations/:generationId/cancel",
    adapter: "shared-service",
    load: () => import("../adapters/arena/generations/[generationId]/cancel") as unknown as Promise<RouteModule>,
  },
  {
    id: "arena/generations/[generationId]/stream",
    pattern: "/api/arena/generations/:generationId/stream",
    adapter: "shared-service",
    load: () => import("../adapters/arena/generations/[generationId]/stream") as unknown as Promise<RouteModule>,
  },
  {
    id: "arena/session/generate-next",
    pattern: "/api/arena/session/generate-next",
    adapter: "shared-service",
    load: () => import("../adapters/arena/session/generate-next") as unknown as Promise<RouteModule>,
  },
  {
    id: "arena/generation-requests/[generationRequestId]",
    pattern: "/api/arena/generation-requests/:generationRequestId",
    adapter: "shared-service",
    load: () => import("../adapters/arena/generation-requests/[generationRequestId]") as unknown as Promise<RouteModule>,
  },
  {
    id: "arena/generations/[generationId]",
    pattern: "/api/arena/generations/:generationId",
    adapter: "shared-service",
    load: () => import("../adapters/arena/generations/[generationId]") as unknown as Promise<RouteModule>,
  },
  {
    id: "arena/generate",
    pattern: "/api/arena/generate",
    adapter: "shared-service",
    load: () => import("../adapters/arena/generate") as unknown as Promise<RouteModule>,
  },
  {
    id: "arena/generate-stream",
    pattern: "/api/arena/generate-stream",
    adapter: "shared-service",
    load: () => import("../adapters/arena/generate-stream") as unknown as Promise<RouteModule>,
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
    id: "generate-battle-story",
    pattern: "/api/generate-battle-story",
    adapter: "shared-service",
    load: () => import("../adapters/generate-battle-story") as unknown as Promise<RouteModule>,
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
    adapter: "shared-service",
    load: () => import("../adapters/generate-magical-girl-details") as unknown as Promise<RouteModule>,
  },
  {
    id: "generate-magical-girl-details-stream",
    pattern: "/api/generate-magical-girl-details-stream",
    adapter: "shared-service",
    load: () => import("../adapters/generate-magical-girl-details-stream") as unknown as Promise<RouteModule>,
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
    adapter: "shared-service",
    load: () => import("../adapters/generate-sublimation") as unknown as Promise<RouteModule>,
  },
  {
    id: "generate-sublimation-stream",
    pattern: "/api/generate-sublimation-stream",
    adapter: "shared-service",
    load: () => import("../adapters/generate-sublimation-stream") as unknown as Promise<RouteModule>,
  },
];

