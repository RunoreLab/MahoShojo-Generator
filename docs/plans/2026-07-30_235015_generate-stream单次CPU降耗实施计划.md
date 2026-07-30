# generate-stream 单次 CPU 降耗实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 降低 `/api/arena/generate-stream` 正常完成与客户端中止路径的单次 CPU，并保持现有安全规则、生成记录和 ranking/done 协议。

**Architecture:** 为敏感词过滤器增加与完整扫描共享规则但首次命中即返回的布尔路径；将 arena 输入大小校验和序列化缓存收敛为纯函数边界；把收尾分成 aborted 最小记录与 completed/failed 完整记录，中止时取消上游和 R2、跳过摘要、输出扫描、combatants、排位及 R2 索引。功能开关只控制 aborted 快速路径，默认开启并允许紧急回退。

**Tech Stack:** Next.js 15 App Router、TypeScript strict、Cloudflare Workers/D1/R2、Vitest。

---

## 文件结构

- 修改 `lib/sensitive-word-filter.ts`：新增 `containsSensitiveWord()`，复用相同四类匹配规则并短路。
- 新建 `lib/arena/generate-stream-input.ts`：定义请求总字节上限、用户可控字段字符上限、一次序列化结果及校验错误。
- 新建 `lib/arena/generate-stream-finalization.ts`：定义 aborted 快速路径开关判断与最小记录构造所需的纯逻辑。
- 修改 `app/api/arena/generate-stream/handler.ts`：接入快速敏感词检测、输入限制、序列化复用和轻量中止收尾。
- 新建 `tests/sensitive-word-contains.test.ts`：验证快速路径与完整路径的一致性及短路接口。
- 新建 `tests/arena-stream-input-limits.test.ts`：验证字符/字节超限在安全扫描及 AI 调用前拒绝。
- 新建 `tests/arena-stream-abort-fast-path.test.ts`：验证 aborted 路径跳过昂贵收尾，正常路径顺序不变。

### Task 1：敏感词布尔快速路径

- [ ] 写 `tests/sensitive-word-contains.test.ts`，以直接词、正则词、插入字符变体、整 token 拼音与正常文本对比 `containsSensitiveWord(text)` 和 `quickCheck(text).hasSensitiveWords`。
- [ ] 运行 `pnpm test -- tests/sensitive-word-contains.test.ts`，确认因导出缺失而失败。
- [ ] 在 `SensitiveWordFilter` 内实现 `containsSensitiveWord(text): Promise<boolean>`：只做一次繁简/全角规范化，按正则、Aho-Corasick、插入变体、拼音顺序扫描，任一命中立即返回，不构造 `filteredText`、上下文或 matchDetails；导出同名安全包装函数。
- [ ] 再次运行测试并确认通过。

### Task 2：输入限制和序列化复用

- [ ] 写 `tests/arena-stream-input-limits.test.ts`，覆盖总请求 UTF-8 字节超限、userGuidance、characterGuidance、叙事历史、scenario/material/combatant 序列化字段超限，以及边界值通过；断言错误为显式 400 语义而非截断。
- [ ] 运行 `pnpm test -- tests/arena-stream-input-limits.test.ts`，确认因模块缺失而失败。
- [ ] 实现 `serializeAndValidateArenaStreamInput(input)`，返回 `{ serialized, inputJson, inputChars, inputBytes }`；每个对象只 stringify 一次，字节数只编码缓存后的 `inputJson` 一次。
- [ ] 在 handler 的昂贵签名/安全扫描/AI 调用之前调用校验；将 inputsToCheck、快照预览和最终记录改为复用 `serialized`，敏感词日志只保留 `inputChars`、不可逆 hash 和 `matchType: 'boolean-fast-path'`。
- [ ] 运行输入限制测试和 `tests/public-ai-input-safety.test.ts`，确认通过。

### Task 3：aborted 轻量收尾

- [ ] 写 `tests/arena-stream-abort-fast-path.test.ts`，约束快速路径不调用 `summarizeStreamBattleReportPreview`、`quickCheck`/输出扫描、combatants 写入、`settleArenaRatingsForGeneration`、R2 索引，并保留一条 status=aborted 的 generation 最小记录；同时覆盖开关关闭时回退旧收尾。
- [ ] 运行该测试，确认当前统一完整收尾导致失败。
- [ ] 抽取 `finalizeAborted()` 与 `finalizeFull()`；`ARENA_ABORT_FAST_PATH !== 'false'` 时中止分支先取消 reader/R2 上传，再以 `waitUntil`（无 context 时 await）写最小 generation 记录，只含请求元数据、状态、时长、输入/输出计数和规范化错误，不读取 usage/finishReason/season，不处理摘要、安全输出、角色、排位或索引。
- [ ] 确保 SSE `cancel()` 和非 SSE `cancel()` 都进入同一快速路径，上游超时/错误仍按既有 aborted/failed 分类；completed 保持关键写入 → 结算 → ranking → done。
- [ ] 运行 aborted、ranking、resource limits、stream meta 测试并确认通过。

### Task 4：回归与文档收口

- [ ] 在原方案文档第三阶段增加实际实施说明、限制值、开关和 Cloudflare CPU 指标需部署后观测的边界。
- [ ] 运行 `pnpm test`，确认全部测试通过。
- [ ] 运行 `pnpm lint`，确认无错误。
- [ ] 运行 `pnpm build`，确认生产构建成功。
- [ ] 检查 `git diff --check` 与 `git status --short`，确认无空白错误且仅包含本阶段文件。
