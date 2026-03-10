# 用户统计日快照自动化与补洞运行说明（2026-03-10）

## 0. 结论先行

当前仓库里的“用户统计日快照”自动化链路已经明确：

1. GitHub Actions 定时触发工作流：`.github/workflows/admin-user-analytics-daily-snapshot.yml`
2. 工作流调用触发脚本：`scripts/trigger-admin-user-analytics-snapshot.mjs`
3. 脚本向线上站点的 `/api/admin/user-analytics/snapshot` 发起 `POST`
4. API 在服务端校验共享密钥后，写入 `admin_user_analytics_daily`
5. 同一次运行会顺手检查最近 7 天是否有缺失日期，并尝试补洞

这套设计里并不存在“两套不同用途的 token”：

- `ADMIN_USER_ANALYTICS_SNAPSHOT_URL` 不是 token，它只是要访问的 API 地址
- `ADMIN_USER_ANALYTICS_SNAPSHOT_TOKEN` 才是共享密钥
- 之所以要在“GitHub Secrets”和“应用环境变量”里各放一次，是因为它们分别位于调用方与被调用方，两边都必须持有同一份密钥，才能完成校验

---

## 1. 当前代码落点

### 1.1 入口与校验

- API：`pages/api/admin/user-analytics/snapshot.ts`
- Header：`x-admin-user-analytics-snapshot-token`
- 环境变量：`ADMIN_USER_ANALYTICS_SNAPSHOT_TOKEN`

当前 API 允许两种触发方式：

1. 管理员已登录后台，走 admin session
2. 外部自动化任务携带共享密钥，走 token 校验

这两条路是并列关系，不是重复设计。

### 1.2 定时与补洞

当前工作流：

- 文件：`.github/workflows/admin-user-analytics-daily-snapshot.yml`
- 计划执行时间：每日 UTC `00:05`
- 当前调用参数：`--backfill-days 7`

当前服务端能力：

1. 记录当前一次快照
2. 检查最近 7 天已闭合日期是否存在缺口
3. 缺失时顺序补写这些日期
4. 支持 dry-run 预演

后台页面也新增了手动入口：

- `/admin/user-analytics`
- 按钮：`补缺失快照`

---

## 2. 这两个 Secrets 分别干什么

### 2.1 `ADMIN_USER_ANALYTICS_SNAPSHOT_URL`

用途：告诉 GitHub Actions 应该把请求发到哪里。

示例值：

```text
https://<你的线上域名>/api/admin/user-analytics/snapshot
```

它不是鉴权材料，不参与签名，也不应该保密到和 token 同等级。

### 2.2 `ADMIN_USER_ANALYTICS_SNAPSHOT_TOKEN`

用途：作为 GitHub Actions 调用这个公开 API 时的共享密钥。

请求时它会放进：

```text
x-admin-user-analytics-snapshot-token: <token>
```

服务端会把请求头里的值与应用环境中的 `ADMIN_USER_ANALYTICS_SNAPSHOT_TOKEN` 做字符串比对；一致才允许执行。

---

## 3. 为什么这个 token 不是“多余的”

### 3.1 当前这条路径为什么需要

当前方案是：

1. GitHub Actions 在 GitHub 的 runner 上执行
2. runner 通过公网访问你部署后的站点
3. 访问的是一个会写生产 D1 的管理 API

在这个前提下，如果没有 token，只剩三种选择：

1. **把 API 公开匿名开放**
   - 不可接受
   - 任何拿到 URL 的人都能反复触发写库

2. **要求 GitHub Actions 带管理员登录态**
   - 基本不可维护
   - GitHub Actions 不适合长期保存交互式管理员 session / cookie

3. **引入更重的机器身份体系**
   - 例如 Cloudflare Access Service Token、OIDC/JWT 校验、专用签名网关
   - 可以做，但复杂度显著高于当前需求

所以，在“GitHub Actions 调公网 API”这个架构下，**一个专用共享密钥是最低复杂度且足够实用的安全边界**。

### 3.2 它不是 Cloudflare API Token

这里的 `ADMIN_USER_ANALYTICS_SNAPSHOT_TOKEN`：

- 不是 `CLOUDFLARE_API_TOKEN`
- 不授予 Cloudflare 账户级权限
- 不直接访问 D1 管理接口
- 只用于放行这一个业务 API

因此它的权限面很窄，本质上是“这个管理端点的机器调用口令”。

### 3.3 真正显得“没必要”的情况

只有当自动化不再经由公网 API，而改成以下任一种时，这个 token 才可能省掉：

1. **Cloudflare 平台内定时任务直接执行**
   - 例如后续改成 Cloudflare Cron Trigger 直接调用同一部署内的函数
   - 调用链不出站点边界，可以不依赖共享密钥

2. **同一运行时内部调度**
   - 例如由服务端内部任务队列直接落库
   - 不经过公开 HTTP 面

3. **换成更强的机器身份方案**
   - 用 Access Service Token / OIDC 取代当前共享密钥

结论：

- 对“当前 GitHub Actions 调公网 API”的实现，token 不是多余
- 对“未来若迁到 Cloudflare 内部 cron”的实现，可以重新评估并删除这层共享密钥

---

## 4. 为什么看起来像“两个 token”

常见误解是把下面两件事都叫成“token”：

1. GitHub Secrets 里的 `ADMIN_USER_ANALYTICS_SNAPSHOT_TOKEN`
2. 应用环境变量里的 `ADMIN_USER_ANALYTICS_SNAPSHOT_TOKEN`

实际上它们是**同一个值在两个系统中的各自存放位置**：

- GitHub Secrets：给调用方脚本读取
- 应用环境变量：给服务端校验读取

这不是两套 token，也不是一套主 token + 一套子 token。

更准确的理解是：

> 一把共享钥匙，同时保存在门外的值班员和门里的门禁系统手里。

---

## 5. 生产配置步骤

### 5.1 GitHub 仓库侧

在仓库 Secrets 中配置：

1. `ADMIN_USER_ANALYTICS_SNAPSHOT_URL`
2. `ADMIN_USER_ANALYTICS_SNAPSHOT_TOKEN`

### 5.2 应用部署侧

在应用运行环境中配置同名变量：

1. `ADMIN_USER_ANALYTICS_SNAPSHOT_TOKEN`

注意：

- 这里“同名”是关键
- GitHub 里的 token 值必须与应用环境里的 token 值完全一致

### 5.3 默认分支与 Actions

还需要满足两项前置条件：

1. 工作流文件已经合并到默认分支
2. 仓库 GitHub Actions 已启用

否则即便代码存在、Secrets 已配置，`schedule` 也不会真正执行。

---

## 6. 回补/backfill 的真实能力边界

## 6.1 目前能严格回补的部分

以下指标基于事实表或可回算时间戳，历史回补基本可靠：

1. `users.created_at` 对应的总用户基线
2. `battle_report_generations` 对应的 1 日生成量与状态分布
3. `auth_audit_logs` 对应的 1 日成功/失败量

## 6.2 目前只能 best-effort 的部分

以下指标当前依赖 `user_last_activity` 单行最新状态，因此**无法做严格历史回放**：

1. `trackedUsers`
2. `activeUsers24h`
3. `activeUsers7d`
4. `activeUsers30d`
5. `activityCoverageRate`
6. 高频样本口径里依赖 `last_seen_at` 的分层

原因很简单：

- `user_last_activity` 只保留“最后一次活跃”
- 如果某用户在缺失日期之后又活跃过，旧值会被覆盖
- 后续再回补历史日期时，已经无法知道她在当时窗口里是否活跃

因此当前 backfill 的正确描述应当是：

> 对窗口型活跃/覆盖率/频率趋势做 best-effort 补洞，而不是严格历史回填。

## 6.3 如果以后要“严格补洞”

必须引入按日或按事件的历史活动明细，例如：

```sql
user_activity_daily(user_id, activity_date, first_seen_at, last_seen_at, touch_count)
```

在没有这类明细表之前，不应把当前 backfill 表述成“完全精确”。

---

## 7. 当前推荐操作方式

### 7.1 自动化

推荐保持现在的 GitHub Actions 方案：

1. 每日 UTC `00:05` 运行
2. 固定带 `--backfill-days 7`
3. 每次运行同时完成：
   - 当前快照记录
   - 最近 7 天缺口检测与补写

### 7.2 手动运维

有两种手动入口：

1. 后台按钮：
   - `/admin/user-analytics`
   - `记录今日快照`
   - `补缺失快照`

2. 本地脚本：

```bash
bun scripts/snapshot-admin-user-analytics-daily.ts --dry-run
bun scripts/snapshot-admin-user-analytics-daily.ts --backfill-days 7 --skip-current
bun scripts/snapshot-admin-user-analytics-daily.ts --metric-date 2026-03-09
node scripts/trigger-admin-user-analytics-snapshot.mjs --dry-run --backfill-days 7
```

---

## 8. 推荐后续演进

### 8.1 保持当前实现

适用于：

- 只想把管理趋势先跑起来
- 可接受“窗口型补洞为 best-effort”
- 希望最小改动继续使用 GitHub Actions

### 8.2 升级成 Cloudflare 内部调度

适用于：

- 希望取消公网回调与共享密钥
- 统一到 Cloudflare 平台内调度

收益：

- 可以不再依赖 GitHub 作为调度入口
- 安全边界更内聚

### 8.3 升级成严格历史活动明细

适用于：

- 需要严格 DAU/WAU/MAU 回算
- 需要严格的缺失日期回补
- 需要更精细的 cohort / 回流 / 复活分析

代价：

- 新表
- 新写入链路
- 更高 D1 成本与维护复杂度

---

## 9. 当前推荐口径

对外沟通建议统一成下面这句话：

> 我们当前通过 GitHub Actions 定时调用受共享密钥保护的管理 API，记录用户统计日快照，并自动补齐最近 7 天的缺口；其中新增用户、生成量、Auth 审计可严格回补，活跃/覆盖率/高频分层因只有 `user_last_activity` 最新状态，历史补洞为 best-effort。
