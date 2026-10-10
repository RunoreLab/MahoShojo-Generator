# Desktop Hosted Arena C2 非流报告实施合同

状态：本合同已独立审定并用于C2实施；形成时的调查数据与历史状态保留。最终源码、容量链及完整CI见[交付验收](../reports/2026-10-10_080500_DesktopHostedArena完整非流报告验收.md)，真实凭据、Windows与后继能力未随源码验收关闭。
基线：已发布 c3da377e3e44372bc86d451f938b6bcf71b42f90 / tree198f36410f59b3d66362664b090cad3dcd2ae448。

## 1. 范围与已接受前置

在原 `/battle` 与 `/arena`、普通四模式、匿名/登录 × 系统/预设 BYOK、Markdown/Web 的矩阵中，接通真实 Hono non-stream companion 报告。继续固定 writeArenaHistory/writeCurrentState=false；这不是取消总计划中的签名角色需求。读取角色历史/状态及活动叙事历史、本地显式保存、精确 Web 包/安全源码沿 C1，不开放 D4。

实际 Web 非流调用是 `/api/generate-battle-story`。它经 `packages/hosted-runtime/src/arena-companion/service.ts` 的真实 generation service 及 server-owned delivery context 选择 structured-report（Markdown）或现 Web contract，然后收完整终态、构造 report/updatedCombatants/impacts/adjudicationResults JSON。Desktop 不把一次 SSE 结果伪装成原 companion JSON，不恢复旧六族 4 MiB JSON 通道，也不改 Provider 的 structured→text JSON 窄兼容策略。

首片沿已批准 Hono 固定目标、账号/匿名身份及 create-only Key，不调用 Next reconciliation，不要求任何新账号、密钥传输或付费任务。需要维护者决定的额外目的地匿名凭据路由只属于后继角色更新，不阻本片。

## 2. 已证差距与预算门禁

- 12 MiB 是最终创建 HTTP body；模型正文+reasoning+控制尾仍 4 MiB。两者不等于 companion JSON 封套。
- free Web 在 report.webHtml 与 report.article.body 各放一份正文；控制字符 JSON 转义可能使这两份接近 48 MiB。structured source 自身已是 JSON，须计其原始转义字节，不能拿4 MiB解码值冒合法source。
- structured schema 的已知字段与顶层 normalized impacts 可能重复；write=false 的额外 impacts 是否被 strip 以真实 schema/runtime夹具为准。兼容旧 Markdown 报告解析可能使 headline/body/analysis/winner/conclusion切片重叠，不能按单正文算整个报告。
- metadata 的角色名称/引导、判定结果来自输入；非流 userGuidance 原200、characterGuidance原100保持。完整HTTP percent header另计，JSON成功上界不保证所有大header可传。
- 开启角色写入时还会重复 participants/headline/winner/场景等，32人/合法大headline会超过16/32MiB；此处仅作解释后继的对照，首片明确禁用。
- 以真实 runtime/companion、合成provider与signature、最大合法input/output、最坏转义/Unicode/metadata夹具及来源证明冻结本协议wire上界；另测总内存，不将wire预算当RSS阈值。不能任意设16/32MiB或裁剪合法字段，也不能全局放宽六族。
- 有界分片复用 C1 的 UTF-8 字符边界、requestId/sequence、64KiB文本/512KiB最终IPC封套原则；JSON总量须独立计量。分片不是模型SSE，也不消除 Native parse、raw保留、renderer重组/parse、导出副本的内存。数值与Node代理内存见[容量调查](../reports/2026-10-10_065400_Arena非流完整JSON容量调查.md)，Native/WebView尚未实测。
- 本地draft 4MiB字符/卡库单记录4MiB封套不变；生成成功与可保存分开。完整已验证body/metadata对象保内存可导出，超存储预算明确失败。

容量测量以最终同源清单为准：实际调用 runtime/materialize/companion，Provider/GenerationService/SignatureService 为合成 port，不访问网络或真实模型。最终近上限请求12,582,912 B，模型raw含控制尾4,194,304 B，原body62,913,791 B、完整decoded metadata12,583,357 B，新三字段封套75,497,200 B。全部11个freeWeb metadata字段与原头解码值全等、body与原JSON全等；64MiB不足。夹具generationId为27字符，真实默认70字符差43B，由固定骨架覆盖，不能把样例当绝对最大值。

其他测量说明重复来源：freeWeb双正文约50MiB；32人/1MiB标题对照write=false约1MiB、write=true约33MiB；structured空article.body保旧fallback可形成约8MiB完整JSON。source/reasoning+1B由真实runtime拒绝。4MiB structured reasoning是接口允许的合成回调压力证据，默认structured SDK实际保留text最多12,000字符，二者不冒称同一路真实Provider行为。

Node22.23.3同一最终62,913,791B响应的单次隔离进程：server构造峰值RSS438.7MiB，Response.json客户端峰值317.2MiB，保留raw再parse峰值308.5MiB；后两者稳定持有heap分别16.7/136.7MiB、RSS137.9/258.0MiB，raw存活多约120MiB。显式GC时机不同，不能据峰值次序称保raw更省内存。这里未模拟真实HTTP/Native IPC/WebView；此前666MiB混合server/consumer/重复统计峰值只保原日志，不作单端依据。

## 3. 生命周期与身份

1. 同一 Arena Native flight、actor secret双槽、公共pointer双键、同步锁和唯一closeguard。仅加专用枚举 operation；无任意URL/header/body凭据。创建前冻结输入/模型/Key/actor，pointer预写与Native intentOwnership双CAS不变，已派发不重新POST。
2. companion通常等完整生成/finalization后才回响应头；不能沿用SSE的15秒head期限。短连接/控制请求仍有界，等待生成从本次请求开始给共源5min idle/10min total软提示，不由提示自动取消、重POST或切源。
3. 用户stop仍按原requestId/generationId同actor走现取消；首HTTP响应头尚未返回时也须实测原requestId lookup→取得generationId→stop，不能等待JSON先完成。lookup未命中只能未确认，不重POST；202不等于终态。离页/账号scope变化只detach并拒晚结果，已经派发的HTTP不声称撤销。
4. JSON首次未知/响应截断/头过大/网络错误，保原request/actor，只lookup/GET resume。恢复编排消费C0 resume-only，不能另造重连状态机或用恢复口再创建；取消前后与C1语义一致。
5. 恢复pointer必须显式区分原交付合同（stream-markdown vs non-stream structured-report / Web），不能仅凭format=markdown把structured模型JSON作为Markdown正文。旧v1 pointer继续按C1 SSE解释；新pointer采用version2＋delivery枚举（stream或non-stream）与对应protocolVersion；v1读兼容，不新开第三存储键、不自动覆写旧坏原件。
6. 首次完整JSON须验证HTTP成功、请求/generation握手、完整schema、所有public字段和包target/ref/digest，再成为报告。未校验的半JSON没有成功/历史资格，也不能将可能含上游凭据的raw错误透给renderer。沿C1秘密保护；命中秘密或受检形状不合法则显式交付诊断，不能无声改字段后仍称完整原件。恢复可按真实structured snapshot生成受检报告视图，但明确“原companion附加信息未取得”；不能声称还原了原完整JSON、记者/判定或角色签名。
7. 新鲜合格completed/原scope的活动历史按原默认false；显式恢复不自动追加。源角色不变，无Direct角色projector或旧generation追开writeflag。

## 4. 非流响应：固定 opt-in 完整版本封套

选择一个新、受检的协议，而非多个运行回退：Native 固定 opt-in；成功响应采用 `{version, body, metadata}`，`body` 是现 companion 完整公开 JSON，`metadata` 是原 `X-Mahoshojo-Stream-Meta` 解码后的独立对象。新响应不再发送重复的 percent-encoded Stream-Meta 头；actor/generation/request/operation/placement 等身份与操作头保持。旧 Web 不携 opt-in，原 body/headers/状态完整不变。该选择没有新增目的地或凭据类型。

比较依据：仅去头可保持原 JSON 大小，但会失去不在原 body 的 scenarioDisplayName/language/storyLength/outputContract 等字段。独立 metadata 封套完整保存它们，并允许逐字段对拍；字段仍各守原位置，不能宣称其原本就在 report 中。近最大合法 input/output 的测量显示新增开销主要就是一份输入派生 metadata，不是第三份模型正文；确切数值及证据见上述容量调查。

只承诺受检契约内的完整性：unknown/不支持的运维 metadata 不静默剥字段或裁剪后冒充原 body。返回有界、无原值的明确协议诊断并保留 generation 身份，允许同 actor 的 C0 恢复正文；该错误表示 companion 交付未通过，并不把服务端已 completed 的 producer 改为 failed。错误响应也必须经过该新 opt-in 封装/头部处理及公开错误校验，避免 500 路径仍带巨大 Stream-Meta；缺失 metadata 用明确状态，不伪造值。

### 严格容量候选与证明义务

令 I=12,582,912 B（最终 HTTP 请求）、O=4,194,304 B（服务端原模型 raw＋reasoning＋控制尾）。仅针对真实 non-stream structured-report / Web-document / Web-package-target，报告-only 两写为 false：

- 模型来源项最多两份整段数据，按 JSON 字符串最坏 6× 转义保守计 `12O`。free Web 的 webHtml 与 article.body 是两份；package Artifact 只有 ref/path/media/digest，无第三份 generatedContent。structured 空 body 的旧 fallback 可复制原 JSON，已解码字段仍保留，合计也在此保守项内。任意兼容 Markdown SSE 不纳此证明。
- 输入来源可变字符串最多 `2I`：角色名/引导、userGuidance、判定 description/type/选中 outcome 在 body 与 metadata 各一份；scenarioDisplayName/language/storyLength 仅 metadata 一份。每判定节点只沿一条选中分支，最多100顶层×21层=2100节点；概率→details 等新增固定字段另计。
- 每份派生判定节点最多256 B固定骨架，两份计 `2×2100×256`；必须用真实 resolver 的默认中文、最大/最小有限 probability、roll100/depth20等夹具验证，不将原 description/type/outcome 字符串重算为固定常量。
- 独立运维 metadata 沿已有规则：aiModel 用 ProviderModelIdSchema 的200 UTF-16 code units及禁control，校验后须与原字符串相同，不静默trim；structured reasoning仅接真实SDK形状（done/unavailable、sdk、text≤12000、summary≤80、reasoningTokens、可选唯一truncated）；raw fallback保 `{status:'complete',text}`，text已属于O，不再次放大预算。unknown parts/任意flags/任意额外对象明确不支持，不能吞入该式。额外字符串最坏计 `6×(12000+80+200)`。
- 余下固定预算64KiB，须由最大ref/artifact（含512单位path）、记者最大组合、32guidance键/括号逗号、usage数值、标识/版本/诊断骨架断言证明。32角色+1用户guidance切UTF-16边界产生孤代理的额外转义逐个每份≤6 B，两份共396 B，单列计入固定项。Node22实际静态骨架：记者157种组合最大124 B、完整artifact3599 B、success7582 B、最大公开error37734 B，加396合计45712 B，低于65536；两个互斥响应相加仍为保守界。

由此候选 Arena 专用 JSON wire 上界为 `12O + 2I + 2×2100×256 + 6×(12000+80+200) + 65536 = 76,711,888 B`。该受检域数值已有来源推导、静态骨架与真实夹具独立读审；最终协议实现仍须再次验证，不是已有服务常量，也不是RSS保证。沿源数据来源推导，不按样本最大值猜cap，不改变旧Web或六族预算；Native只能验证新协议完整wire/shape，不能从派生重复字段反推原模型raw字节而宣称重新证明服务端4MiB硬限。

系统env旧路径只检查model非空，新opt-in复用200规则会拒绝异常超长/控制字符配置；旧Web接受范围不变。实际公开preset catalog319项、最长modelId47 ASCII字符，均在该既有规则内；部署方系统env值未读取，不能声称所有线上配置已检验。reasoning两个真实producer形状及异常诊断仍是启用前门禁，不为此重构所有Provider配置。

### 内存与实现门禁

有限分片只约束一次 IPC。服务端已经存在完整报告对象与JSON字符串，Native完整受检后才能送renderer；renderer重组与parse也持完整对象。长期只保一份受检body/metadata对象，供共享view与导出引用；传输raw在验证/重组完成后及时释放，不同时长期保存巨大的raw字符串。完整JSON导出保全部字段、字符串和数值语义，不承诺HTTP原始字节存档；导出临时串/Blob及时释放。明确每阶段存活量，不得因内存压力裁合法字段。容量报告分别列真实companion单进程构造、独立Response.json消费者、保raw后parse消费者，均只是Node代理测量；Native loopback与WebView实际峰值后续单列，不能用合并测量峰值冒任一端最低内存。

## 5. 能力兼容

新协议版本固定 `arena-companion-v1`，公开readiness响应与Native请求均通过唯一 `X-Mahoshojo-Arena-Companion-Protocol` 头声明/选择。封套仅 `version/body/metadata`；成功时metadata须为受检完整对象，创建前错误可为null。公开错误沿已有有界code/message/error/generation身份结构，不传原始上游错误/秘密；遇未知公开字段或异常运维值明确协议不支持，不静默strip。新metadata schema按实际non-stream contract支持structured-report、Web document/target与2100个resolved节点，不能误套C1可选header64KiB/100项接受范围。原C1 schema/协议继续保持。usage沿真实normalizeUsage固定字段；completionTokens的nativeCandidates＋reasoning可达2×MAX_SAFE_INTEGER，不误用单个safe integer界拒绝真实求和，其余数值和JSON有限性按当前producer形状受检。

现C1 Native对readiness.arenaHosted的v1三字段做完整对象相等，不能往该对象加JSON字段或变version而破坏已发布SSE客户端。现contracts的完整readiness schema也.strict()，所以不泛称旧消费者接受root新字段。保原body精确不变，仅新增受检公开响应header作JSON补充能力声明，仅新的companion POST要求对应JSON能力，并用旧body schema/真实Rust/Web消费者金样证明兼容。同request的既有lookup/status/resume/stop只要求C1身份能力；服务回滚撤JSON声明不能连恢复/停止一起锁死。旧服务不支持JSON时明确不可用，SSE原能力继续可用；不部署或用mock冒线上已支持。

## 6. 实施所有权与验收顺序

- 纯核/容量：现companion公开报告结构、字段校验/报告投影必要seam和旧Web真实回用；生产默认语义与合法字段不变，先固定金样与真实最大fixture。
- Native/协议：Arena专用JSON操作/分片、同actor/create-once/stop/detach、readiness补充兼容声明、source-hash/loopback；不动通用六族预算。
- Desktop：既有session/adapter共用与受控generation mode真正开放；freshJSON/恢复缺失态/存储失败/完整导出/关闭与scope矩阵。
- 审查：每原子只读独审；最后真实两路由矩阵与完整CI、Native实际源码分层证明。Windows/Tauri/真实账号Key/线上部署独立待验，不阻安全源码实现。

## 7. 最小验收矩阵与未验边界

1. 共同纯核/服务：旧 Web 无 opt-in 的成功/失败响应金样全等；新封套 body 与原 body 深度相等，metadata 与全部原 header 字段深度相等，包含 structured-report 和 package-backed 第12项 webPackageRef。不得只证明 freeWeb 的11项就称包模式完整。
2. 容量：保留20组紧凑recipe/断言，不提交大产物。覆盖4MiB来源、12MiB最终带配置/ID的请求、最坏转义、完整75MiB级响应、2100判定节点、真实两种reasoning形状、MAX_SAFE_INTEGER求和、200单位model、异常ops metadata、超wire限+1及错误分支；所有超限拒绝必须明确，不裁数据。静态64KiB余量随最终公开错误/envelope shape再验。
3. Native：合成固定loopback实际HTTP→完整受检JSON→有界Channel→TS bridge；身份/secret/ownership/hint/双CAS延续C1。响应头等待超过15秒仍可继续，软提示不取消；首头前stop通过原request lookup→generation stop，lookup404只未确认。完整响应截断/晚回执/账号或target切换/退出/已发detach后结果均不得触发新POST或旧scope副作用。
4. Desktop：两路由×4模式×Markdown/Web×系统/预设BYOK×匿名/登录，共64组新的non-stream真实受控页面旅程；C1 SSE原矩阵和Direct既有回归保留。验证generation mode切换不改旧结果解释，首份完整JSON与恢复structured snapshot分别呈现，metadata缺失不能本地补造；包target精确校验、显式兼容、原正文/Artifact/完整JSON导出分开。
5. 活动history、新scope、重复点击、取消、已完成后显式恢复不得自动append；保存超4MiB封套/草稿超4MiB字符/磁盘失败保内存与完整导出。保存生成卡仍putIfAbsent幂等，不更新角色卡、不改变official-signed来源规则。
6. 最终同源独审、完整CI、Native生产源码hash与真实跨语言fixture分层验收。最大响应只在获准串行窗口测量单次峰值，记录实际Node/Rust/内存阶段；Windows/Tauri/OS credentials/真实账号模型/视觉独立列未验，不重复或混称D4运行任务。

本合同与页面视觉修复并行时，`apps/desktop/src/app/battle-page.tsx`及共享UI实际消费由已登记页面owner协调后单写者整合；不得在两树并发重做相同布局。C2优先复用C1 session/C0恢复/共享report view，不新增第二套历史、格式或网络信任系统。Native/companion可在其独立目录按root调度先行；页面接线须等视觉owner冻结再整合，不能并发覆盖。

## 8. 签名角色独立后继

真实 Web 同源 POST `/api/arena/update-combatants-after-stream`，请求只含generationId+当前combatants；服务器从owned、completed/finalized D1 manifest取冻结effects。该manifest原64KiB，超限可明确不可用。稳定身份按唯一room key/卡ID/预设/名称组合匹配并回combatantIndices；与当前domain按name Map的另一投影存在语义差异，不能直接替换。

纯匹配、原Web retry/角色投影可先共源并保原消费者金样，权威签名/数据库/认证留server。新鲜官方签名可沿现provenance入口，草稿/导入只有unverified。C1旧generation已冻结write=false不可回补；仅后继新任务显式true。匿名actor token从Hono发送到固定Next origin是不同目的地的凭据路由，需用户单独明确批准，不能从现Hono许可推定；Next端点能力证明也须独立闭合。该接口不调用Provider、不产生新模型费用，但不能据此跳过身份和目的地门禁。

## 9. 当前调查状态与权威来源

适用 accepted 口径：[Arena双生成契约](../specs/2026-08-31_063734_Arena双生成契约回归修正规格.md)、[C1-SSE合同](./2026-10-10_042500_DesktopHostedArena流式纵切实施合同.md)与[最终验收](../reports/2026-10-10_053300_DesktopHostedArena流式纵切验收.md)。本片仅把总计划未完成的non-stream报告细化为新协议；accepted安全规格需在实施原子同步更新，不凭本计划越权发布配置。

本合同形成时只有独立文档与合成容量证据，C2尚未实现/部署；后续源码交付见开头验收入口，仍未运行真实模型或密钥、未改Provider配置。维护者已报告Hono部署；2026-10-10 06:53:42 UTC的无凭据公开readiness GET返回200及现C1精确能力声明，只证该公开能力端点，不证明匿名/登录真实创建、C2能力或Windows。当前C1服务可声明的能力不包含本新JSON协议。
