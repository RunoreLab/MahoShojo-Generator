# user_auth_links 回填冲突样例（2026-02-25）

## 1. 本轮执行结果

在当前本地环境尝试执行：

1. `npx tsx scripts/backfill-user-auth-links.ts --dry-run true --batch 200`
2. `npx tsx scripts/backfill-user-auth-links.ts --write --batch 200`

两次均因缺少 `CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID` 失败，未进入真实数据扫描阶段。

## 2. 冲突样例模板（基于脚本输出结构）

以下样例是脚本 `--verbose` 模式下的真实输出结构模板，待测试库实跑后替换为真实 ID。

### 2.1 邮箱歧义：`skip-ambiguous-email`

```json
{
  "tag": "skip-ambiguous-email",
  "authUserId": "ba_user_xxx",
  "email": "same@example.com",
  "candidates": [101, 205]
}
```

处理建议：

1. 人工确认保留的业务账号（通常按最近活跃或主账号规则）。
2. 将非保留账号做合并/停用后再重跑回填。

### 2.2 用户名歧义：`skip-ambiguous-username`

```json
{
  "tag": "skip-ambiguous-username",
  "authUserId": "ba_user_xxx",
  "username": "alice",
  "candidates": [17, 223]
}
```

处理建议：

1. 若邮箱可判定，优先按邮箱定向补链。
2. 若无法判定，先标记为人工工单，不在自动回填中强行落链。

### 2.3 业务用户已被占用：`skip-business-already-linked`

```json
{
  "tag": "skip-business-already-linked",
  "authUserId": "ba_user_new",
  "matchedBusinessUserId": 88,
  "existingAuthUserId": "ba_user_old"
}
```

处理建议：

1. 先核对 `existingAuthUserId` 是否为有效主链路。
2. 若需切换绑定，先执行人工解绑/迁移，再执行 write-run。

## 3. 回填后核验 SQL

```sql
-- 未建链的 auth 用户数量
SELECT COUNT(*) AS unlinked_count
FROM ba_user u
LEFT JOIN user_auth_links l ON l.auth_user_id = u.id
WHERE l.id IS NULL;

-- 一对多/多对一冲突检查
SELECT auth_user_id, COUNT(*) AS c
FROM user_auth_links
GROUP BY auth_user_id
HAVING c > 1;

SELECT business_user_id, COUNT(*) AS c
FROM user_auth_links
GROUP BY business_user_id
HAVING c > 1;
```

## 4. 下一步

1. 补齐测试库 Cloudflare 凭据后，先执行 dry-run（建议 `--verbose`）。
2. 归档真实冲突样例到本文件，替换模板数据。
3. 审核冲突处置后执行 write-run，并记录最终统计。
