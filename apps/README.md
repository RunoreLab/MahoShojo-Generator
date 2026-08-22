# 应用边界占位

`apps/` 是未来运行时与部署单元的目录。本阶段只建立目录说明，不搬迁根应用源码，也不声明应用拆分已经完成。

长期目标边界如下：

- `web`：现有 Web 产品的未来独立应用边界；
- `admin`：管理端应用；
- `api`：面向 API/服务端能力的应用边界；
- `d1-gateway`：D1 网关 Worker；
- `arena-room`：Arena 多人 Room Worker/ Durable Object 部署边界；
- `desktop`、`mobile`：桌面端与移动端应用边界。

当前生产应用仍是仓库根目录的 legacy root app。`apps/` 下的 README 或空目录只是路线图占位，不等于 MONO-002（每个应用拥有独立 manifest、命令、环境与发布入口）已经完成。应用之间不得直接导入彼此内部源码，共享能力应经 `packages/*` 或协议边界提供。
