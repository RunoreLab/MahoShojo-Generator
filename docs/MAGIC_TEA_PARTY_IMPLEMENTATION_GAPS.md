# 魔法茶会：设计-实现差异与缺口清单

日期：2026-01-17  
范围：docs/MAGIC_TEA_PARTY_2026-01-15.md 与当前代码实现

## 一、已完成（已验证落地）
- `outputPlan` + JSONL 侧信道解析：summary/updates/notice 已从正文剥离，支持流式解析与本地落库。
- outputPlan 失败回退：**仅当 outputPlan=on** 时触发 summarize / generate-updates 补生成并提示。
- `updateApplyMode` 写入策略：auto/confirm/draft 已接入，自动写入带快照与撤销入口。
- 预设角色面板与角色管理：PresetCharacterPanel + CharacterPanel（编辑/历战查看/云端保存/拖拽排序/卡组导入）。
- 会话清理与归档：保留天数/数量预览 + 清理逻辑、JSON/JSONL 导出，ZIP 导出含 tachie 图片资源。
- 分支会话/合并、自动摘要触发、Token 预算提示、立绘/插画生成与缓存清理等主流程已覆盖。
- 导入/分支编辑/粘贴文本安全处理：敏感词预检（命中跳转逮捕），屏蔽词局部遮罩后继续导入。
- 会话列表支持搜索与分页展示。
- 导入元信息完整恢复：`protocolShadow` / `updateSnapshot` / `lastChoices` / `forkedFrom` / `branchLabel` / `summarySections` / 草稿等字段已保留，归档导入支持分支关系重映射。
- 结构化摘要 `sections` 已持久化并随会话导入导出。
- 草稿已写入 IndexedDB（会话扩展字段），LocalStorage 作为兜底仍保留。

## 二、差异与缺口（需要补强）
1. 全卡协议策略尚未落地  
   当前仍以“协议附录 + 通用提示词”方式注入，未实现**全卡协议高优先级覆盖**与阶段化提示词重写。
2. 卡片截断阈值仍生效  
   `MAX_FIELD_CHARS/MAX_LIST_ITEMS/MAX_CARD_TEXT_CHARS/MAX_PROTOCOL_APPENDIX_CHARS` 仍限制卡片内容，需改为**无限制**并保留注释阈值。
3. 情景卡注入仍被裁剪  
   `buildScenarioText` 仍仅抽取 `elements` 局部字段，未与竞技场“全量情景注入”对齐。
4. 角色卡注入未全量对齐竞技场  
   角色卡仍以摘要化字段注入，未采用竞技场的全量卡片注入策略。
5. 情景优先级不足  
   通用系统提示词缺少“情景设定为最高优先级”与“主情景优先”硬性声明。
6. 选项/更新阶段协议覆盖不足  
   选项与更新提示词尚未强制要求“遵守卡内选项/写入规则”，也未加入官方字段映射与 notice 规范。
7. 摘要后自动生成更新草案仍为规划项  
   目前支持 outputPlan 侧信道与手动触发更新草案，摘要后自动生成/写入尚未接入。

## 三、风险与建议
- 风险：导入/编辑带来的违规内容可能触发后续服务端安全拦截或输出截断。  
  建议：已接入预检与遮罩，后续可补充 `safety` 元信息记录以便排查。

- 风险：JSONL 解析失败时 summary/updates 行会混入正文并进入历史，污染上下文。  
  建议：已在解析失败时发出 notice 并剥离疑似侧信道行；后续可在提示词中强调禁止输出非 JSONL 行。

- 测试覆盖：已补齐更新写入 / 会话清理 / ZIP 导出流程用例，降低回归风险。
