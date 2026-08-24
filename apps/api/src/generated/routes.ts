// 此文件由 apps/api/scripts/generate-route-manifest.mjs 自动生成，请勿手工编辑。
import type { RouteDefinition, RouteModule } from '#/routes/types';

export const routeDefinitions: RouteDefinition[] = [
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
];

