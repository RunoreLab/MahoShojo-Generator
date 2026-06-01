# Cloudflare Queues AI 生成异步化设计

设计时间：2026-05-22 14:48:46（Asia/Shanghai）
状态：`approved-for-planning`
关联调研：[2026-05-22_142246_524错误与AI生成异步化可行性调研](../reports/2026-05-22_142246_524错误与AI生成异步化可行性调研.md)

## 1. 背景与目标

当前长 AI 生成仍主要绑定在 HTTP 请求生命周期内。即使竞技场战报已经支持 SSE 心跳、输出预览、R2 存储和 `battle_report_generations` 审计记录，只要上游模型首字节过慢、连接中断或 Cloudflare 侧等待超时，用户仍可能遇到 524，并失去本次生成的可恢复入口。

本设计采用 Cloudflare Queues 作为第一阶段后台执行器，把“发起生成”和“等待生成完成”拆开：

1. 用户请求先创建可查询任务，快速返回 `jobId`。
2. Queue consumer 根据 `jobId` 在后台执行 AI 生成。
3. D1 保存任务生命周期、进度、错误和结果引用。
4. 大结果继续走 R2 与 `large_objects` 引用。
5. 前端通过轮询恢复任务，刷新页面或网络中断后仍可领取结果。

第一阶段优先迁移竞技场战报生成，因为它是最重、最容易触发 524、且已有审计和大输出存储基础的链路。魔法少女、残兽、情景、升华、自由生成、茶会等入口在后续复用同一任务底座。

## 2. 设计原则

1. HTTP 请求不再是生成成败的唯一载体。
2. `ai_generation_jobs` 是任务控制表，`battle_report_generations` 继续是战报审计表。
3. Queue 消息只携带 `jobId` 和少量路由信息，完整输入从 D1 读取。
4. 任务创建阶段完成权限、频控、输入校验和敏感词检查，避免无效任务进入队列。
5. consumer 必须幂等，重复投递不能重复生成、重复写结果或重复结算。
6. 用户自定义 API Key 第一阶段不进入后台队列，避免明文密钥落库。
7. 首版以轮询为主，不要求恢复实时流式输出；流式观察通道可作为后续增强。

## 3. 第一阶段范围

### 3.1 纳入范围

第一阶段实现通用任务底座，并接入竞技场战报异步生成：

- `pages/api/arena/generate-stream.ts` 的核心生成能力迁移为后台任务可调用的 service。
- 新增任务创建接口，接收竞技场战报请求并返回 `jobId`。
- 新增任务查询接口，返回状态、进度、错误或结果。
- 新增 Cloudflare Queues producer / consumer。
- 成功完成后继续写入 `battle_report_generations`、战报角色明细、排位结算事件与 R2 输出引用。
- 前端竞技场页面支持任务中、失败、成功恢复与刷新后继续查询。

### 3.2 暂不纳入范围

第一阶段不做以下内容：

- 不一次性迁移所有生成入口。
- 不支持用户自定义 API Key 后台生成。
- 不实现 Workflows。
- 不实现后台任务的实时 SSE 回放。
- 不把 `battle_report_generations` 改造成通用任务表。
- 不做跨设备完整任务中心；只做当前用户/匿名身份可恢复的最近任务入口。
- 不承诺已进入上游 AI 请求后的任务能立即取消。

## 4. 总体架构

```text
浏览器
  |
  | POST /api/ai-generations
  v
Next.js Edge API
  - 校验请求
  - 解析用户/匿名身份
  - 频控与安全检查
  - 写 ai_generation_jobs(pending)
  - enqueue { jobId }
  |
  | 202 { jobId, pollAfterMs }
  v
浏览器轮询 GET /api/ai-generations/{jobId}

Cloudflare Queue
  |
  v
Queue consumer
  - 抢占任务锁
  - 置为 processing
  - 调用业务 generation service
  - 写 progress / result / error
  - 战报任务写 battle_report_generations 和 R2
```

关键边界：

- API handler 只负责创建任务，不直接等待 AI。
- consumer 是唯一的后台执行入口。
- 业务生成逻辑应从 `pages/api/arena/generate-stream.ts` 中抽出，避免 API handler 和 consumer 复制一套战报构造逻辑。

## 5. 任务模型

新增 D1 表 `ai_generation_jobs`。数据库字段使用 `snake_case`，TypeScript DTO 使用 `camelCase`。

### 5.1 状态

```text
pending -> processing -> succeeded
pending -> processing -> failed
pending -> cancelling -> cancelled
processing -> cancelling -> cancelled
pending/processing -> expired
failed -> pending    (仅限可重试错误的下一次投递)
```

### 5.2 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text primary key | 任务 ID，对外返回 `jobId` |
| `kind` | text | 任务类型，数据库保存 snake_case，首版含 `arena_battle_report` |
| `status` | text | `pending`、`processing`、`succeeded`、`failed`、`cancelling`、`cancelled`、`expired` |
| `user_id` | integer null | 登录用户归属 |
| `activity_user_key` | text null | 匿名身份归属，用于刷新恢复 |
| `idempotency_key` | text null | 客户端幂等键 |
| `input_hash` | text | 输入摘要，用于排查与去重 |
| `input_json` | text | 必要输入快照，不含 API Key、Cookie、完整 IP |
| `provider_json` | text null | 模型和供应商快照，不含密钥 |
| `progress_json` | text null | 阶段、预览、token、进度说明 |
| `result_json` | text null | 小结果或结果摘要 |
| `result_object_kind` | text null | 大结果类型，例如 `battle_report_generation_output` |
| `result_object_ref_id` | text null | 对应业务引用 ID，例如 `generationId` |
| `battle_generation_id` | text null | 战报任务成功后关联 `battle_report_generations.id` |
| `error_code` | text null | 稳定错误码 |
| `error_message` | text null | 用户可理解错误摘要 |
| `attempt_count` | integer | 已尝试次数 |
| `max_attempts` | integer | 最大尝试次数 |
| `locked_at` | text null | consumer 抢占锁时间 |
| `locked_by` | text null | consumer 实例标识 |
| `started_at` | text null | 首次处理开始时间 |
| `finished_at` | text null | 完成时间 |
| `expires_at` | text | 结果保留期限 |
| `created_at` | text | 创建时间 |
| `updated_at` | text | 更新时间 |

推荐索引：

```sql
CREATE INDEX IF NOT EXISTS idx_ai_generation_jobs_user_created
  ON ai_generation_jobs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_generation_jobs_activity_created
  ON ai_generation_jobs(activity_user_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_generation_jobs_status_updated
  ON ai_generation_jobs(status, updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_generation_jobs_user_idempotency
  ON ai_generation_jobs(user_id, idempotency_key)
  WHERE user_id IS NOT NULL AND idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_generation_jobs_activity_idempotency
  ON ai_generation_jobs(activity_user_key, idempotency_key)
  WHERE activity_user_key IS NOT NULL AND idempotency_key IS NOT NULL;
```

## 6. API 契约

API DTO 使用 camelCase，数据库使用 snake_case。任务创建边界必须通过 mapper 显式转换，不允许把前端 `kind` 原样透传到数据库。

首版映射：

| API `kind` | DB `kind` |
| --- | --- |
| `arenaBattleReport` | `arena_battle_report` |

### 6.1 创建任务

```http
POST /api/ai-generations
Content-Type: application/json
```

请求体：

```json
{
  "kind": "arenaBattleReport",
  "payload": {
    "mode": "scenario",
    "combatants": [],
    "scenario": null,
    "storyLength": "long"
  },
  "idempotencyKey": "client-generated-key"
}
```

响应：

```json
{
  "jobId": "gen_...",
  "kind": "arenaBattleReport",
  "status": "pending",
  "pollAfterMs": 1500
}
```

创建阶段必须完成：

- 请求体 schema 校验。
- 登录用户或匿名 `activityUserKey` 解析。
- 当前 public AI 频控。
- 同一用户/匿名身份的并发任务数限制。
- 输入敏感词检查。
- 自定义 provider 检查：如果请求包含用户 API Key，首版返回 400 或走旧前台链路。
- 写入 `ai_generation_jobs`。
- 向 Queue 发送 `{ jobId }`。

### 6.2 查询任务

```http
GET /api/ai-generations/{jobId}
```

处理中：

```json
{
  "jobId": "gen_...",
  "kind": "arenaBattleReport",
  "status": "processing",
  "progress": {
    "stage": "generating",
    "message": "AI 正在生成战报",
    "preview": "..."
  },
  "result": null,
  "error": null,
  "updatedAt": "2026-05-22T06:48:46.000Z",
  "pollAfterMs": 2000
}
```

成功：

```json
{
  "jobId": "gen_...",
  "kind": "arenaBattleReport",
  "status": "succeeded",
  "progress": null,
  "result": {
    "generationId": "...",
    "battleGenerationId": "...",
    "outputPreview": "...",
    "resultObjectKind": "battle_report_generation_output",
    "resultObjectRefId": "..."
  },
  "error": null
}
```

失败：

```json
{
  "jobId": "gen_...",
  "kind": "arenaBattleReport",
  "status": "failed",
  "progress": null,
  "result": null,
  "error": {
    "code": "upstream_timeout",
    "message": "AI 响应超时，请稍后重试或切换模型。"
  }
}
```

查询阶段必须校验所有权：

- 登录任务只能由对应 `user_id` 读取。
- 匿名任务必须匹配 `activity_user_key`。
- 管理员调试接口另行设计，不混入用户查询 API。

### 6.3 取消任务

```http
POST /api/ai-generations/{jobId}/cancel
```

首版语义：

- `pending` 可直接转为 `cancelled`。
- `processing` 转为 `cancelling`，consumer 在检查点发现后尽力停止。
- 已发出的上游 AI 请求不保证立即取消。

## 7. Queue 配置

建议 wrangler 配置增加一个主队列和一个死信队列：

```toml
[[queues.producers]]
queue = "ai-generation-jobs"
binding = "AI_GENERATION_QUEUE"

[[queues.consumers]]
queue = "ai-generation-jobs"
max_batch_size = 1
max_batch_timeout = 5
max_retries = 3
dead_letter_queue = "ai-generation-jobs-dlq"

[[queues.producers]]
queue = "ai-generation-jobs-dlq"
binding = "AI_GENERATION_DLQ"
```

当前仓库 `wrangler.toml` 已区分根配置、`env.production` 和 `env.preview`。Queue producer / consumer / DLQ 绑定也需要按部署环境同步配置，避免预览环境能创建任务但生产环境缺少队列绑定，或反过来。

第一阶段推荐 `max_batch_size = 1`，因为单个 AI 生成可能持续数分钟，批量处理容易让一个慢任务拖住同批消息。后续如迁移短生成入口，可以按 `kind` 拆队列或提高批量大小。

consumer 单次执行时间按 Cloudflare Queues 当前限制控制在 15 分钟以内。项目内部还应保留总超时，例如 12 分钟，给状态写回和清理留出余量。

## 8. Consumer 幂等与重试

consumer 收到消息后执行：

1. 读取 `ai_generation_jobs`。
2. 若任务不存在，ack。
3. 若状态已是 `succeeded`、`cancelled`、`expired`，ack。
4. 原子抢占任务：仅允许 `pending` 或可重试 `failed` 进入 `processing`。
5. 写入 `locked_at`、`locked_by`、`attempt_count + 1`。
6. 调用对应 `kind` 的 runner。
7. 成功写入结果、输出引用、`battle_report_generations` 关联，再置为 `succeeded`。
8. 可重试错误抛出给 Queue retry，或写回 `failed` 并重新 enqueue。
9. 不可重试错误写 `failed`，ack。

可重试错误：

- 上游 429。
- 上游 5xx。
- 网络超时。
- 短暂 D1/R2 写入失败。

不可重试错误：

- 输入参数无效。
- 敏感词拦截。
- 用户无权限或额度不足。
- 自定义 provider 凭据无效。
- 多次结构化修复后仍无法通过 schema。

为避免重复结算，战报 runner 必须使用同一 `generationId`，并在写入 `battle_report_generations` 或排位结算前检查是否已完成。若 `battle_generation_id` 已存在，consumer 应直接返回现有结果。

## 9. 战报试点接入

### 9.1 需要拆出的服务边界

从 `pages/api/arena/generate-stream.ts` 中拆出后台可复用 service，建议命名：

- `lib/arena/generation/request.ts`
- `lib/arena/generation/runner.ts`
- `lib/arena/generation/result.ts`

核心接口：

```ts
export type ArenaBattleReportJobInput = {
  requestId: string;
  payload: unknown;
  requestMeta: ArenaGenerationRequestMeta;
};

export type ArenaBattleReportJobResult = {
  generationId: string;
  outputPreview: string | null;
  outputChars: number;
  outputBytes: number;
  telemetry: {
    aiProviderName?: string | null;
    aiProviderType?: string | null;
    aiModel?: string | null;
    promptTokens?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
    reasoningTokens?: number | null;
  };
};

export async function runArenaBattleReportJob(
  input: ArenaBattleReportJobInput,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: ArenaBattleReportJobProgress) => Promise<void> | void;
  }
): Promise<ArenaBattleReportJobResult>;
```

service 内复用现有逻辑：

- combatants 校验与签名补齐。
- 情景、辅助情景、素材、问卷 Lore 处理。
- 随机判定器链。
- 敏感词和内容安全检查。
- prompt 构建。
- `generateWithStreamAI()` 调用。
- 输出预览、token、finish reason、reasoning 统计。
- R2 输出存储。
- `battle_report_generations` 写入。
- `battle_report_generation_combatants` 写入。
- 排位结算。
- current state / arena history meta 提取。

API handler 只保留请求解析、任务创建和旧链路兼容。

### 9.2 结果存储

战报任务成功后：

1. `ai_generation_jobs.result_json` 存轻量摘要。
2. `ai_generation_jobs.result_object_kind = 'battle_report_generation_output'`。
3. `ai_generation_jobs.result_object_ref_id = generationId`。
4. `ai_generation_jobs.battle_generation_id = generationId`。
5. 长输出写 R2，并通过 `large_objects.owner_ref_id = generationId` 关联。
6. `battle_report_generations` 继续保留完整审计字段。

如果 R2 写入成功但 D1 最终状态写入失败，下一次 retry 应复用同一 `generationId`，并优先检查已有 R2 / `battle_report_generations` 记录，避免重复产物。

## 10. 前端体验

竞技场生成按钮触发新异步链路后：

1. 创建任务成功后立即显示任务卡片。
2. 轮询间隔从 `pollAfterMs` 开始，处理中可逐步退避到 3-5 秒。
3. 任务 `processing` 时显示阶段文案和输出预览。
4. 网络错误或 524 不直接判定生成失败；若已有 `jobId`，自动恢复轮询。
5. 页面刷新后，从本地保存的最近 `jobId` 或用户最近任务接口恢复。
6. 成功后把结果填回现有战报结果区，并提供进入战报详情/历史记录的入口。
7. 失败后展示稳定错误文案和重试按钮；重试使用新的 `idempotencyKey`，但可以复用原输入。

本地状态建议：

```ts
type AiGenerationJobClientState = {
  jobId: string;
  kind: 'arenaBattleReport';
  status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelling' | 'cancelled' | 'expired';
  createdAt: string;
  updatedAt: string;
  lastKnownResult?: unknown;
  lastKnownError?: { code: string; message: string } | null;
};
```

## 11. 后续复用

通用任务底座稳定后，新增 `kind` 即可接入其他生成入口：

| kind | 对应入口 | 结果形态 |
| --- | --- | --- |
| `free_card` | `generate-free*` | 通用角色/情景 Markdown 或 JSON |
| `magical_girl_card` | `generate-magical-girl*` | 魔法少女 JSON |
| `canshou_card` | `generate-canshou*` | 残兽 JSON |
| `scenario_card` | `generate-scenario*` | 情景 JSON/Markdown |
| `sublimation_card` | `generate-sublimation*` | 升华后角色 JSON/Markdown |
| `magic_tea_party_message` | 茶会生成 | 会话消息与摘要 |
| `pvp_round_resolution` | PVP 回合结算 | 回合战报与胜负 |

复用规则：

1. 每个 `kind` 只新增自己的 input schema、runner 和 result mapper。
2. 所有 runner 使用同一任务状态机。
3. 所有 runner 禁止保存用户 API Key。
4. 大结果统一走 R2 + `large_objects`。
5. 小结果可以直接存 `result_json`，但必须注意 D1 单行大小限制。

## 12. 测试策略

### 12.1 单元测试

新增 Bun 测试：

- `tests/ai-generation-jobs-schema-contract.test.ts`
- `tests/ai-generation-jobs-repository.test.ts`
- `tests/ai-generation-jobs-service.test.ts`
- `tests/arena-battle-report-job-runner.test.ts`

覆盖：

- 状态流转。
- 幂等创建。
- 所有权校验。
- pending 抢占。
- succeeded 后重复投递直接 ack。
- failed 可重试与不可重试分支。
- 自定义 API Key 被拒绝进入后台任务。
- 战报结果关联 `battle_report_generations`。

### 12.2 API 测试

覆盖：

- `POST /api/ai-generations` 返回 202。
- 同一 `idempotencyKey` 返回同一任务。
- 超过并发任务数返回 429。
- `GET /api/ai-generations/{jobId}` 只允许所有者读取。
- cancel 对 pending 生效。

### 12.3 集成验证

本地开发可先用“同步 fake consumer”验证状态流转，再接 wrangler Queue：

1. 创建任务。
2. fake consumer 执行 runner。
3. 查询状态从 `pending` 到 `processing` 到 `succeeded`。
4. 检查 `battle_report_generations`、R2 引用和任务结果。
5. 模拟 runner 抛出上游 5xx，确认重试策略。
6. 模拟重复消息，确认不会重复写战报和结算。

提交前至少运行：

```bash
pnpm test
pnpm lint
pnpm build
```

如果只完成底座局部实现，可运行对应测试子集并在 PR 中记录未覆盖范围。

## 13. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| Queue consumer 仍有 15 分钟上限 | 内部总超时设为 12 分钟；超长任务后续评估 Workflows |
| 重复投递导致重复结算 | 任务锁、固定 `generationId`、成功状态检查、结算前检查 |
| D1 单行过大 | 输入裁剪，输出走 R2，`result_json` 只放摘要 |
| 匿名用户刷新后找不到任务 | 建立稳定匿名 `activityUserKey`，查询必须匹配 |
| 后台化降低等待成本导致滥用 | 创建前频控，并限制 pending + processing 并发数 |
| 自定义 API Key 泄露 | 第一阶段不支持自定义 provider 后台任务 |
| 旧流式体验退化 | 首版接受轮询；后续加“观察通道”而不改变后台执行权威 |
| consumer 代码与 API handler 分叉 | 抽 service，API 和 consumer 共用同一 runner |

## 14. 实施顺序

1. 新增 `ai_generation_jobs` schema、repository、mapper 和 contract tests。
2. 新增任务创建、查询、取消 API。
3. 抽出竞技场战报 generation runner，不改变旧接口行为。
4. 接入 fake consumer，验证本地状态流转。
5. 配置 Cloudflare Queues producer / consumer / DLQ。
6. 新增竞技场异步生成入口，前端接轮询恢复。
7. 小流量或开关灰度启用。
8. 观察 524、失败率、平均等待、任务积压和重试次数。
9. 稳定后逐步迁移魔法少女、残兽、情景、升华、自由生成等入口。

## 15. 参考来源

访问时间：2026-05-22。

- Cloudflare Support - Error 524：<https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/>
- Cloudflare Fundamentals - Connection limits：<https://developers.cloudflare.com/fundamentals/reference/connection-limits/>
- Cloudflare Workers - Limits：<https://developers.cloudflare.com/workers/platform/limits/>
- Cloudflare Workers - Context / waitUntil：<https://developers.cloudflare.com/workers/runtime-apis/context/>
- Cloudflare D1 - Limits：<https://developers.cloudflare.com/d1/platform/limits/>
- Cloudflare Queues - Overview：<https://developers.cloudflare.com/queues/>
- Cloudflare Queues - Batching, Retries and Delays：<https://developers.cloudflare.com/queues/configuration/batching-retries/>
- Cloudflare Queues - Dead Letter Queues：<https://developers.cloudflare.com/queues/configuration/dead-letter-queues/>
