# AI_APICallError（上游 AI 接口调用失败）

> 作者：[Colanns](https://github.com/colasama) / [末伏之夜](https://github.com/notuhao)  
> 更新时间：2026-01-05

当你在生成角色/情景/战报时看到类似：

- `AI_APICallError`

这通常表示：**本站成功发起了“调用模型供应商接口”的请求，但供应商（或自定义通道）返回了错误**。  
它很多时候会伴随 `HTTP 4xx/5xx`，甚至被显示成 “服务器错误（HTTP 500）”，但根因往往在 **AI 通道/账户/额度/模型配置**，而不是 Cloudflare。

---

## 常见触发原因

1. **API Key 无效/过期/填错**：多一个空格、复制不完整、Key 已被撤销
2. **权限不足 / 不允许访问**：Key 没有调用目标模型的权限，或账号/组织策略限制
3. **余额/额度不足**：供应商返回 `insufficient_quota`、`quota`、`balance` 等提示
4. **模型 ID 无效或不可用**：模型拼写错、已下线、你所在账号未开通、区域不可用
5. **上游繁忙/服务波动**：高峰期拥堵、供应商故障、短暂 5xx
6. **触发上游限流**：过于频繁（常见 `HTTP 429`）
7. **账号被封禁/风控拦截**：例如提示「用户已被封禁（request id: ...）」或类似措辞
8. **请求体过大/上下文过长**：提示 `context length`、`too large`、`413` 等
9. **自定义通道配置错误**：供应商选错、Base URL 写错、代理不可用、模型映射不一致

---

## 如何快速定位（建议按顺序）

1. **看报错里是否带有 `HTTP xxx`**：优先用状态码缩小范围（见下方速查）
2. **看是否带 `request id` / `trace id`**：这是供应商侧排查用的定位号（不要公开 API Key）
3. **如果你使用“自备通道/自定义配置”**：优先检查 Key、模型 ID、供应商选择、Base URL
4. **如果你使用站内默认通道**：多数情况下是上游波动/拥堵，重试或稍后再试更有效

---

## 按状态码速查（最常见）

- **HTTP 401（Unauthorized）**：Key 无效/过期/填错；确认没有多余空格，必要时重新生成 Key
- **HTTP 403（Forbidden）**：权限不足、区域/组织策略限制、账号被限制或封禁；按提示处理或联系供应商
- **HTTP 404（Not Found）**：模型 ID 不存在/拼写错误/未开通；换成可用模型
- **HTTP 429（Too Many Requests）**：限流/冷却；减少频率或等待（见：`/encyclopedia/rate-limit-429`）
- **HTTP 413（Payload Too Large）/ 提示 too large**：输入太长或结构化输出要求过重；缩短输入、拆分任务
- **HTTP 500/502/503**：上游服务波动或通道不稳定；先重试 1～2 次，再考虑换模型/换供应商
- **HTTP 504**：链路超时；若页面提示 Cloudflare 524，则按 524 超时处理（见：`/encyclopedia/cloudflare-524-timeout`）

---

## 特殊提示：用户已被封禁

当报错里明确出现「用户已被封禁」或类似措辞时，通常意味着：

- **供应商账号/项目被风控或封禁**（而不是本站“随机坏掉”）
- `request id` 是你向供应商申诉/工单时最有用的信息之一

你可以尝试：

- 若为自备通道：更换可用账号/Key，或联系供应商处理封禁原因
- 若为站内默认通道：截图保留 `request id` 并反馈给站点维护者

---

## 相关条目

- AI 生成失败：常见原因与自救：`/encyclopedia/ai-errors`
- 请求过于频繁（429）：`/encyclopedia/rate-limit-429`
- 网络问题：`/encyclopedia/network-errors`
- Cloudflare/服务器错误（5xx / 520/522/523…）：`/encyclopedia/cloudflare-errors`
- 524 Timeout（Cloudflare 超时）：`/encyclopedia/cloudflare-524-timeout`
