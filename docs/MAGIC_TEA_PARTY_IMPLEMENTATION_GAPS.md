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
1. 摘要后自动生成更新草案仍为规划项  
   目前支持 outputPlan 侧信道与手动触发更新草案，摘要后自动生成/写入尚未接入。

## 三、风险与建议
- 风险：导入/编辑带来的违规内容可能触发后续服务端安全拦截或输出截断。  
  建议：已接入预检与遮罩，后续可补充 `safety` 元信息记录以便排查。

- 风险：JSONL 解析失败时 summary/updates 行会混入正文并进入历史，污染上下文。  
  建议：已在解析失败时发出 notice 并剥离疑似侧信道行；后续可在提示词中强调禁止输出非 JSONL 行。

- 测试覆盖：已补齐更新写入 / 会话清理 / ZIP 导出流程用例，降低回归风险。
