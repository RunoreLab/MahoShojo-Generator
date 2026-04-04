# 站内功能速览（从生成到对战）

> 作者：[末伏之夜](https://github.com/notuhao)  
> 更新时间：2026-04-04

如果你是第一次来，可以把本站理解成三件事：

1) **生成内容**：魔法少女 / 残兽 / 情景（JSON 文件）  
2) **管理内容**：把文件保存到云端、编辑、设为公开或私有  
3) **让内容上场**：在竞技场生成战报，或去 PVP 做卡牌对决

## 1) 推荐流程（最不容易迷路）

1) 去任意生成器生成一份设定（角色/残兽/情景）；如果你想把问卷、自由说明和规则车卡拼在一起，就用 `/creator`，然后下载 JSON 或保存到云端  
2) 去档案馆整理与编辑（名称、简介、标签、公开状态、敏感词提示等）  
3) 去竞技场选择参战者与模式，生成战报  
4) 如果你想玩整轮推进而不是单次战报，可以改走 `/challenge`  
5) 想参与排位/上榜：再阅读 strict/free 口径与审核口径（见下方相关条目）

## 2) 入口速查（点到即玩）

### 内容生成

- `/name`：魔法少女生成器（基于名字，快速出卡）
- `/details`：奇妙妖精大调查（深度问卷，更像“人物小传”）
- `/canshou`：危险残兽大调查（生成宿敌/对手）
- `/creator`：创作工房（组合问卷、自由说明与规则车卡；当前稳定接通结构化魔法少女、通用角色卡与通用情景卡）
- `/scenario`：箱庭物语（情景生成器，生成“情景文件”）
- `/free`：自由生成（任意提示词 + 选择 Schema 生成数据卡）

### 创作辅助（0.7.0+）

- `/magic-tea-party`：魔法茶会（长期剧情对话；角色/情景自由组合；自备 API Key；本地保存会话）
- `/character-party`：角色组队（把多张角色卡拼成“队伍卡”）
- `/tavern`：酒馆生态（SillyTavern 角色卡 PNG 导入/导出）

### 对战竞技

- `/arena`（或旧入口 `/battle`）：魔法少女竞技场（生成战报；可选日常/羁绊/经典/情景模式；v0.8.1 起支持连续战报会话与章节规划）
- `/challenge`：本轮挑战（竞技场世界的本地肉鸽式挑战；快照确认、地图推进、节点裁定、终局总结与本地解锁）
- `/pvp`：PVP 卡牌对决（房间对局、回合推进、投票与结算）

### 内容管理

- `/character-manager`：档案馆（导入/编辑/替换数据卡；公开状态；标签；敏感词提示；可编辑情景卡章节规划扩展）
- `/sublimation`：成长升华（让角色根据经历生成“进化后”的新形态）

### 展示与记录

- `/ranking`：排行榜（排位相关展示与筛选）
- `/me`：个人页（战报记录 / PVP 战绩等）
- `/encyclopedia`：百科（规则解释、术语、玩法攻略）

## 3) 常见问题（普通用户版）

### 我需要登录吗？

- 不登录也能体验大多数生成与对战功能（以页面提示为准）。
- **登录后**，你才能把数据卡保存到云端、替换已有卡，并参与部分与排位相关的严格口径。

### 我看到“账号迁移提醒”是什么意思？

- v0.8.0 起，用户系统进入新认证体系迁移窗口。
- 如果你还在使用旧密钥登录，请前往 `/me?tab=settings` 完成“设置登录密码（迁移）”。
- 详细步骤见：`/encyclopedia/auth-migration`。

### 为什么会有冷却时间？

为控制公共资源与滥用风险，部分生成有冷却时间。若你使用自备 API Key（在页面里选择自定义供应商并填写 Key），某些页面会有更短的冷却时间。

### 连续战报和魔法茶会有什么区别？

- 连续战报仍然是 **竞技场战报**：保留胜负、战报卡片、角色状态更新与章节链，现在还支持显式章节规划。
- 魔法茶会更像 **长期剧情聊天 / 跑团容器**：自由度更高，但不等价于竞技场战报。
- 如果你想写“同一场竞技之后的下一章、分支结局、赛后余波”，或想明确控制“总共写几章”，优先用连续战报；如果你想做自由互动长对话，再看 `/magic-tea-party`。

### 为什么会跳转到“逮捕”页面？

通常是输入/输出命中了敏感词或内容安全策略拦截。建议先备份文本，再用更中性的表达改写；也可以查看百科里的自救说明。

## 相关条目

- 角色生成（/name、/details、/canshou）：`/encyclopedia/character-generator`
- 创作工房（/creator）：`/encyclopedia/creator`
- 通用数据卡（Markdown）：`/encyclopedia/general-cards`
- 自由生成：`/encyclopedia/free-generator`
- 魔法茶会（功能与快速开始）：`/encyclopedia/magic-tea-party`
- 角色组队：`/encyclopedia/character-party`
- 酒馆生态联动（SillyTavern）：`/encyclopedia/tavern-ecosystem`
- 档案馆（角色管理）：`/encyclopedia/archive`
- 账号迁移指南：`/encyclopedia/auth-migration`
- 竞技场：`/encyclopedia/arena`
- 本轮挑战：`/challenge`
- 连续战报会话：`/encyclopedia/continuous-battle-story`
- 排位与排行榜：`/encyclopedia/ranking`
- 引导 / 裁判事件 / 读写状态：`/encyclopedia/guidance`
- 公开与审核机制：`/encyclopedia/review`
- 箱庭物语（情景生成器）：`/encyclopedia/scenario-generator`
- 情景卡进阶（继承与长线）：`/encyclopedia/scenario-advanced`
- 敏感词与逮捕：`/encyclopedia/sensitive-words`
