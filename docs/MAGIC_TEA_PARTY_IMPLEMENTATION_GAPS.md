# 魔法茶会：设计-实现差异与缺口清单

日期：2026-01-17  
范围：docs/MAGIC_TEA_PARTY_2026-01-15.md 与当前代码实现

## 一、已完成（已验证落地）
- `outputPlan` + JSONL 侧信道解析：summary/updates/notice 已从正文剥离，支持流式解析与本地落库。
- `updateApplyMode` 写入策略：auto/confirm/draft 已接入，自动写入带快照与撤销入口。
- 预设角色面板与角色管理：PresetCharacterPanel + CharacterPanel（编辑/历战查看/云端保存/拖拽排序/卡组导入）。
- 会话清理与归档：保留天数/数量预览 + 清理逻辑、JSON/JSONL 导出，ZIP 导出含 tachie 图片资源。
- 分支会话/合并、自动摘要触发、Token 预算提示、立绘/插画生成与缓存清理等主流程已覆盖。
- 导入/分支编辑/粘贴文本安全处理：敏感词预检（命中跳转逮捕），屏蔽词局部遮罩后继续导入。
- 会话列表支持搜索与分页展示。

## 二、差异与缺口（需要补强）
1. 导入恢复元信息不完整  
   导入会话时会重建 session，但会丢失 `protocolShadow`、`updateSnapshot`、`lastChoices`、`forkedFrom/branchLabel`、`titleMeta` 等字段，导致分支链与更新草案不可追溯。

2. 结构化摘要 sections 未持久化  
   侧信道 summary 支持 `sections`，但当前仅写入 `summary.text`，结构化分段信息被丢弃；类型层与存储未承载。

3. 协议适配仍偏提示词层面  
   【可忽略】设计中“阶段化系统提示词覆盖/字段映射/协议强制执行”尚未形成可执行机制，当前仅靠提示词约束。

4. outputPlan 失败回退不足  
   【可忽略】当模型未输出 summary/updates 时不会触发兜底（调用 summarize / generate-updates），导致摘要与影子状态可能长期过期。

5. 草稿持久化策略偏轻量  
   草稿仅写 localStorage，未进入 IndexedDB/session 扩展字段，与“优先 IDB”存在差距，导出/迁移时不完整。

## 三、风险与建议
- 风险：导入/编辑带来的违规内容可能触发后续服务端安全拦截或输出截断。  
  建议：已接入预检与遮罩，后续可补充 `safety` 元信息记录以便排查。

- 风险：JSONL 解析失败时 summary/updates 行会混入正文并进入历史，污染上下文。  
  建议：解析失败时输出 notice 并隔离该行；或在下一轮 prompt 过滤掉疑似侧信道行。

- 测试缺口：更新写入/ZIP 导出/会话清理/导入回放尚无覆盖。  
  建议：补充 `tests/` 用例，验证导入-导出一致性与清理策略边界。
