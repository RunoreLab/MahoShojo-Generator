# Desktop Arena Web 源码与精确包旅程验收

状态：D5.1b b2-B1 源码交付，依据[有限合同](../plans/2026-10-10_013700_ArenaWeb格式与隔离运行接线合同.md)、[唯一 Desktop 计划](../plans/2026-09-30_160100_Desktop客户端阶段实施计划.md)与现役 Web/Hosted 语义。最终源码独立审查与完整本地 CI 通过；D4 执行及真实宿主待验项保持开放。

## 交付与真正共源

`/battle` 与 `/arena` 继续使用同一 Direct/session 核及各自独立草稿 owner。新增 Web 格式、内置/本地包选择、ZIP 导入、生成目标验证、安全源码、原件/Base/目标导出及精确结果恢复。普通四模式与两种传输均可使用；Markdown/结构化旧旅程保持。Hosted 仍明确不可用，不自动回退客户端。

- 自由 Web framing/display title、现役 Hosted strict stream projector、包最终资格进入共享 `ai-core/arena-generation`。Web 与 Hosted 原调用点实际回用，没有把 framing 当 HTML sanitizer。
- `web-package` 增加已冻结 base 的 overlay 创建、宿主可注入的 replay 来源和目标下载后缀 helper。精确 id/version/digest、target/media/schema、内容摘要与预算仍由既有纯核验证。
- 格式 selector、包选择/详情、风险、源码/附言/操作与重放修复控件来自 `ui-web`；Web wrapper 实际回用。安全源码叶复用既有 `result-card` / `result-content` 与原 Web 报告的共源深色背景，按钮/说明/风险保持对应文字对比层级；DOM/CSS 契约检查不代替实机视觉验收。原 Web consent、Trusted Same-Origin、iframe/fullscreen、IndexedDB 与迁移/偏好仍留在原宿主。
- Desktop 使用 `IpcWebPackageRepository` 和现有主 UI 下载通道；没有新增 Native command、权限、数据库、聊天库或任意端点。依赖变更仅为共享 UI 声明已有 workspace `web-package`，lock importer 同步，无新外部 resolution。

## 完成、结果与保存

自由 Web 保留现役 Hosted 行为：合格 stop 可以完成，但不完整 HTML、缺失或非法机器元数据分别影响文档识别与角色效果，不把“生成完成”当成“可运行”。不从 DOM/正文推断 winner；无有效元数据不应用角色效果。

包输出使用首个完整且唯一的尾控制块，严格要求 v1、非空 headline/winner 与冻结 target 契约。重复/尾后非空、非法 schema/target/digest 或异常终态均不产生成功 artifact、战后候选或自动历史副作用；没有为修复包输出额外调用模型。rawText、规范 target、reasoning 与机器元数据分别保留，完整 JSON 可导出所有原文。

结果 format 与 `BattleReportRenderSnapshotV1` 独立于下一次输入格式，草稿恢复不重放生成、重建旧候选或自动落库。叙事历史仍为普通完整正文 entries；它不是可执行战报库。开启写历史时只追加活动草稿，history 卡与 unsigned 角色副本仍由用户显式另存；源卡不覆盖、墓碑不复活。

包导入默认仅当前页暂存；“导入时保存到本地库”默认 false，只控制本页后续导入。显式单包重导入沿既有 put，同 digest 不增重复记录；已删除记录先明确确认恢复。整库导入的 putIfAbsent/existing-wins 规则不变。真实写失败保内存原包和导出，写成功但列表刷新失败明确提示已保存/已删除并建议重读，不错误提示重新写入。

输出恢复先精确 revision；missing/mismatch/rejected 留安全源码。兼容候选显示版本和 digest，多候选需选择，明确确认后仅生成工作副本；历史 artifact/provenance 不变。重新导入原 ZIP 可恢复 exact，规范化/default/未知资源诊断在成功后仍可见。不会自动选择 latest 或联网获取未知包。

三个文件出口分别标注：原 ZIP 保字节；标准 Base ZIP 保原 manifest/资源，不包含生成 overlay；生成目标只导出其验证后的内容。完整 JSON 另保原始输出及 snapshot。HTML/JS/CSS/SVG 目标下载前说明外部打开风险并确认；二进制 ZIP 下载复用 `<a download>` 与延迟释放对象 URL，不授包窗下载能力。

## 围栏、预算与执行门禁

任务冻结输入、模型、目标、requestId、判定与包 projection；包读取/解析、保存、删除/恢复与 UI 消费 await 后核原 scope。Ipc 包删除/恢复内部 get 后、真实 transition 前也有可选 owner 围栏；已派发写入只能忽略晚回执，不能声称已撤销。重复点击同步锁，暂存 ZIP、导入/保存和未提交设置纳入同一个 Native close guard。

原业务 12 MiB、decoded text+reasoning 4 MiB、32 角色/256 总参考项和模式最低数量均未缩减或放宽。草稿 4 MiB 字符、卡库 4 MiB 完整封套、包库存档 64 MiB 与包记录 4 MiB 各自独立。超限/磁盘失败不裁截原文，内存完整导出仍可用。64 MiB 单包保存预算在本片验证为边界判定及既有存储协议回归，不冒称已做真实 64 MiB Windows 文件往返。

本片运行 port 固定不可用，真实 DOM 流程均为 zero begin/append/open。主界面没有执行性 iframe/srcdoc/HTML 注入，不导入 Web browser renderer；安全源码与说明不加载输出中的图片、脚本或其它隐式资源。构造纯 instance、risk scan 或通过 schema 都不是运行授权或安全认证。

D4b-r2 运行期门禁保持 PENDING。零 Native capability 不等于浏览器零网络；当前 sandbox CSP 不完整限制 fetch/图片/WebSocket，网络目的地/协议及真 WebView 探针仍须后继闭合。未来运行按逐次明确确认的既定最小提案，不复制长期信任或 Desktop Trusted Same-Origin；本片未改变系统安全配置。

## 验收证据

冻结产品：`7562454c60641adfc2c29cf8a64d2cebf5549811`，tree `6729a3080546ad5b2743cc3f53c005469a81f747`。完整本地 `ci:verify` 于 2026-10-10T02:43:33Z–2026-10-10T02:51:18Z 退出 **0**，起止 SHA/tree 相同、工作树干净，之后仅补本文与导航/计划。

完整门禁包括 workspace 测试/lint/build、Desktop Vite、Web Next 生产构建/Hosted DR bundle 与 root 检查：contracts 39 文件/337 项、domain 42 文件/311 项、web-package 14 文件/239 项、ai-core 23 文件/241 项、Hosted runtime 85 文件/766 项、ui-web 78 文件/675 项、Desktop 108 文件/1663 项、Web 464 文件/3130 项、root 34 文件/274 项。Web lint 的既有 3 条导航警告保留、0 错误；没有关闭门禁。

此前 `750b94a18` 首轮完整 CI 于 2026-10-10 02:27:02–02:34:52 UTC 退出 0、前后同源。后续源码复核发现安全结果卡缺少原 Web 深色 surface，导致白色操作/附言在浅色宿主上对比不足；以最小共享容器、原 Web 背景常量和风险文字层级修复，再对新冻结源完整重跑。首轮记录保留，不以旧源通过替代最终验收。

冻结前 Desktop 7 文件/162 项通过；样式修复后共享 DOM 6/6、真实 Desktop 整页 52/52、双端 CSS 构建契约 7/7 与两端生产类型检查再次通过，生产源码与含新增 TSX 的定向 TypeScript、ESLint、边界及 diff 检查通过；合同、纯核、共享 UI、包库、Direct/session 与最终宿主均独立审查通过。

- 真实 Router、共享控件、session、Direct adapter：两路由 × 四模式 × 两传输 × 自由 HTML/内置包的完成与安全源码。自由 Web 矩阵另验显式历史保存/库重开；包恢复、导出与重导入由下面的真实专项目标流程验证。
- 本地 ZIP/库再开、JSON/JS/CSS 目标、未知 opaque 资源、原 ZIP 字节与不含 overlay 的 Base；缺精确版本、双候选显式兼容、再导入 exact、成功规范化诊断。
- 包输入冻结、缺 meta/不完整文档、错误控制尾/schema、cancel/EOF/晚包、目标修改受阻及取消后切换、重复点击、保存失败、scope 变化后的晚导入、原生 close handle 唯一。
- Web 输出 decoded content+reasoning 恰好 4 MiB 与 +1 字节；既有完整卡封套恰好 4 MiB/+1、草稿超限原文与损坏保护继续回归。

页面执行使用模拟 Tauri invoke/Channel，再经 Node loopback 返回合成输出；这不是真实 Rust/Tauri 或真实模型验收。Native 源未改，既有 B1 Rust fixture 只读复用；本轮完整本地 CI 不等于远端精确 SHA checks 通过。

## 待验、后继与回退

Windows/WebView2、真实 Tauri/OS 凭据、文件选择/下载、真实 SQLite 重开、关闭/导航、视觉/深浅主题与真实模型质量继续待验。D4 执行 ACL/Channel、foreign instance/导航/权限/下载、Range/RSS/回收/资源与网络出口探针仍按原 runbook 完成。本片没有调用真实模型、输入真实 Key、使用用户设备、付费任务、云写入或生产部署。

b2-B2 仅在运行政策与对应 D4 门禁闭合后接既有独立 `webpkg-*` 窗口；不以当前诊断页、mock 或静态检查开放产品执行。Hosted、连续故事、插图、Strict、排位和多人继续各自合同，不把本片称为完整 b-2 或整个 D5.1b 完成。

回退可撤回 Web 格式选择和新宿主装配，保留现 Markdown 旅程、两页草稿与本地包库。共享纯核/UI 与 Web wrappers 按依赖整组回退；不要删除用户已保存的包或结果原文。
