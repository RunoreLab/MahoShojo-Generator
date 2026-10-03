# Web 包创作指南：让 AI 一次就生成对

> 适用范围：竞技场 Web 战报的自定义 Web 包（本地 ZIP 导入）  
> 面向对象：自己打包 Web 包的创作者  
> 更新日期：2026-09-30

本页讲的是**怎么打包，让 AI 稳定地生成出你引擎要的数据**。

如果你已经在 Arena 里看到过这句提示，问题的答案通常就在下面：

> 生成失败：AI 生成的 Web 包目标文件未通过格式或 schema 校验

它不表示你用错了功能，也不表示 Web 包坏了。它表示：**AI 不知道你要什么。**

---

## 一、先理解一件事：宿主负责"长什么样"，你负责"写什么"

生成时，AI 会拿到两段材料。

**第一段是宿主的形态契约（可信层，你无法改写）**

宿主会明确告诉 AI：这个目标是 `application/json`，顶层必须是一个 JSON 数组，第一个字符必须是 `[`，最后一个字符必须是 `]`，不能带 Markdown 代码围栏或前导文字。

**第二段是你的创作材料（不可信层，AI 只会参考）**

就是你写在 `generation.instructions`、`generation.schema`、`generation.example` 里的内容。

分界线很清楚：

| 宿主已经保证 | 只有你能提供 |
| --- | --- |
| 输出是可以被 `JSON.parse` 直接解析的 | 这些数据表达什么故事 |
| 顶层是数组还是对象（跟随你的 schema） | 每个字段的语义与取值范围 |
| 剥离模型加的代码围栏、前导路径行 | 一个符合引擎预期的样本 |
| 不做二次生成兜底 | 让 schema 真的约束到嵌套结构 |

**所以"结构对但内容不对"是常态**：宿主能保证文件是合法 JSON，但保证不了你的游戏玩得下去。校验通过 ≠ 内容可用。这一点在第五节展开。

---

## 二、manifest 的五个字段

ZIP 根目录放一个 `web-package.json`：

```json
{
  "format": "mahoshojo-web-package",
  "formatVersion": 1,
  "id": "my.event-engine",
  "version": "1.0.0",
  "name": "我的事件引擎",
  "entry": "index.html",
  "generation": {
    "target": "static/events.json",
    "mode": "replace",
    "mediaType": "application/json",
    "instructions": "generation/instructions.md",
    "schema": "generation/schema.json",
    "example": "generation/example.json"
  }
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `entry` | 是 | 包内已存在的 HTML 文件；不写会自动取最浅的 `index.html` |
| `generation.target` | 是 | AI 唯一会生成的那个文件，必须已在包内 |
| `generation.mediaType` | 建议写 | 写 `target` 忘了写它时，导入会从目标文件自身推导 |
| `generation.instructions` | **强烈建议** | 告诉 AI 这些数据该表达什么 |
| `generation.schema` | **强烈建议** | 用 Draft 2020-12 约束结构，见第四节 |
| `generation.example` | 建议 | 3–5 条小样本，见第四节 |
| `files` | 不用写 | 不声明时按归档内文件自动派生 |

`files` 不写反而更好：只要目录里有 favicon、woff、mjs、webmanifest 这类资源，它们都会被自动收进文件表，不会因为"未知扩展名"把整包挡在门外。

---

## 三、`instructions` 怎么写才有用

反例（真实第三方包就是这样，183 字符）：

```markdown
请生成事件数组。

每个事件必须包含：
- id
- initial
- text
- weight
- accept
- reject
```

这只是字段名清单。AI 拿到它只能猜："`text` 写多长？`weight` 是 0–1 还是 1–10？`accept` 里放什么？"

正例：

```markdown
# 事件数据生成说明

输出：static/events.json，顶层是数组，通常 5–8 条事件。

每条事件的字段：
- id：字符串，形如 "e001"，在数组内唯一。
- initial：布尔。标记这条是否为开场事件；整个数组里 initial=true 的事件会被随机选一条作为起点。
- text：字符串，本次互动要呈现给玩家的场景描述，60–120 字，第二人称，不要写"你选择了..."这种旁白。
- weight：数字，0.5–2.0，初始事件权重必须大于 0。
- accept：对象，四个键 attr1–attr4，各为 -40 到 40 的整数，表示接受选项时这四项属性如何变化。
- reject：对象，结构与 accept 相同，表示拒绝选项时的变化。
- acceptUnlock / rejectUnlock：字符串数组，写出这次选择解锁的事件 id；没有则写 []。
- chain / oneTime / ending：布尔，链式分支 / 只触发一次 / 是否为结局。

内容要求：所有事件必须能从本场战斗的两名角色之间的关系出发，写她们之间具体发生过的互动，不要写与本场无关的通用事件。
```

差别在于：它写了**字段的形状、取值范围、单位，以及内容要跟本场战斗挂钩**。

---

## 四、schema：校验通过不等于内容对

这是最容易被忽略、后果最严重的一节。

### 4.1 只写 `required` 等于什么都没约束

```json
{ "type": "array", "items": { "type": "object", "required": ["id", "text", "weight", "accept", "reject"] } }
```

这份 schema 只检查"这五个键在不在"。它**完全没有**约束 `accept` 的结构。

实测：AI 会把 `accept` 写成"下一个事件节点"而不是属性增减表——校验照样通过，渲染出来是一个点不动的坏游戏。

### 4.2 正确写法

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "required": ["id", "initial", "text", "weight", "accept", "reject", "acceptUnlock", "rejectUnlock", "chain", "oneTime", "ending"],
    "additionalProperties": false,
    "properties": {
      "id":  { "type": "string", "minLength": 1 },
      "initial": { "type": "boolean" },
      "text": { "type": "string", "minLength": 1 },
      "weight": { "type": "number", "minimum": 0 },
      "chain": { "type": "boolean" },
      "oneTime": { "type": "boolean" },
      "ending": { "type": "boolean" },
      "accept": {
        "type": "object",
        "required": ["attr1", "attr2", "attr3", "attr4"],
        "additionalProperties": false,
        "properties": {
          "attr1": { "type": "integer", "minimum": -40, "maximum": 40 },
          "attr2": { "type": "integer", "minimum": -40, "maximum": 40 },
          "attr3": { "type": "integer", "minimum": -40, "maximum": 40 },
          "attr4": { "type": "integer", "minimum": -40, "maximum": 40 }
        }
      },
      "reject": { "$ref": "#/$defs/delta" },
      "acceptUnlock": { "type": "array", "items": { "type": "string" } },
      "rejectUnlock": { "type": "array", "items": { "type": "string" } }
    }
  },
  "$defs": {
    "delta": {
      "type": "object",
      "required": ["attr1", "attr2", "attr3", "attr4"],
      "additionalProperties": false,
      "properties": {
        "attr1": { "type": "integer" }, "attr2": { "type": "integer" },
        "attr3": { "type": "integer" }, "attr4": { "type": "integer" }
      }
    }
  }
}
```

关键点：

- `properties` 写全，**子对象和数组也要约束到内部**；
- 加 `additionalProperties: false`，让 AI 多写的字段变成错误而不是被静默忽略；
- 能给范围就给（`minimum` / `maximum` / `minLength` / `maxItems`）。

支持的是 **Draft 2020-12** 子集。`pattern`、`patternProperties` 和非本地 `$ref` 会被导入阶段直接拒绝。

### 4.3 `example` 有两种用法，选一种

宿主现在把 `example` 当作**这个目标文件的一份参照**。你有两种用法可选。

#### 用法 A：小结构样本（适合 JSON 数据目标）

3–5 条就够：

```json
"example": "generation/example.json"
```

```json
[
  {
    "id": "e001",
    "initial": true,
    "text": "黄昏的训练场只剩她们两个。林小璐把外套铺在长椅上，白静萱犹豫了一下，还是坐了下来。",
    "weight": 1.0,
    "chain": false,
    "oneTime": false,
    "ending": false,
    "accept": { "attr1": 25, "attr2": -5, "attr3": 20, "attr4": 20 },
    "reject": { "attr1": -5, "attr2": 10, "attr3": -10, "attr4": 0 },
    "acceptUnlock": [],
    "rejectUnlock": []
  }
]
```

#### 用法 B：完整可运行的参考实现（适合 HTML / 代码目标）

如果你要的是一个**游戏或工具**，与其让 AI 从零写，不如给它一份你已经跑通的实现。AI 会沿用它的机制、架构、接口与代码组织方式，把角色、台词、编排按本场重写。

比如你有一个可玩的弹幕射击游戏，希望 AI 换一个角色的弹幕编排：

```json
"generation": {
  "target": "index.html",
  "mediaType": "text/html",
  "instructions": "ai/instructions.md",
  "example": "engine/danmaku.html"
}
```

`engine/danmaku.html` 是那份完整引擎（可以是几十 KiB），`index.html` 只是入口薄壳。AI 读引擎、写出新游戏。`instructions` 里要写清「哪些必须沿用、哪些必须重写」：

```markdown
# 弹幕游戏生成说明

engine/danmaku.html 是本包的参考实现：它已经跑通了 Canvas 弹幕渲染、
移动端触控、Boss 阶段、符卡配方执行、HUD 与结算。请沿用它的机制、架构、
接口与代码组织方式，不要推倒重写。

需要为这场对战重新创作的部分：
- 两名参战角色的弹幕配色与弹型（环形、扇形、螺旋、追踪、散射）；
- 符卡编排：使用参考实现里已有的符卡，按本场强弱关系重新配比；
- Boss 台词与对话文本，必须贴合本场两名角色的性格与刚才发生的事；
- 标题、角色名、HUD 文案。
```

**两个必须知道的代价：**

1. **范例有多长，产出通常就有多长。** 实测一份 79 KiB 的引擎范例，产出 65 KiB、约 2.8 万 token 的目标文件，流式生成跑了 **5 分钟**。范例越接近「精简到只剩必要逻辑的最小可运行版本」越好——可删的样式和内容先删掉。导入时范例超过 48 KiB 会收到提示。
2. **AI 会大量照抄范例。** 实测同一例中，产出有 88% 的行与范例逐字相同，角色名、配色、标题则确实换了。这在「换皮重编」的场景正是你要的；若你要的是全新设计，就把范例精简到只保留机制骨架（弹型计算、碰撞、阶段机），不要给它可抄的完整成品。

宿主明确告诉 AI：机制、架构、接口与代码组织方式可以贴近，但角色、情节、台词、命名与全部具体内容必须按本场重写。

**`example` 不能指向 `entry`。** 入口一定会执行，把它声明成提示材料等于让那段代码逃过风险分析。范例可以直接指向 `generation.target`（用目标文件现有的内容当参照）。

---

## 五、导入时平台会提醒你

导入本地 ZIP 时，平台会对 **JSON 数据类目标**做一次生成可行性体检。命中以下任一条时，导入仍然成功，但会给出提示：

- 没有 `generation.instructions`；
- `instructions` 短于 300 字符（接近一份字段名清单）；
- 没有 `generation.schema`；
- schema 没有 `required`；
- schema 只声明了 `required` 而没有 `properties`（约束不到任何字段结构）；
- `required` 覆盖不到一半已声明字段；
- 缺少 `generation.example`；
- `generation.example` 超过 48 KiB（范例过长会等比拉长产出，见 4.3）。

`text/html` 目标不体检——它自描述，不需要字段级指引。

---

## 六、两种包设计：引擎交给 AI，还是引擎留在包里

做一个「AI 每次给你一个新游戏」的包，有两条都成立的路。

**A. 引擎进 base，AI 只生成数据（推荐先试这条）**

base 里放完整引擎和一份符卡/关卡接口定义，AI 的生成目标是一份几十字节到几 KB 的数据文件，引用引擎提供的接口。

- 输出极小，生成快（通常几秒），不会截断
- 引擎行为完全确定，作者能直接调试
- 代价：玩法形态受限于接口。弹幕包里的 `pattern-contract.json`（F00–F14）就是这种接口

**B. 引擎作为 `example`，AI 重写整个游戏**

引擎不进 base（或 base 只放薄壳），完整引擎作为 `generation.example`，AI 产出新的完整 HTML。

- 每次生成的玩法可以超出固定接口
- 代价就是 4.3 里那两条：产出等比变长（79 KiB → 65 KiB / 5 分钟），且 AI 会大量照抄范例

平台不替你选。**建议先用 A 验证包设计成立，再考虑 B。**

---

## 七、失败对照表

| 现象 | 原因 | 怎么办 |
| --- | --- | --- |
| 提示「AI 没有按 Web 包要求的形态输出目标文件」 | 模型输出了散文、HTML 或无法解析的内容 | 补 `instructions`；若长期复现，说明包没告诉 AI 目标是什么 |
| 提示「目标是合法 JSON，但不符合声明的数据结构」 | 顶层类型错，或缺 required 字段 | 核对 schema；把嵌套结构写进 `properties` |
| 导入成功但生成总失败，包里没有 instructions/schema | 宿主不发明包想要的结构 | 补齐三件套 |
| 校验通过，但页面里的数据不对 | schema 太松，约束不到嵌套结构 | 见第四节 |
| 提示「输出上限」 | 一次生成的事件太多 | 在 `instructions` 里写明条数上限（"通常 5–8 条"） |
| 提示「缺少可解析的 Arena 战报元数据结尾」 | 模型没写文末的控制 trailer | 换个模型重试；模型偶发不听话时重试通常能过 |
| 目标文件被拒绝且提示超出字节预算 | 生成内容过长 | 同上，减少条数 |
| 导入被拒：「`generation.example` 不能指向入口文件」 | 入口一定会执行，不能同时当作提示材料 | 另存一份范例文件；或直接指向 `generation.target` |
| 生成很慢 / 撞上输出上限，而你的 `example` 很大 | 范例有多长产出就有多长 | 见 4.3：精简范例到最小可运行形态，或改用第六节的 A 方案 |

---

## 八、本地自查

改完包先自己验一遍，比在 Arena 里反复生成快得多：

```bash
# 类型与构建
pnpm --filter @mahoshojo/web-package test
pnpm --filter @mahoshojo/web-package build

# Arena 侧的提示与校验回归
pnpm --filter @mahoshojo/hosted-runtime test
```

导入一次并读完提示框——体检结果会直接告诉你缺哪一项。

---

## 九、相关页面

- Web 战报使用说明（面向使用者）：`/encyclopedia/web-report`
- Web 战报数据卡创作进阶：`/encyclopedia/web-data-card-authoring`
- 本地库：`/encyclopedia/local-library`
- AI 输出格式异常：`/encyclopedia/ai-output-format`
- 竞技场总览：`/encyclopedia/arena`
