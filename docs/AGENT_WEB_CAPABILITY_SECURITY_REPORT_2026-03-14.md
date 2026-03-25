# Agent 网页能力与安全评估报告（2026-03-14）

## 1. 目的与范围

本文用于评估真实部署站点 `https://mahoshojo.colanns.me/` 在 Agent 访问场景下的能力边界，并回答两个核心问题：

1. 本项目当前是否足以防止 Agent 绕过冷却、逮捕、截断、封禁与登录门槛等机制。
2. 在保证安全与防滥用的前提下，哪些站点能力可以允许 Agent 有序、有限度地使用。

本次结论来自两部分：

- 2026-03-14 对真实部署站点的受控实测。
- 对仓库内相关实现的源码审查。

本次测试刻意保持低频和低风险：

- 只做了 1 次匿名网页生成、1 组 `/api/generate-magical-girl` 低频双击采样、1 次超长输入校验、1 次敏感词样本校验。
- 只做了少量无效鉴权探测，不创建真实账号。
- 不进行批量注册、不做高频压测、不提交持久化敏感内容。

## 2. 结论摘要

- 匿名 Agent 当前可以稳定完成大量公开、低门槛的网页操作，包括：首页/百科浏览、公开功能页导航、无需登录的角色生成、本地导入导出、文本粘贴与本地敏感词检测等。
- 匿名 Agent 当前无法直接完成注册/登录，也无法匿名创建 PVP 房间或快速匹配；这一点在线上实测中成立。
- 但“无法直接登录”不等于“无法滥用站点”。在本次线上实测时，更大的风险点在于：部分公共 AI 接口只有前端冷却，缺少等价的服务端限流或服务端输入安全校验，Agent 只要绕开网页按钮，直接调用接口即可继续工作。
- 如果 Agent 拿到了真人会话 Cookie 或 legacy `authKey`，它在很多业务路径上就会拥有接近真人用户的同等权限。Turnstile 只保护登录/注册，不保护登录后的大多数业务操作。
- 仓库内已经继续完成“公开生成 canonical 限流 + 注册/登录应用层速率保护”的第 1 阶段补强，但都仍需部署后复测，且当前实现仍未达到跨实例强一致。
- 结论上，当前项目已经具备“限制匿名 Agent 直接撞账号体系”的基础门槛，但距离“对 Agent 安全开放网站能力”还有明显差距，尤其是统一服务端限流、统一服务端安全校验、以及针对 Agent 的最小权限化能力边界还没有完全建立。

## 2.1 第 1 阶段补强后的线上采样复测（2026-03-14 第二轮）

- `/api/generate-magical-girl` 已确认存在服务端 canonical 输入校验：
  - 301 字名字会返回 `400` JSON：`{"error":"名字太长啦，你怎么回事！"}`
  - 敏感词样本会返回 `400` JSON：`{"error":"输入内容不合规","shouldRedirect":true,"reason":"使用危险符文"}`
- 这说明 `/name` 至少在本次抽样路径上，direct API 已不能再通过“绕过前端按钮”来绕过名字长度校验与敏感词“逮捕”。
- 但在“合法输入连续直调”的复测里，当前线上先触发的是 Cloudflare 平台层 `1015`：
  - 第二次请求返回 `429`
  - `Retry-After: 10`
  - `content-type: text/plain; charset=UTF-8`
  - 响应体为 `error code: 1015`
- 这说明真实站点已经存在平台层抗滥用保护，但本次没有观察到应用层 canonical JSON `429`；因此“应用层限流是否已稳定部署到线上”目前仍不能下结论，且应用层 / 平台层 / 前端的限流语义仍不一致。
- 另外，公开 HTML 页面当前仍未看到 `Content-Security-Policy`、`Strict-Transport-Security`、`X-Frame-Options` / `frame-ancestors`、`Permissions-Policy` 等关键浏览器安全响应头；浏览器侧硬化仍明显不足。

## 2.2 仓库内补强进展（2026-03-14，本地代码已落地，待部署后复测）

以下内容是本次评估后在仓库内已经完成的补强，不代表 `https://mahoshojo.colanns.me/` 在本次实测时已经具备这些能力；线上仍需部署后再复测确认。

### 已落地的服务端 canonical 限流 v1

- 新增统一限流模块：`lib/ai/public-rate-limit.ts`
- 标识维度：
  - 优先使用已验证活动令牌（`activity token`）对应的用户身份
  - 无活动令牌时退化为脱敏 IP
  - 明确忽略裸 `x-mahoshojo-user-id`，避免伪造身份绕过
- 冷却策略：
  - 官方通道按公共生成动作使用 canonical 冷却
  - 自定义通道统一收敛到 3 秒冷却
- 模式收敛：
  - 同一业务的流式 / 非流式接口共用同一 `actionType`
  - 不能通过切换流式与非流式来绕过冷却

### 已接入的公开生成路由

- `pages/api/generate-magical-girl.ts`
- `pages/api/generate-magical-girl-details.ts`
- `pages/api/generate-magical-girl-details-stream.ts`
- `pages/api/generate-canshou.ts`
- `pages/api/generate-canshou-stream.ts`
- `pages/api/generate-scenario.ts`
- `pages/api/generate-scenario-stream.ts`
- `pages/api/generate-free.ts`
- `pages/api/generate-free-stream.ts`
- `pages/api/generate-sublimation.ts`
- `pages/api/generate-sublimation-stream.ts`

### 已对齐的前端页面行为

以下页面在收到服务端 `429` 时，会解析 `retryAfterSeconds` / `retryAfter` / `Retry-After`，并用服务端真实秒数覆盖本地冷却：

- `pages/name.tsx`
- `pages/details.tsx`
- `pages/canshou.tsx`
- `pages/scenario.tsx`
- `pages/free.tsx`
- `pages/sublimation.tsx`

### 已继续落地的服务端 canonical 输入安全

- `pages/api/generate-magical-girl.ts`
  - 新增服务端请求体 canonical 解析（含 `trim`、名字长度上限、非法 JSON 兜底）
  - 新增服务端 `enforceTextSafety(...)`，direct API 不再能绕过前端“逮捕”
- `pages/api/generate-magical-girl-details.ts`
  - 非流式问卷生成已与流式路由对齐，服务端会按 canonical 问卷答案逐条执行 `enforceTextSafety(...)`
  - direct API 不再能通过切换到非流式路由绕过问卷输入安全检查

### 已落地的注册 / 登录应用层速率保护

- 新增统一模块：`lib/auth/attempt-rate-limit.ts`
- 已接入：
  - `app/api/auth/register/handler.ts`
  - `app/api/auth/login/handler.ts`
- 注册限流维度：
  - `ip`: 10 分钟 6 次
  - `email`: 30 分钟 3 次
  - `username`: 30 分钟 3 次
- 登录限流维度：
  - `ip`: 10 分钟 12 次
  - `identifier`: 10 分钟 8 次
- 命中限流后的行为：
  - 直接返回 `429`
  - 返回 `Retry-After`、`retryAfterSeconds`、`reason`
  - 在命中限流时短路 Turnstile 与后续 Auth 链路，不再继续消耗验证码校验与上游鉴权资源
  - 记录 `auth_audit_logs`，结果码为 `RATE_LIMITED`
- 已有测试覆盖：
  - `tests/auth-attempt-rate-limit.test.ts`
  - `tests/auth-handler-rate-limit.test.ts`

### 当前仍然保留的限制与剩余工作

- 当前 public AI 限流仍是实例内 `Map`，不是跨实例、跨冷启动、跨边缘节点的强一致限流。
- 注册 / 登录应用层速率保护同样是实例内内存状态，不是跨实例、跨冷启动、跨边缘节点的一致保护。
- 上述限流与输入安全补强仍需部署到真实站点后，重新做线上复测，才能更新“部署现状”结论。

## 3. 真实部署站点实测记录

### 3.1 首页与公开页面

- 线上首页可以被 Agent 正常访问、读取和导航。
- Agent 可以直接打开公开功能入口，包括：
  - `/name`
  - `/details`
  - `/canshou`
  - `/scenario`
  - `/free`
  - `/battle`
  - `/pvp`
  - `/character-manager`
  - `/encyclopedia/*`
- 这意味着“公开读”和“公开表单填写”本身并不是当前站点希望阻止的行为。

### 3.2 注册 / 登录门槛

在 `/character-manager` 页面，登录/注册弹窗会展示：

- 密码登录
- 旧密钥登录
- Cloudflare Turnstile 安全验证

实测接口结果：

- `POST /api/auth/register`，提供合法格式用户名/邮箱/密码，但使用无效 `turnstileToken`
  - 返回 `400`
  - 返回内容：`安全验证失败，请重新验证`
- `POST /api/auth/login`，使用无效 `turnstileToken`
  - 返回 `400`
  - 返回内容：`安全验证失败，请重新验证`

这说明：

- 当前匿名 Agent 不能在没有有效 Turnstile 的情况下直接完成注册或登录。
- 这一层门槛对“普通浏览器 Agent / Playwright Agent”是有效的。

但也要看到边界：

- 就本次真实部署站点实测而言，当时尚未验证到注册/登录命中应用层 `429` 的表现；本次无效 token 复测主要验证到的是 Turnstile 阻断。
- 仓库内现已补上注册/登录应用层速率保护，但仍需部署后重新做线上复测，才能确认真实站点是否已经形成“Turnstile + 429 限速”的双层闭环。

### 3.3 匿名 PVP 行为边界

在 `/pvp` 页面，匿名状态下：

- “创建房间”按钮为禁用态。
- “房间浏览器”按钮为禁用态。
- “快速匹配”按钮为禁用态。

直接匿名调用接口实测：

- `POST /api/pvp/rooms/quick-match`
  - 返回 `401`
  - 返回内容：`未授权`
- `POST /api/pvp/rooms`
  - 返回 `401`
  - 返回内容：`未授权`

这说明：

- PVP 房间创建与快速匹配的真正边界在服务端鉴权，不只是前端按钮置灰。
- 匿名 Agent 目前不能直接绕过前端去创建房间或匹配。

### 3.4 匿名公开生成能力

在 `/name` 页面，匿名 Agent 可以直接输入名字并点击生成。

实测结果：

- 输入 `测试子` 后，匿名网页流程成功生成角色结果。
- 页面生成后出现前端冷却提示，曾显示为 `请等待 41 秒`。

但随后立刻绕开网页按钮、直接调用接口：

- `POST /api/generate-magical-girl`
  - 返回 `200`
  - 无 `Retry-After`
  - 成功返回生成结果

这说明：

- `/name` 功能的匿名调用是真实可用的。
- 该页面的冷却更多是“网页前端约束”，不是“服务端硬约束”。
- 这类能力对 Agent 是开放的，而且可以被直接接口化调用。

### 3.5 第 1 阶段补强后的追加采样复测

本轮对 `/api/generate-magical-girl` 做了 3 组低频样本：

#### 1) 服务端名字长度校验已在线可见

- `POST /api/generate-magical-girl`
  - 请求体：`name = 301` 个字符
  - 返回：`400`
  - 返回内容：`{"error":"名字太长啦，你怎么回事！"}`

这说明：

- `/name` 路由的 canonical 请求体解析与长度上限校验已在线上生效。
- direct API 不能再绕过前端名字长度限制。

#### 2) 服务端敏感词“逮捕”已在线可见

- `POST /api/generate-magical-girl`
  - 请求体：`name = 我来自中華帝國。`
  - 返回：`400`
  - 返回内容：`{"error":"输入内容不合规","shouldRedirect":true,"reason":"使用危险符文"}`

这说明：

- `/name` 路由至少在本次样本上，已经会在服务端执行输入安全检查。
- direct API 不能再像早先那样，仅通过绕开前端按钮就跳过敏感词拦截。

#### 3) 合法请求的重复直调目前先撞到 Cloudflare `1015`

- 第 1 次合法请求：客户端 5 秒内未收到响应，`curl` 视角为 `000`
- 紧接着第 2 次合法请求：
  - 返回：`429`
  - `Retry-After: 10`
  - `content-type: text/plain; charset=UTF-8`
  - 返回体：`error code: 1015`

这说明：

- 当前线上已经有平台层抗滥用保护，不再是完全“裸直调”。
- 但本次观测到的是 Cloudflare 平台层 `429`，不是仓库里 `buildPublicAiRateLimitResponse(...)` 产出的 canonical JSON `429`。
- 因此，应用层限流是否已真正上线，或是否被平台层更早拦截，本次仍无法完全区分。
- 即使平台层保护存在，应用层 / 平台层 / 前端如果不统一，仍会带来调试、观测、审计与用户提示上的不一致。

#### 4) 浏览器安全响应头仍有明显补强空间

对 `/` 与 `/character-manager` 执行 `curl -I` 观察到：

- 已有：
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `X-Content-Type-Options: nosniff`
- 未观察到：
  - `Content-Security-Policy`
  - `Strict-Transport-Security`
  - `X-Frame-Options`
  - `Permissions-Policy`
- 公开 HTML 响应当前带有：
  - `Access-Control-Allow-Origin: *`

这说明：

- 当前浏览器侧仍缺少 clickjacking、防内联脚本滥用、HTTPS 强制与能力最小化等常规硬化。
- `Access-Control-Allow-Origin: *` 出现在 HTML 页面上虽不等同于直接漏洞，但属于不必要的放宽，建议收敛。

#### 5) 匿名页面自举会触发 `POST /api/auth/verify` 的 `401` 控制台噪声

在首页与 `/character-manager` 的匿名浏览器实测里：

- 页面加载会发起 `POST /api/auth/verify`
- 未登录时返回 `401`
- 浏览器控制台会出现失败日志

这说明：

- 这不是高危安全漏洞，但会增加匿名访问时的噪声与监控误报成本。
- 若后续要建设 Agent 能力边界，最好让匿名态自举更安静、更显式。

## 4. Agent 能力范围判断

下表区分三类 Agent：

- 匿名网页 Agent：只有浏览器页面控制权，没有账号会话。
- 直接接口 Agent：不走按钮，直接发站内 HTTP 请求。
- 已登录 Agent：拿到了用户真实会话或 legacy `authKey`。

| 场景 | 匿名网页 Agent | 直接接口 Agent | 已登录 Agent | 备注 |
| --- | --- | --- | --- | --- |
| 浏览首页、百科、公开说明 | 可以 | 可以 | 可以 | 属于公开读能力 |
| 打开公开功能页、填写公开表单 | 可以 | 部分可直接调用接口 | 可以 | 公开页默认可达 |
| `/name` 匿名角色生成 | 可以 | 可以 | 可以 | 已实测成功 |
| 本地导入 / 本地导出 / 本地编辑 JSON | 可以 | 不适用 | 可以 | 多数为浏览器本地操作 |
| 本地敏感词检测与和谐替换 | 可以 | 不适用 | 可以 | 属于前端本地工具能力 |
| 注册 / 登录 | 受 Turnstile 阻断 | 无有效 Turnstile 时不可 | 已登录后不适用 | 已实测 invalid token 会被拒绝 |
| 匿名创建 PVP 房间 / 快速匹配 | 不可 | 不可 | 可以 | 匿名实测为 `401` |
| 访问“我的”“收藏”“个人中心”“云端写操作” | 不可 | 不可 | 可以 | 依赖真实会话 |
| 使用用户外部 Token 的立绘生成 | 仅当用户提供 Token | 仅当用户提供 Token | 仅当用户提供 Token | 外部凭据敏感 |

## 5. 对两类核心安全诉求的评估

### 5.1 诉求一：防止 Agent 滥用、不能绕过冷却 / 逮捕 / 截断 / 封禁 / 批量注册登录

### 当前已经做得比较好的部分

#### 1) 注册 / 登录前有人机验证

相关实现：

- `components/CharManager/AuthModal.tsx`
- `components/Turnstile.tsx`
- `app/api/auth/register/handler.ts`
- `app/api/auth/login/handler.ts`

结论：

- 普通匿名 Agent 不能直接完成批量注册/登录。
- 这是当前最有效的“第一道门”。

#### 2) 注册 / 登录应用层速率保护已在仓库内落地

相关实现：

- `lib/auth/attempt-rate-limit.ts`
- `app/api/auth/register/handler.ts`
- `app/api/auth/login/handler.ts`
- `tests/auth-attempt-rate-limit.test.ts`
- `tests/auth-handler-rate-limit.test.ts`

结论：

- 注册已按 `IP / 邮箱 / 用户名` 做窗口限流；登录已按 `IP / identifier` 做窗口限流。
- 命中限流后会优先返回 `429`，并在进入 Turnstile 与后续 Auth 鉴权前短路。
- 这使“拿到有效 Turnstile 后继续高频撞注册/登录”的成本明显上升。

#### 3) 受保护业务接口有服务端鉴权

相关实现：

- `lib/auth/server.ts`
- `lib/auth/server-app.ts`
- `pages/api/pvp/rooms/index.ts`
- `lib/pvp/server.ts`

结论：

- 保护型接口不是只靠前端按钮置灰。
- 未授权请求会在服务端收到 `401`。
- 已封禁用户也会在受保护接口被 `403` 拒绝。

#### 4) PVP 提交等高风险写入已有服务端内容检查

相关实现：

- `pages/api/pvp/rooms/[roomId]/submit.ts`

结论：

- 提交卡组时服务端会重新检查卡牌可见性、版本一致性、统计范围、敏感词等。
- 这类设计可以阻止 Agent 仅靠篡改前端状态来提交越权或违规内容。

#### 5) 部分复杂生成链路已有服务端安全检查或服务端 429

相关实现：

- `lib/content-safety/server.ts`
- `pages/api/generate-free.ts`
- `pages/api/generate-scenario.ts`
- `pages/api/generate-canshou.ts`
- `pages/api/magic-tea-party/generate-stream.ts`
- `pages/api/arena/session/generate-next.ts`
- `lib/ai-session/rate-limit.ts`

结论：

- 站内并不是所有生成接口都裸奔。
- 一部分复杂功能已经具备服务端输入安全检查，连续战报会话也已经有服务端软限流。

### 当前仍然明显不足，或仅完成仓库内第 1 阶段补强的部分

#### 1) `/name` 的服务端输入安全已在线上可见，但“合法请求冷却”仍未观测到应用层 canonical `429`

本次追加复测显示：

- `/api/generate-magical-girl` 对超长名字会直接返回 `400 JSON`
- `/api/generate-magical-girl` 对敏感词样本会直接返回 `400 JSON`
- 但对合法输入的重复直调，当前线上先出现的是 Cloudflare `1015`，不是应用层 JSON `429`

结论：

- 不能再简单说 `/name` 仍是“只有前端逮捕”的状态；服务端输入安全已至少在抽样路径上生效。
- 但“应用层 canonical 限流是否已在线稳定生效”仍没有在真实站点上被直接观测到。
- 对 direct API Agent 而言，当前碰到的是“平台层 1015 + 前端本地冷却”的组合，而不是统一、可审计的应用层 `429` 契约。

#### 2) 其他公开生成链路仍不能只凭本次 `/name` 抽样就默认视为全部补强完成

本次线上采样只额外覆盖了 `/api/generate-magical-girl`：

- 仓库代码里，`pages/api/generate-magical-girl-details.ts` 的非流式问卷生成已经补上服务端 canonical 安全检查。
- 其他公开生成链路也已在本地代码接入 `lib/ai/public-rate-limit.ts` 与 `enforceTextSafety(...)`。
- 但这并不等于线上所有路径都已经逐路验证通过。

结论：

- `/name` 的 direct API 绕过空间已明显收缩。
- `/details`、`canshou`、`scenario`、`free`、`sublimation` 等路由仍应在部署后逐路抽样复测，而不是仅凭本地代码推断“全部已好”。

#### 3) 截断 / 输出安全并不总是服务端硬边界

从实现看：

- `lib/magic-tea-party/stream-safety.ts` 的核心输出截断逻辑位于前端消费流的安全控制器。
- `lib/magic-tea-party/useMagicTeaPartyChat.ts` 在客户端根据流内容做 soft-block / truncate。

结论：

- 至少在魔法茶会链路里，不能把“网页里看见的截断效果”简单等同于“服务端绝不会把更多原始输出交给 direct API Agent”。
- 这属于需要进一步统一口径的地方。

这里的判断是源码推断，不是线上危险输出复测。

#### 4) 注册 / 登录应用层限速已落地，但还不是跨实例强一致闭环

从现有实现看：

- `lib/auth/attempt-rate-limit.ts` 使用实例内 `Map` 保存 token bucket 状态。
- `app/api/auth/register/handler.ts` 与 `app/api/auth/login/handler.ts` 已接入该模块，命中后会直接返回 `429` 并写审计日志。
- 但它仍不是跨实例、跨冷启动、跨边缘节点的统一保护，也还没有和更强的递进惩罚 / 封禁联动完全打通。

结论：

- 相比“只靠 Turnstile”，当前仓库实现已经明显前进了一步。
- 但如果目标是长期抗验证码代解、协同打码或更大规模的自动化尝试，仍需要平台级限流与更强的风险联动。

#### 5) 现有连续会话限流仍是实例内软保护，不是强一致保护

相关实现：

- `lib/ai-session/rate-limit.ts`

从实现看：

- 状态存放在内存 `Map` 中。
- 这能挡住单实例上的重复点按与短时 burst。
- 但它不是跨实例、跨冷启动、跨边缘节点的强一致限流。

结论：

- 这比纯前端冷却好很多。
- 但如果目标是“强抗 Agent 滥用”，还不够。

#### 6) 浏览器侧安全响应头仍明显不足

本次真实站点响应头抽样显示：

- 公开 HTML 页面尚未观察到 `Content-Security-Policy`
- 尚未观察到 `Strict-Transport-Security`
- 尚未观察到 `X-Frame-Options` 或等价的 `CSP frame-ancestors`
- 尚未观察到 `Permissions-Policy`
- HTML 页面当前带有 `Access-Control-Allow-Origin: *`

结论：

- 即使业务接口本身逐步加固，浏览器侧仍缺少 clickjacking、防脚本注入放大与 HTTPS 强制等基础硬化。
- 这不会直接推翻现有鉴权结论，但会让公开页面在被嵌入、被利用浏览器能力或遭遇前端注入时的防线偏弱。

#### 7) 密码恢复的速率保护仍未与注册 / 登录完全对齐

从源码看：

- `app/api/auth/recover/handler.ts` 已有 Turnstile 与基于审计日志的邮件发送保护。
- 但它不是 `lib/auth/attempt-rate-limit.ts` 这一套“命中后优先 `429` 短路”的统一模型。
- 其限速重点在“发邮件”阶段，而不是像注册 / 登录那样形成更早的统一应用层快失败。

结论：

- 当前实现已经能降低邮箱轰炸与枚举风险。
- 但若目标是统一账号安全面，密码恢复仍建议纳入与注册 / 登录同一套应用层限速与审计口径。

### 5.2 诉求二：允许 Agent 有序、有限度地使用本项目网站服务

这个目标是可以达成的，但前提是要把“允许使用的网站能力”明确拆层，而不是默认把“整站会话权限”直接交给 Agent。

### 建议允许的能力范围

#### A. 可默认允许：公开只读能力

- 首页与百科浏览
- 规则与帮助页检索
- 公开榜单、公开说明、公开入口导航

这类能力天然适合 Agent 使用，风险最低。

#### B. 可有限允许：公开低风险生成能力

前提条件：

- 必须补上服务端限流
- 必须补上服务端 canonical 安全检查
- 必须有清晰的 `429` / `Retry-After`

适合开放给 Agent 的是：

- 单次、低频、低成本的公开生成
- 不依赖账号会话的轻量辅助功能

不适合继续保持“只有前端冷却”的开放方式。

#### C. 可受控允许：登录后的只读或低风险用户代理能力

例如：

- 读取“我的战报”
- 读取个人资料
- 读取用户自己的云端内容列表

但前提应是：

- 用户显式授权当前 Agent 会话
- 服务端下发单独的 agent scope token，而不是直接复用整站 session
- scope 只允许读，不允许改

#### D. 可审批允许：外部凭据消耗型能力

例如：

- 茶会里的自备 API Key 调用
- 公开生成功能中的自定义供应商 / 自备 API Key 调用
- LibLib / ModelScope 的立绘或插画生成

前提应是：

- 用户已主动提供本次操作需要使用的外部凭据
- Agent 渠道在执行前返回明确提示词，说明将使用哪个外部渠道、进行什么动作、可能产生额度或费用消耗
- 仅在用户明确许可后执行，且至少做到“一次动作一次确认”或“当前会话范围内确认”
- 禁止在未再次说明的情况下自动连点、批量重试或后台排队消耗外部额度

推荐提示词：

- `本次操作将使用你提供的 {provider} 凭据，可能消耗外部额度/费用，用于 {action}。是否允许我继续执行这一步？`

### 不建议默认直接允许的能力范围

- 注册 / 登录本身
- 批量保存云端数据卡
- PVP 建房 / 快速匹配 / Bot 管理 / 强制推进
- 邮箱 / 密码 / 账号迁移相关操作
- 未经用户明确许可的外部凭据消耗型操作

这些操作的共同点是：

- 可造成账号、成本、对局生态或内容库污染
- 很难仅靠“前端按钮确认”约束 Agent
- 更适合单独做 capability token、审批流或每日额度

## 6. 建议的改进方向

### 第一优先级：把“前端冷却”升级为“服务端 canonical 限流”

当前状态：

- 仓库内已经完成第 1 阶段实例内 canonical 限流封装，并已接入主要公开生成路由。
- 流式 / 非流式已经按业务动作收敛到同一 action key。
- 前端主要公开生成页面也已对齐 `429` 与 `Retry-After`。
- `/api/generate-magical-girl` 的线上追加采样里，尚未观察到应用层 JSON `429`，反而先观察到 Cloudflare `1015`。
- 这说明当前除了“跨实例不强一致”之外，还存在“应用层 / 平台层限流语义不一致”的问题。

已覆盖路径：

- `/api/generate-magical-girl`
- `/api/generate-magical-girl-details`
- `/api/generate-magical-girl-details-stream`
- `/api/generate-canshou`
- `/api/generate-canshou-stream`
- `/api/generate-scenario`
- `/api/generate-scenario-stream`
- `/api/generate-free`
- `/api/generate-free-stream`
- `/api/generate-sublimation`
- `/api/generate-sublimation-stream`

下一步最低要求：

- 返回明确 `429`
- 返回 `Retry-After`
- 维度至少包含 `ip + 会话/活动令牌 + 功能动作`
- 应用层 `429` 与 Cloudflare / 平台层 `429` 的语义、响应体与可观测字段要尽量收敛
- 将实例内状态继续升级到 D1 / Durable Object / Cloudflare 平台级限流

推荐顺序：

1. 已完成：实例内软限流统一封装
2. 待完成：让真实部署先稳定观测到应用层 canonical `429`
3. 待完成：D1 / Durable Object / Cloudflare 平台级限流
4. 待完成：异常行为审计与封禁联动

### 第二优先级：把“逮捕”从前端体验逻辑收敛为服务端硬边界

原则：

- 前端预检可以保留，但只能当 UX 提示
- 服务端必须有同等或更严格的 canonical 检查
- 任何 direct API Agent 都不应因为绕开按钮而绕开安全检查

其中 `/name` 的服务端输入安全已在本次追加复测中得到验证，接下来应把同等抽样复测扩展到 `/details` 等其他公开链路。

### 第三优先级：把已落地的注册 / 登录限速升级为跨实例闭环

当前状态：

- 仓库内已完成注册 / 登录应用层 token bucket 限速，并已接入实际 handler。
- 命中限速时会优先返回 `429`，短路 Turnstile 与后续 Auth 鉴权。
- 但当前仍是实例内状态，尚未形成跨实例一致保护。

下一步建议：

- 将注册 / 登录限速迁移到 D1 / Durable Object / Cloudflare 平台级限流
- 增加连续失败递增惩罚或挑战升级
- 让审计日志与封禁 / 额外冷却联动

Turnstile 应保留，但不应是唯一保护。

同时建议把密码恢复也纳入统一的应用层限速口径，而不是仅依赖邮件发送阶段的审计保护。

### 第四优先级：把“允许 Agent 使用”做成显式能力模型

建议新增单独的 Agent 能力层，而不是默认让 Agent 直接继承整站用户权限：

- `agent:public-read`
- `agent:public-generate-low-risk`
- `agent:user-read-self`
- `agent:user-write-limited`
- `agent:external-credential-spend`（默认关闭；每次操作前需显式提示并获用户许可）
- `agent:pvp-host`（默认不要开放）

每种 scope 应有：

- 单独 token
- 明确 TTL
- 调用次数额度
- 审计日志
- 可撤销能力

### 第五优先级：补齐浏览器安全响应头与嵌入策略

建议通过 `next.config.ts` 的 `headers()` 或 Cloudflare 平台配置，统一补齐：

- `Content-Security-Policy`
- `Strict-Transport-Security`
- `X-Frame-Options`，或等价的 `CSP frame-ancestors`
- `Permissions-Policy`

同时建议：

- 移除 HTML 页面的 `Access-Control-Allow-Origin: *`
- 审视 `pages/_document.tsx` 中的内联脚本，必要时改为 nonce / hash 或外置脚本，以便真正落地 CSP

### 第六优先级：对“截断 / 输出安全”明确边界位置

建议明确一条原则：

- 如果某条能力要求“Agent 无法绕过截断”，那截断必须发生在服务端最终输出层，而不是只在浏览器渲染层。

否则：

- 网页 Agent 看见的是“被截断的文本”
- direct API Agent 拿到的可能是“更早、更多或未统一裁剪的原始流”

## 7. 最终判断

截至 2026-03-14：

- 就真实部署站点实测而言，本项目已经具备“阻止普通匿名 Agent 直接撞注册/登录与匿名 PVP 写操作”的基本能力。
- 就真实部署站点实测而言，还不具备“全面阻止 Agent 绕过冷却、逮捕、截断”的一致性能力。
- 就真实部署站点追加采样而言，`/api/generate-magical-girl` 的服务端 canonical 输入安全已经在线可见，direct API 已不能再绕过名字长度与抽样敏感词拦截。
- 就真实部署站点追加采样而言，公共生成接口在重复合法直调时当前先触发的是 Cloudflare `1015`，而不是应用层 canonical JSON `429`；这说明平台层保护已经存在，但应用层限流的真实部署状态仍未被直接观测确认。
- 就当前仓库实现而言，公共生成接口的“服务端 canonical 冷却”已完成第 1 阶段补强，能明显收缩 direct API 绕过前端冷却的空间，但尚未达到跨实例强一致水平。
- 就当前仓库实现而言，注册/登录应用层速率保护也已落地，并且会在 Turnstile 前返回 `429` 短路后续鉴权链路，但同样尚未达到跨实例强一致水平。
- 就浏览器侧边界而言，公开 HTML 页面当前仍缺少 CSP / HSTS / anti-frame 等关键安全响应头，这部分仍有明确补强空间。
- 当前最现实的风险，不是 Agent 能不能打开网页，而是：
  - 它能否绕过前端按钮直接调用公共 AI 接口；
  - 它在拿到真实用户会话后是否拥有过大的默认能力。

因此，针对 Agent 的推荐策略不是“一刀切禁止”，而是：

1. 公开只读能力默认允许。
2. 公开低风险生成能力在补齐服务端限流和服务端安全检查后再允许。
3. 登录后能力不要直接继承整站会话，应拆成独立、可撤销、可审计的 agent scope。
4. 对 PVP、账号安全、批量写入，以及未经用户明确许可的外部凭据消耗等高风险路径，默认不对 Agent 开放。

## 8. 关键代码落点

- 鉴权与封禁
  - `app/api/auth/register/handler.ts`
  - `app/api/auth/login/handler.ts`
  - `app/api/auth/verify/handler.ts`
  - `lib/auth/server.ts`
  - `lib/auth/server-app.ts`
- 注册 / 登录应用层速率保护
  - `lib/auth/attempt-rate-limit.ts`
  - `tests/auth-attempt-rate-limit.test.ts`
  - `tests/auth-handler-rate-limit.test.ts`
- 前端会话自举与匿名 `401` 噪声
  - `lib/auth.ts`
- 前端冷却
  - `lib/cooldown.ts`
  - `pages/name.tsx`
  - `pages/free.tsx`
  - `pages/scenario.tsx`
  - `pages/details.tsx`
  - `pages/canshou.tsx`
  - `pages/sublimation.tsx`
- 公共 AI 服务端 canonical 限流
  - `lib/ai/public-rate-limit.ts`
  - `pages/api/generate-magical-girl.ts`
  - `pages/api/generate-magical-girl-details.ts`
  - `pages/api/generate-magical-girl-details-stream.ts`
  - `pages/api/generate-canshou.ts`
  - `pages/api/generate-canshou-stream.ts`
  - `pages/api/generate-scenario.ts`
  - `pages/api/generate-scenario-stream.ts`
  - `pages/api/generate-free.ts`
  - `pages/api/generate-free-stream.ts`
  - `pages/api/generate-sublimation.ts`
  - `pages/api/generate-sublimation-stream.ts`
- 服务端内容安全
  - `lib/content-safety/server.ts`
  - `pages/api/generate-free.ts`
  - `pages/api/generate-scenario.ts`
  - `pages/api/generate-canshou.ts`
  - `pages/api/magic-tea-party/generate-stream.ts`
- 密码恢复与邮件发送保护
  - `app/api/auth/recover/handler.ts`
  - `lib/auth/mail-send-guard.ts`
- PVP 服务端保护
  - `pages/api/pvp/rooms/index.ts`
  - `pages/api/pvp/rooms/[roomId]/submit.ts`
  - `lib/pvp/server.ts`
- 连续战报服务端软限流
  - `pages/api/arena/session/generate-next.ts`
  - `lib/ai-session/rate-limit.ts`
- 页面壳与响应头落点
  - `next.config.ts`
  - `pages/_document.tsx`
- 本轮已继续补强的公开生成链路
  - `pages/api/generate-magical-girl.ts`
  - `pages/api/generate-magical-girl-details.ts`
  - 说明：direct API 现已命中服务端 canonical 输入安全，后续重点转向部署后复测与跨实例强一致限流
