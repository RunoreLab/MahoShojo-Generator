# 竞技场

> 作者：末伏之夜  
> 更新时间：2026-01-03

竞技场是「生成战报」的主要入口：你选择参战者（数据卡或预设角色），系统生成战报并给出胜负结果。

## 计分触发点（v0.6.0）

当一次战报满足排位资格时，服务端会在写入 `battle_report_generations` 与参战者信息后进行结算：

- 非流式：`/api/generate-battle-story`（当前前端与 PVP 结算主入口）
- 兼容端点：`/api/arena/generate`
- 流式：`/api/arena/generate-stream`（写库后异步结算，不影响流式输出）

## 排位参与对象

v0.6.0 的排位对象以「实体」为单位：

- 已上传至线上数据库中的数据卡：`data_cards.id`
- 预设角色：`preset filename`

只有当参战者均可映射为上述实体时，才可能计分。

## 运行态数据（历战/状态栏）

对局过程中，系统可能把“本次事件影响/状态摘要”等写入到角色卡的运行态字段，用于下一次生成延续故事。

- 历战记录：`arena_history.impact`
- 状态栏：`current_state.summary`

想做长线情景或理解这些字段含义，可以先看：

- 术语表：`/encyclopedia/glossary`
- 情景卡进阶：`/encyclopedia/scenario-advanced`
- 引导与读写状态（strict/free 的差异点）：`/encyclopedia/guidance`
