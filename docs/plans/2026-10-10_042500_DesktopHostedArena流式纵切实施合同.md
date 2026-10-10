# Desktop Hosted Arena 流式纵切实施合同

状态：**有限实施合同已冻结；后继 C1-SSE 源码已按本合同实施并通过独审及完整本地 CI**。合同首次提交仅含文档；当前交付与未验边界见[验收报告](../reports/2026-10-10_053300_DesktopHostedArena流式纵切验收.md)，不代表正式服务部署、真实凭据联调或 D4 执行开放。

基线：C0 最终本地 `5a72badb9f1c063afb7276057fd1914571df8cd2`，tree `6cfeef2a0d1a032fd28ca3a53bd83e9733119314`；其产品 `f4e3b5cd8a84551cad0160107c2dfd7997f34ec2` 已完整本地 CI 通过。C0 发布事务独立，本合同不进入其 manifest。

## 1. 已获许可与有限交付

维护者已同意将 `https://homura.colanns.me` 纳入 Desktop Arena 固定受信目标，供创建、恢复和停止使用，复用现账号认证与预设供应商 BYOK；只有创建可携选定 Key，恢复/停止不携 Key，禁止自定义服务器地址或静默切换账号。当前许可限设计、代码接线、合成凭据和本机服务验证。真实密钥联调、账号操作、生产部署、用户设备任务仍另行确认。

首片 **C1-SSE** 接通 `/battle` 与 `/arena` 普通四模式的真实流式 Hosted 创建、lookup、status、resume、停止、结果/活动叙事历史和显式本地保存。执行/session、受控页面和结果视图复用现实现，恢复编排消费 [C0](../reports/2026-10-10_041243_Arena可恢复客户端共源验收.md)，不新增平行 Arena 执行核。

| 组合 | 首片边界 |
| --- | --- |
| 未登录 + system / preset BYOK | 支持；Native 固定匿名 actor，系统无需 Provider Key |
| 已登录 + system / preset BYOK | 支持；冻结当前账号，服务端验证期望账号，失败不降为匿名 |
| Hosted + custom Profile | 不支持；保现拒绝，不把 Direct URL 交服务器 |
| Markdown / 自由 Web / Web Package | 支持实际 SSE 合同；Web 仅安全源码、包校验/库/导出，D4 执行仍关闭 |
| Hosted 非流式完整 JSON | 明示后继，不把 SSE 包装成结构化响应；Direct 两输出不受影响 |
| Hosted 角色签名更新 | 明示后继；首片不调用 Direct unsigned projector，不更新源角色卡，不展示看似有效的写历战/状态勾选 |

角色历史/当前状态**读取**仍是合法输入；两项写入在 Hosted 首片有效请求中为 false，UI 分别禁用并解释原因，保留用户的 Direct 偏好以供切回。活动叙事历史写入是另一个设置，沿现默认 false、合格完成后更新活动草稿、入库显式保存的语义。Strict、多人、连续故事、插图、线上包市场不并入本片。总计划中的非流式和权威角色更新需求未关闭。

## 2. 权威来源与必须先闭合的身份缺口

依据 [原前置合同](./2026-10-10_034300_ArenaHosted恢复共源与原生接线前置合同.md)、[G25R](../specs/2026-08-25_205143_G25R可恢复Arena生成审查整改设计.md)、[双生成契约](../specs/2026-08-31_063734_Arena双生成契约回归修正规格.md)、[Hosted 路由修订](../decisions/2026-09-07_220000_Hosted路由预检与多人实时链路故障降级修订决策.md)和 [预设 BYOK 修订](../decisions/2026-10-09_010600_DesktopAI预设独立身份与服务器BYOK修订.md)。实现时同步适用的 Desktop 安全规格，不以本计划替代 accepted 规则。

正式 Hono `apps/api/src/arena-generation/runtime.ts` 注入真实 Redis replay store、D1/R2 terminal、签名和 finalizer；Next unavailable replay store 不构成可用创建来源。这里固定 primary，不探测后改投 DR，也不使用预览或稳定别名作兜底。

当前 `node-runtime/authenticated-user.ts` 的 Cookie 验证不可用可返回 anonymous，`arena-generation/actor.ts` 随后可签发匿名 actor。Native 在旧项目 origin 查过登录状态不能证明同次 Hono 请求的账号。因此 C1 必须先增加以下窄闭环：

1. Hono Arena 支持可选、版本化的**期望账号断言**。Native 从冻结的真实 StoredSession 派生正安全整数 userId；服务端必须实际解析为 authenticated 且严格相等，缺认证、错账号或坏格式拒绝，不能进入匿名链。此断言不授予身份，不替代 Cookie，不使用无效匿名 token 哨兵。
2. create、lookup、status、resume、按 generationId 或 requestId 停止均执行同一断言；原 Web 不传时保持旧行为。只改 Arena actor 边界，不重写全站认证优先级。
3. **创建及跨重启首次恢复前** Native 必须验证固定 Hono 的 Arena 专用能力版本与断言支持；缺字段/旧版本/不支持/不可达 fail closed。可扩现 `/api/hosted/dr-readiness` 的 Hono 声明及对应受检合同，不能仅复用旧 `g25e1-v1`，不能等 create 后回显才发现旧服务忽略断言。该声明仅在对应实现真实装配时提供，Next 不伪报。
4. 能力探测为无 Cookie、actor token 和 Provider Key 的公开 GET；不能被 renderer 指定 origin/path。能力声明不等同线上健康保证，实际 create 仍执行 Redis/签名/finalization readiness；本片不部署服务，旧线上版本在升级验收前应显示不可用。

## 3. Native 窄操作与出站边界

新增 Arena 专用合同/fixture 与 Rust transport，不把 Arena 塞入六族通用 route 或全局放宽其预算。renderer 只能给操作、受检公开 ID/cursor、scope、已冻结业务输入与 system/preset 选择；不接受任意 URL、method、header、Cookie、apiKey、secretRef 或 privileged server authority。主窗 capability 只列必需的有限命令，包窗和其他窗口不获权限。

| 操作 | 固定 Hono HTTP 映射 |
| --- | --- |
| create-stream | POST `/api/arena/generate-stream`，固定 SSE 格式及 requestId，至多一次派发 |
| lookup-request | GET `/api/arena/generation-requests/{requestId}` |
| status | GET `/api/arena/generations/{generationId}` |
| resume | GET `/{generationId}/stream`，仅受检 `after` cursor |
| stop | 已知 ID 时 POST `/{generationId}/cancel`；未知 ID 时 DELETE `/api/arena/generate-stream`，固定 requestId/reason |
| detach-local | 只终止本机订阅/等待，不发服务器取消、不冒称 producer 已停 |

所有控制操作沿原 actor、目标和请求身份。连接和短控制请求沿现 Native 15 秒边界；服务器停止确认沿 C0 5 秒独立等待，超时为未确认。长流沿现 Web 5 分钟无新内容/10 分钟总时长的**软提示**，不据此自动再 POST 或取消 producer；必要共源 timeout 纯函数时，环境变量读取留 Web adapter，不能把 node-runtime 整包引进客户端。

Native 在任何网络 await 前捕获真实账号/匿名凭据、预设/模型/生成参数和选定 Key，沿现 AIP 机制检查目录/协议。Provider Key 仅注入 create 的 server catalog BYOK payload；lookup/status/resume/stop 不读取 Provider Key，也不携 presetConfig 或 customProvider。所有重定向拒绝，错误/日志/IPC 不回传凭据、原始敏感请求或内部 Header。仅测试构建可沿既有方式用固定 loopback 替身，正式构建无任意 origin 开关。

冻结业务输入包括角色/团队、主辅情景/素材/Lore、故事、活动历史、输出格式及精确包 revision。判定配置交服务器一次物化，Desktop 不本地掷骰或上送 Direct adjudicationResults，重连不重掷。canonical WebPackagePromptProjection 沿现纯核从冻结 Base 构造，保旧非 builtin 包规则与字段预算；不上传整个 ZIP/资源目录，不让包决定出站目的地。

## 4. actor、生命周期与跨重启

- **账号**：用现 Native 账号 SecretStore，不新增长期 Bearer/activity token 交换。创建前、每个后续操作派发前校验当前 Native 会话仍符合冻结账号/凭据世代；切换/退出后旧任务不再发新操作或发布到新 scope。已经派发的 HTTP 不能被说成撤销。恢复须用户明确选择、当前账号与原 expectedUserId 相同，并再次通过服务端断言，不能默用另一个账号。
- **匿名**：首 POST 前由 Native 固定 bootstrap UUID 并保存到 Native-only SecretStore；服务端返回的签名 actor token 只由 Native 收集和保存。bootstrap UUID 本身也视为恢复凭据，不放入公开 pointer。token 不进 renderer、普通草稿、日志、错误、卡片或导出；不增加通用读取 secret IPC。匿名记录使用两个固定、既有受保护命名空间内的槽 `account-session:arena-anonymous:battle:v1` / `account-session:arena-anonymous:arena:v1`，绑定 product + requestId，并原子替换 bootstrap/token；复用现 8 KiB secret 封套，异常明确失败。普通 Provider Profile 和 set/has/delete secret 命令必须继续拒绝该命名空间，验证覆写/删除注入不能碰到 actor 凭据。
- 匿名身份可以跨重启复用同 Native credential；失效/损坏/被删时显示恢复不可用，不能为原 request 换匿名 ID、换成当前登录账号或重复 create。已签发 token 过期后不得通过重新使用旧 bootstrap 绕过寿命；尚未收 token 的记录也保首次派发时间，不无限续用 bootstrap。已登录时也可由用户明确选择“以原匿名身份恢复”，Native只带该旧匿名凭据，不带Cookie/Bearer/activity token，并仍以当前会话世代阻止迟到；不得由通用客户端自动补Cookie。新匿名意图使用新身份。每产品仅一条可恢复意图；覆盖尚未终结或取消未确认的旧 pointer/匿名槽之前，须明确确认放弃其恢复，不把放弃说成服务器已停止。
- 生成开始前持久化版本化**非秘密恢复 pointer**，沿现 `GenerationDraftStorage`、坏数据保护和恢复确认机制；固定键 `mahoshojo.desktop.arena.battle.hosted-recovery.v1` / `mahoshojo.desktop.arena.advanced.hosted-recovery.v1`，各仅1条、序列化JSON最多16,384个UTF-16 code units（沿现JavaScript `length`测量）。它与现4 MiB正文草稿独立，不能因大正文保存失败顺带丢失恢复身份。只含 product、固定 Hono 协议版本、requestId/generationId、cursor、语义 body hash、actor kind（账号另含 expectedUserId）、输出合同/状态及必要短显示标识；Native固定槽须同product/requestId才可恢复，不允许pointer选任意secretRef。不含 Key/Cookie/token/匿名 bootstrap，不新建聊天或通用恢复数据库。
- pointer先保存；其actor意图及账号必须与Native实际捕获身份相符才可POST，不得捕获到新账号后静默改写归属。Native随后在任何网络await前冻结身份/Key并保存匿名秘密，保存失败零POST、pointer明确未派发。pointer 保存失败不调用 create；已派发后签名 actor token 的持久化失败单列恢复凭据保存失败，内存凭据继续服务原任务；不得为补存再次 create。生成后正文草稿/本地卡保存失败不把完成说成失败，保内存原文和完整导出。pointer 与结果草稿的完整性分开：pointer 存在不保证输出仍在服务端保留。损坏/未知版本不覆盖原件、不自动生成。
- C0 核用于流式创建与恢复；明确的 resume-only adapter 永远不允许调用 create。用户恢复 `cancel_unconfirmed`/终态缺正文指针时，不得因 C0 旧状态筛选不接受而落回首次 POST；需只读查状态/显式续流并用拒绝 create 的 port 做硬门禁。
- 宿主同步 flight 锁与 Native 同product执行锁覆盖准备、持久 pointer、能力探测与派发。共享 Native 关闭 handle 沿现唯一 guard 聚合 busy/dirty；配置/账号/路由变化、卸载及迟到回执均守 owner。不再安装第二套关闭守卫。

## 5. 输出、恢复和副作用资格

完整 SSE ID/事件和公共 generation 握手由 Native 受检传递，C0 做完整块/cursor 去重与有界恢复。首响应未知、HTTP 头过大或断线后仅按同 requestId lookup/GET resume；404/503 不是重新创建的证据。普通 detach 不停止服务端；202 表示 stop 被接受、409/finalizing 与404/超时表示不同状态，不能把连接状态 `cancelled` 文案当作服务端已终结。

C0连接状态不授予业务完成权威；Native/宿主仍须独立受检done的实际status/ok和当前格式资格。UI 分开显示连接状态、服务器状态、正文完整性、附加 metadata 完整性、本地保存状态。仅服务器合格 completed、正文符合当前格式且原 scope 仍有效、未发显式 stop 时，才允许自动追加本次活动叙事历史；generationId/首次完成候选时间固定，重连/保存重试幂等。取消、EOF、failed、unknown 或仅202无完成副作用，已收原文仍可导出。跨重启恢复不自动重放旧候选副作用，正文可查看/导出并显式保存。

现 `X-Mahoshojo-Stream-Meta` 是 percent-encoded JSON，含输入引导/角色引导、记者和本次判定等；其大小不受 4 MiB 模型输出上限约束，也未承诺所有12 MiB输入的完整HTTP头均能传达。首片保现服务协议：只提取受检公共字段，仅接受值长度不超过64 KiB ASCII字节且 percent-decode 后不超过64 KiB UTF-8字节的可选 metadata；缺失、格式不合法或过大时保正文并标记“本次判定/记者等附加元数据未取得”。不能写成判定未执行、在本地重掷、补造 winner 或把缺失投影当原完整 JSON。Native 不将任意响应 Header 转交 renderer。

终态 durable fallback 主要恢复 snapshot + done/error，不保证最初 headerMeta、原 companion JSON、签名 updatedCombatants 齐全。到期、未归档、finalization pending、producer_lost 明示，保已读原文。报告/history 及完整导出携带这些缺失标记，不夸称完整服务器归档已恢复。

Web Package done 的 Artifact 只含 ref/target/digest，不含 generatedContent；须用正文与精确 Base 通过现 overlay/target/schema/digest 校验。缺精确 Base 不自动 latest，兼容重放需显式确认。自由 Web 的 completed、framing 与可运行资格继续分开，首片不打开运行 port。

角色签名更新在首片显式不可用，不能调用本地 Direct projector 后保留官方签名或覆盖源卡。报告/叙事历史本地文档沿 unsigned 且可记录 hosted 来源；不因执行位置赋 official-signed。后继真实鲜活签名响应才可沿现 provenance 规则处理。

## 6. 分项预算与协议夹具

保 canonical 32角色、256引用、模式最低人数2/2/1/1和12 MiB业务请求。现 Hosted `runtime.ts` 在 `projector.push` 前累计模型body原chunk/tail与reasoning UTF-8字节，4 MiB硬限包括原控制尾；该服务端预算保持。Native只能独立校验去重后的当前正文+reasoning≤4 MiB，不能从已截到8000单位的meta.raw重建原控制尾总量。角色/素材/历史不裁剪，业务预算与 wire/IPC/存储各自校验，不改六族全局限额。

- Arena 单 SSE 事件的候选 wire 上界为 `6 × 4 MiB + 64 KiB`：JSON最坏转义6倍；meta完整内容仍在4 MiB来源输出内，额外 raw摘要最多8000 UTF-16单位，最坏转义不超过48 KiB；余量覆盖固定字段/受检 Artifact。这是本片新增的受检传输预算，不是已有server常量，须由真实极限fixture证明后冻结到TS/Rust同一fixture；若实测组成超出，退回审查，不直接截断或拍更小值。
- 普通 telemetry 和 snapshot.telemetry 沿现 `projectArenaGenerationEventForClient` 投影；不应重复计算已剥离的 reasoning。真正 D1 fallback 的 reasoning 为空、usage/model规范化。active snapshot 的2 MiB是其JSON序列化预算，不是所有fallback snapshot的上限。
- IPC将大事件/原始SSE拆成有序传输片，每片文本最多64 KiB UTF-8字节，含元信息的最终JSON封套最多512 KiB UTF-8字节（这是本片独立IPC政策，不是现旧Hosted SSE帧限或Tauri固有限额）；按字符边界拆分，保事件/请求序号与完整SSE ID。最坏6倍文本转义为384 KiB，仍须以最终封套实测而非只验data长度；不走base64。Native和TS同夹具验证完整重组、序号缺口/重复、截断和极限转义，不凭mock自造wire，也不放宽旧六族解析器。
- decoded累计预算对**去重后的当前正文+reasoning**计算；snapshot是替换，不是再加一遍。附加meta/meta_error单独受每事件wire限，只保最后一个受检块，不能累积历次副本或在新错误块后回退旧有效meta；telemetry/snapshot同样按受检投影与替换语义有界。不能用简单24 MiB会话累计wire预算把正常重播/多次snapshot拒掉。对畸形帧/无界缓冲明确协议失败，保已收到的原文，禁止再次create。
- headerMeta采用第5节独立64 KiB输入/解码预算，超过后按缺失态处理，不降正文上限。本地卡仍4 MiB文档封套，活动draft仍4 MiB字符；存储失败与生成完成分开，完整原文留内存可导出。

## 7. JSON与权威角色更新后继，不藏在首片

`arena-companion/service.ts` 返回 report、完整 updatedCombatants 与顶层impacts。`domain/arena-post-battle.ts` 会在最多32个角色中重复participants/headline/winner/场景/引导；字段没有独立短字符串上限。一个约1 MiB的合法headline就能产生约32 MiB历史扩张，仍小于模型4 MiB。因此不能从现输入/模型预算推导16或32 MiB的完整JSON封套。后继须独立证明整个companion响应的容量、分帧与总内存；分帧不自动解决总量，不截断角色或冒充原完整响应。

现 Web 流式角色更新调用固定 Next `/api/arena/update-combatants-after-stream`，依据 owner、completed/finalized、generation provenance 和冻结 effects 再签名，并非按客户端meta随意投影。Hono当前路由目录没有此入口。后继可评估固定受信Next reconciliation的现协议与同actor来源，但须独立合同；不新增任意代理、认证旁路或第三种角色权威系统。匿名token的跨来源使用尤其不能从此Hono许可推定。

## 8. ownership与实施顺序

| owner | 范围 | 边界 |
| --- | --- | --- |
| 合同/服务身份 | contracts新增Arena Hosted窄schema/fixture；Hosted actor期望账号断言、Hono真实能力声明及对应tests；必要accepted规格精确修订 | 不重写Web默认auth/DR策略、不部署、不新增token交换 |
| Native transport | 独立Rust Arena模块、原cloud/secret最小内部复用、有限main-ui命令/桥/loopback与source-hash harness | 不扩大旧六族/任意origin、无renderer secret、不触包窗capability |
| 共享输出/UI | 现纯解析/投影与C0真实回用；必要的受控禁用原因/恢复状态/附加metadata缺失view ports | Web默认行为保持，不复制表单或结果，不新建权限中心 |
| Desktop宿主 | 同一Arena session/adapter接线、独立product pointer、能力/模型/账号scope、结果/history与显式保存、真实路由DOM | 不开非流/权威角色更新/Strict/D4运行；不绕Native直fetch项目API |

先冻结schema/同语言夹具与身份能力门禁，再Native合成loopback，再Desktop真实页面薄接线；每片独审，最终共同冻结后统一完整CI。消费者原子前不登记Hosted可用。root调度heavy与唯一发布窗口，C0待批事务原样保留。

## 9. 验收与退出

1. Hono真actor/default service调用链：正确/错误/缺失Cookie、错账号、无效断言、匿名、禁用用户；带断言全部fail closed，Web未带旧金样不变；旧/缺能力声明零create。
2. Native真模块+合成loopback：四身份/资金组合，create-only Key、scope改变/注销/secret变化、重定向、错误净化；控制请求零Provider Key，任何canary都不进IPC/log/pointer/export；无真实凭据或外部上传。
3. create最多一次；初始未知、404/503、重复ID、半包/坏cursor/重复snapshot、重连默认预算、停止202/409/404/超时、detach、terminal/producer_lost/到期；跨重启pointer+模拟SecretStore同actor恢复零create。
4. 四模式 × 两产品 × system/preset × 匿名/登录的真实页面到合成loopback；Markdown/自由Web/包HTML/JS/CSS/JSON目标按真实支持分层覆盖，服务端判定一次，附加metadata缺失不重掷、不补winner；Hosted非流/角色写入明示不可用且Direct原旅程回归。
5. 完整4 MiB decoded输出/最坏转义/大meta/raw摘要、snapshot替换与重播、请求12 MiB边界；本地4 MiB封套失败保原文/导出，history保存重试幂等、墓碑不复活，唯一close handle与准备阶段失败均有实际断言。
6. 定向绿与独审后整合完整 `ci:verify`，起止SHA/tree、日志和exit落盘；Rust实际源码hash、合成loopback、模拟IPC/DOM各自列证据，不以其声称真Tauri/Windows/OS凭据/线上账号或模型质量已验。

本合同完成只解锁已授权范围的源码实施。正式服务升级/能力声明的部署、真实身份与Key联调仍未执行；Windows集中验收独立，D4内容运行门禁保持。若某项无法满足，明确留对应组合不可用，不能换身份、源、输出模式或执行位置来制造成功。
