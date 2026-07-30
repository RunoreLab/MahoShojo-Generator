# 第一阶段 Workers CPU 立即止损实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 阻止生成期间的排位请求放大，并为旧客户端流量增加服务器端保护与单请求 CPU 熔断。

**Architecture:** 前端把轮询策略抽成纯函数并交给 TanStack Query，在生成完成后按有界退避查询；API 在任何 D1 读取前调用 Cloudflare Rate Limiting binding，限流键只包含 SHA-256 指纹。Wrangler 生产配置负责 CPU 上限和临时日志采样。

**Tech Stack:** Next.js 15、React 19、TanStack Query 5、Cloudflare Workers Rate Limiting、Vitest。

---

### Task 1: 有界排位轮询

**Files:**
- Create: `components/arena/utils/generation-ranking-polling.ts`
- Modify: `components/arena/components/CombatantList.tsx`
- Test: `tests/generation-ranking-polling.test.ts`

- [x] 写失败测试，覆盖生成中禁用、2/5/10/20 秒退避、最多 8 次与 60 秒截止。
- [x] 运行定向 Vitest，确认因策略尚不存在而失败。
- [x] 实现纯轮询策略；查询函数透传 `AbortSignal`，关闭窗口聚焦和后台轮询，仅重试一次。
- [x] 再次运行定向测试并确认通过。

### Task 2: generation-ranking 前置限流

**Files:**
- Create: `lib/arena/generation-ranking-rate-limit.ts`
- Modify: `app/api/arena/generation-ranking/handler.ts`
- Modify: `wrangler.jsonc`
- Test: `tests/generation-ranking-rate-limit.test.ts`

- [x] 写失败测试，覆盖哈希键、主体/资源 12 次每分钟、IP 全局 120 次每分钟、429 与 `Retry-After: 10`。
- [x] 运行定向测试，确认因限流模块尚不存在而失败。
- [x] 接入三个 Cloudflare Rate Limiting binding，并在 D1 读取之前执行；binding 不可用时降级放行并记录一次结构化警告。
- [x] 再次运行定向测试并确认通过。

### Task 3: 生产 CPU 熔断与临时采样

**Files:**
- Modify: `wrangler.jsonc`

- [x] 为生产环境配置 `limits.cpu_ms = 10000`。
- [x] 将生产 `head_sampling_rate` 从 `0.01` 临时提高到 `0.1`，预览配置保持不变。
- [x] 运行 Wrangler 配置检查确认 JSONC 与 binding 配置有效。

### Task 4: 全量验证

- [x] 运行全量 Vitest。
- [x] 运行 Next ESLint。
- [x] 运行 Next 生产构建、OpenNext Cloudflare 构建及 Wrangler production dry-run。
- [x] 审阅 `git diff`，确认没有第二阶段或无关改动。
