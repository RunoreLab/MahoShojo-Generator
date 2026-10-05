// 已迁入 @mahoshojo/ui-web/card-library（D5.0e 共源）；本文件保留既有导入路径。
// 注意：本文件会被 app/api/* 的服务端模块导入，必须走 RSC 安全的纯数据子路径，
// 不得改回 './card-library' 桶出口（其模块图含客户端组件，next build 会失败）。
export { normalizeOnlineDataCardVisibilityCompat } from '@mahoshojo/ui-web/card-library-visibility';
