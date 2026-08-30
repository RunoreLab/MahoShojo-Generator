# Admin 应用边界

`apps/admin` 是 G3-P0 建立的独立 Cloudflare Worker/Web Standards 管理端边界。当前只有 liveness、静态安全壳和
`/api/admin/session`；没有业务 read model、mutation、数据库 binding、生产 hostname、Access policy 或自动部署。
它是 Phase 3 之前的 downstream pre-work，不表示 G3-1 或生产 Admin 已经解锁。

## 信任模型

```text
Admin browser
  -> same-origin apps/admin Worker/BFF
  -> verified Cloudflare Access JWT
  -> stable issuer + subject + human/service kind
  -> internal principal + explicit route capability
  -> later versioned service/repository contract
```

- `Cf-Access-Jwt-Assertion` 必须通过 RS256/JWKS、`iss`、`aud`、`exp`、`sub`、`type=app` 验证；header
  存在本身不可信。human 使用非空 `sub`，service token 使用空 `sub` 与 `common_name`，不得互相降级映射。
- email 不参与 principal key；human/service identity 分开映射。Remote JWKS verifier 按经过验证的部署配置有界复用，
  避免每请求重建 key/cooldown cache。
- route policy 集中声明 `read/mutation`、action、capability 与 action-specific audit requirements；GET mutation、
  未声明 route、未知/disabled principal、缺 capability 全部 fail closed。
- future mutation 统一要求精确同源 `Origin`、`Sec-Fetch-Site: same-origin`、自定义 CSRF header 与 JSON。
- 当前没有浏览器 JS bundle；服务器配置、JWT、JWKS、principal external identity 不进入响应。
- audit envelope 的 actor、authn safe ref、capability、action、event/request ID 与 timestamp 均从已验证的 server
  context/registered policy/runtime 派生；调用者只能提供严格 allowlist outcome，canonical result 为
  `success/denied/conflict/failed`。G3-P0 没有业务 mutation 或持久 audit sink。
- `escapeUntrustedText` 只适用于 HTML text node seam，不能用于 script、style、HTML attribute 或 raw HTML sink；
  后续 UI 应优先使用框架默认 text rendering，并为每个真实 sink 建立 context-specific sanitizer/test。

## 配置与生产边界

`wrangler.jsonc` 只提交无效 `.invalid` issuer/JWKS、`UNCONFIGURED_DENY_ALL` audience 和空 principal 清单，
同时保持 `workers_dev: false` 且不声明 route。真实环境值必须在获得生产授权后按环境配置，并重新运行
`pnpm run types`；生产 Access/Tunnel/direct-origin probe、bootstrap/revoke/break-glass、audit retention 与 hostname
均属于后续 G3-6，不能用本地 JWT fixture 代替。

配置名：

- `ADMIN_ACCESS_ISSUER`
- `ADMIN_ACCESS_AUDIENCE`
- `ADMIN_ACCESS_JWKS_URL`
- `ADMIN_PRINCIPALS_JSON`

`ADMIN_PRINCIPALS_JSON` 记录必须包含内部 `id`、`externalIdentity.{issuer,subject,kind}`、`status` 和最小
`capabilities`；不得改成硬编码邮箱或浏览器开关。

## 本地验证与回滚

```bash
pnpm --filter @mahoshojo/admin run types
pnpm --filter @mahoshojo/admin run test
pnpm --filter @mahoshojo/admin run lint
pnpm --filter @mahoshojo/admin run build
pnpm run check:admin-boundary
```

`build` 只执行类型检查与 `wrangler deploy --dry-run`。不得在 G3-P0 执行 `deploy`。回滚仅需移除/回退
`apps/admin`、Admin inventory/check、root manifest/lockfile orchestration、`.gitignore` 日志例外、规格引用修正和相应
文档，不触碰 `apps/web`、`apps/api`、Phase 2.5、schema 或生产数据。
