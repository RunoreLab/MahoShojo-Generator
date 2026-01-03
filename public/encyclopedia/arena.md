# 竞技场

竞技场是「生成战报」的主要入口：你选择参战者（数据卡或预设角色），系统生成战报并给出胜负结果。

## 计分触发点（v0.6.0）

当一次战报满足排位资格时，服务端会在写入 `battle_report_generations` 与参战者信息后进行结算：

- 非流式：`/api/generate-battle-story`（当前前端与 PVP 结算主入口）
- 兼容端点：`/api/arena/generate`
- 流式：`/api/arena/generate-stream`（写库后异步结算，不影响流式输出）

## 参与对象

v0.6.0 的排位对象以「实体」为单位：

- 数据卡：`data_cards.id`
- 预设角色：`preset filename`

只有当参战者均可映射为上述实体时，才可能计分。

