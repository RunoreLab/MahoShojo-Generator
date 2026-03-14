# Agent 网页能力与安全评估报告（2026-03-14）

## 1. 目的与范围

本文用于评估真实部署站点 `https://mahoshojo.colanns.me/` 在 Agent 访问场景下的能力边界，并回答两个核心问题：

1. 本项目当前是否足以防止 Agent 绕过冷却、逮捕、截断、封禁与登录门槛等机制。
2. 在保证安全与防滥用的前提下，哪些站点能力可以允许 Agent 有序、有限度地使用。

本次结论来自两部分：

- 2026-03-14 对真实部署站点的受控实测。
- 对仓库内相关实现的源码审查。

本次测试刻意保持低频和低风险：

- 只做了 1 次匿名网页生成和 1 次匿名直调接口复测。
- 只做了少量无效鉴权探测，不创建真实账号。
- 不进行批量注册、不做高频压测、不提交敏感内容。

## 2. 结论摘要

- 匿名 Agent 当前可以稳定完成大量公开、低门槛的网页操作，包括：首页/百科浏览、公开功能页导航、无需登录的角色生成、本地导入导出、文本粘贴与本地敏感词检测等。
- 匿名 Agent 当前无法直接完成注册/登录，也无法匿名创建 PVP 房间或快速匹配；这一点在线上实测中成立。
- 但“无法直接登录”不等于“无法滥用站点”。当前更大的风险点在于：部分公共 AI 接口只有前端冷却，缺少等价的服务端限流或服务端输入安全校验，Agent 只要绕开网页按钮，直接调用接口即可继续工作。
- 如果 Agent 拿到了真人会话 Cookie 或 legacy `authKey`，它在很多业务路径上就会拥有接近真人用户的同等权限。Turnstile 只保护登录/注册，不保护登录后的大多数业务操作。
- 结论上，当前项目已经具备“限制匿名 Agent 直接撞账号体系”的基础门槛，但距离“对 Agent 安全开放网站能力”还有明显差距，尤其是统一服务端限流、统一服务端安全校验、以及针对 Agent 的最小权限化能力边界还没有完全建立。

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

- 当前登录/注册接口虽然记录了审计日志，但没有看到与注册/登录直接绑定的应用层限流逻辑。
- 这意味着如果未来出现“可代解验证码的 Agent”“人机协同过验证码”“外部验证码打码服务”，当前注册/登录链路仍可能被自动化批量尝试。

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

#### 2) 受保护业务接口有服务端鉴权

相关实现：

- `lib/auth/server.ts`
- `lib/auth/server-app.ts`
- `pages/api/pvp/rooms/index.ts`
- `lib/pvp/server.ts`

结论：

- 保护型接口不是只靠前端按钮置灰。
- 未授权请求会在服务端收到 `401`。
- 已封禁用户也会在受保护接口被 `403` 拒绝。

#### 3) PVP 提交等高风险写入已有服务端内容检查

相关实现：

- `pages/api/pvp/rooms/[roomId]/submit.ts`

结论：

- 提交卡组时服务端会重新检查卡牌可见性、版本一致性、统计范围、敏感词等。
- 这类设计可以阻止 Agent 仅靠篡改前端状态来提交越权或违规内容。

#### 4) 部分复杂生成链路已有服务端安全检查或服务端 429

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

### 当前仍然明显不足的部分

#### 1) 部分公共生成接口只有前端冷却，缺少等价服务端冷却

最明确的实例就是 `/name`：

- 前端页面 `pages/name.tsx` 使用 `useCooldown('generateMagicalGirlCooldown', 60000)`。
- 但服务端 `pages/api/generate-magical-girl.ts` 明确移除了原有限流/队列逻辑。
- 线上实测中，网页刚进入冷却后，直调接口仍然返回 `200` 且无 `Retry-After`。

结论：

- 当前“冷却”并不能阻止 direct API Agent。
- 这与“Agent 不能绕过冷却”这一目标不一致。

#### 2) 部分输入“逮捕”仍主要依赖前端预检

最明确的实例仍然是 `/name`：

- 前端 `pages/name.tsx` 会先调用 `getSensitiveWordRedirectTarget(...)`。
- 但服务端 `pages/api/generate-magical-girl.ts` 没有等价的 `enforceTextSafety(...)` 或 `quickCheck(...)`。

结论：

- 对于这条链路，Agent 只要不走网页按钮，而是直接调接口，就可以绕开这层前端“逮捕”预检。
- 因为本次不提交敏感内容，所以这里是源码结论，不做线上危险输入复测。

#### 3) 截断 / 输出安全并不总是服务端硬边界

从实现看：

- `lib/magic-tea-party/stream-safety.ts` 的核心输出截断逻辑位于前端消费流的安全控制器。
- `lib/magic-tea-party/useMagicTeaPartyChat.ts` 在客户端根据流内容做 soft-block / truncate。

结论：

- 至少在魔法茶会链路里，不能把“网页里看见的截断效果”简单等同于“服务端绝不会把更多原始输出交给 direct API Agent”。
- 这属于需要进一步统一口径的地方。

这里的判断是源码推断，不是线上危险输出复测。

#### 4) 注册 / 登录缺少清晰的应用层限流闭环

从现有实现看：

- `app/api/auth/register/handler.ts` 与 `app/api/auth/login/handler.ts` 会记录 `auth_audit_logs`。
- 但没有看到像 `guardMailSendByAudit(...)` 那样直接约束注册/登录频率的应用层限流。

结论：

- 当前主要依赖 Turnstile。
- 如果未来有能力批量获取有效 Turnstile token，注册/登录仍可能被自动化批量尝试。

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

### 不建议直接允许的能力范围

- 注册 / 登录本身
- 批量保存云端数据卡
- PVP 建房 / 快速匹配 / Bot 管理 / 强制推进
- 邮箱 / 密码 / 账号迁移相关操作
- 任何消耗用户外部 API Key 的站内操作

这些操作的共同点是：

- 可造成账号、成本、对局生态或内容库污染
- 很难仅靠“前端按钮确认”约束 Agent
- 更适合单独做 capability token、审批流或每日额度

## 6. 建议的改进方向

### 第一优先级：把“前端冷却”升级为“服务端 canonical 限流”

建议覆盖至少以下路径：

- `/api/generate-magical-girl`
- `/api/generate-magical-girl-details`
- 其他仍主要依赖前端冷却的公开生成接口

最低要求：

- 返回明确 `429`
- 返回 `Retry-After`
- 维度至少包含 `ip + 会话/活动令牌 + 功能动作`

推荐顺序：

1. 先做实例内软限流统一封装
2. 再补 D1 / Durable Object / Cloudflare 平台级限流
3. 最后再做异常行为审计

### 第二优先级：把“逮捕”从前端体验逻辑收敛为服务端硬边界

原则：

- 前端预检可以保留，但只能当 UX 提示
- 服务端必须有同等或更严格的 canonical 检查
- 任何 direct API Agent 都不应因为绕开按钮而绕开安全检查

其中 `/name` 是应优先修补的明显缺口。

### 第三优先级：为注册 / 登录补应用层速率保护

建议：

- 注册：按 IP / 邮箱 / 用户名窗口限流
- 登录：按 IP / identifier 窗口限流
- 连续失败递增惩罚
- 审计日志驱动封禁或冷却

Turnstile 应保留，但不应是唯一保护。

### 第四优先级：把“允许 Agent 使用”做成显式能力模型

建议新增单独的 Agent 能力层，而不是默认让 Agent 直接继承整站用户权限：

- `agent:public-read`
- `agent:public-generate-low-risk`
- `agent:user-read-self`
- `agent:user-write-limited`
- `agent:pvp-host`（默认不要开放）

每种 scope 应有：

- 单独 token
- 明确 TTL
- 调用次数额度
- 审计日志
- 可撤销能力

### 第五优先级：对“截断 / 输出安全”明确边界位置

建议明确一条原则：

- 如果某条能力要求“Agent 无法绕过截断”，那截断必须发生在服务端最终输出层，而不是只在浏览器渲染层。

否则：

- 网页 Agent 看见的是“被截断的文本”
- direct API Agent 拿到的可能是“更早、更多或未统一裁剪的原始流”

## 7. 最终判断

截至 2026-03-14：

- 本项目已经具备“阻止普通匿名 Agent 直接撞注册/登录与匿名 PVP 写操作”的基本能力。
- 但还不具备“全面阻止 Agent 绕过冷却、逮捕、截断”的一致性能力。
- 当前最现实的风险，不是 Agent 能不能打开网页，而是：
  - 它能否绕过前端按钮直接调用公共 AI 接口；
  - 它在拿到真实用户会话后是否拥有过大的默认能力。

因此，针对 Agent 的推荐策略不是“一刀切禁止”，而是：

1. 公开只读能力默认允许。
2. 公开低风险生成能力在补齐服务端限流和服务端安全检查后再允许。
3. 登录后能力不要直接继承整站会话，应拆成独立、可撤销、可审计的 agent scope。
4. 对 PVP、账号安全、批量写入、外部凭据消耗等高风险路径，默认不对 Agent 开放。

## 8. 关键代码落点

- 鉴权与封禁
  - `app/api/auth/register/handler.ts`
  - `app/api/auth/login/handler.ts`
  - `app/api/auth/verify/handler.ts`
  - `lib/auth/server.ts`
  - `lib/auth/server-app.ts`
- 前端冷却
  - `lib/cooldown.ts`
  - `pages/name.tsx`
  - `pages/free.tsx`
  - `pages/scenario.tsx`
  - `pages/details.tsx`
  - `pages/canshou.tsx`
- 服务端内容安全
  - `lib/content-safety/server.ts`
  - `pages/api/generate-free.ts`
  - `pages/api/generate-scenario.ts`
  - `pages/api/generate-canshou.ts`
  - `pages/api/magic-tea-party/generate-stream.ts`
- PVP 服务端保护
  - `pages/api/pvp/rooms/index.ts`
  - `pages/api/pvp/rooms/[roomId]/submit.ts`
  - `lib/pvp/server.ts`
- 连续战报服务端软限流
  - `pages/api/arena/session/generate-next.ts`
  - `lib/ai-session/rate-limit.ts`
- 当前已确认存在缺口的公开生成接口
  - `pages/api/generate-magical-girl.ts`
  - `pages/api/generate-magical-girl-details.ts`
