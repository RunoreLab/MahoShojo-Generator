# 角色卡/战报卡图片资产嵌入与云端限额审核设计（2026-02-10）

## 0. 背景与目标

当前项目中：

- 角色卡与战报卡的分享本质是“卡片 DOM 截图”；
- 已有立绘/插图生成能力，但生成结果尚未纳入角色卡/战报卡本体渲染；
- 云端保存存在 `300KB` 硬限制；
- 数据卡审核存在“豁免用户自动通过”路径，与“含图片必须人工审核”新要求冲突。

本设计目标：

1. 在角色卡与战报卡中支持插入“生成图/上传图”，并随截图一起分享；
2. 对“用户自行上传图片”强制加注释标识；
3. 允许将图片资产信息写入角色卡 JSON（支持分享 JSON 时带图）；
4. 建立“云端体积预估 + 自动精简/分级裁剪 + 压缩引导”机制，尽量把数据卡拉回 `300KB` 内；
5. 严格落实安全红线：**任何含图片的数据卡（新建/更新）都必须人工审核后才能公开，豁免用户也不例外**；
6. 管理后台可直接查看数据卡中的内嵌图片，支持人工审核；
7. 含图片数据卡跳过 AI 自动审查，避免无效消耗。

---

## 1. 现状盘点（基于当前仓库）

## 1.1 卡片分享链路（截图驱动）

- 战报卡截图入口：
  - `components/BattleReportCard.tsx`（`handleSaveImage`）
  - `components/stream/StreamingBattleReportCard.tsx`（`handleSaveImage`）
- 角色卡截图入口：
  - `components/MagicalGirlCard.tsx`
  - `components/CanshouCard.tsx`
  - `components/GeneralCharacterCard.tsx`

结论：**只要把插图渲染进 these 卡片 DOM，现有截图分享链路天然可复用。**

## 1.2 生图能力现状

- `components/TachieGenerator.tsx` 已提供 `onImageUrlChange` / `onResult` 回调，可拿到图 URL 与生成结果；
- 角色侧已有“立绘生成”面板入口：
  - `pages/details.tsx`
  - `pages/character-manager.tsx`
  - 其他页面（`free` / `character-party`）也有类似入口。

## 1.3 云端大小限制与现有保存逻辑

- 硬限制定义：`lib/data-card-size.ts` 的 `MAX_DATA_CARD_BYTES = 300 * 1024`；
- 服务端保存校验：`pages/api/data-cards.ts`（POST / PUT）超限直接 `413`；
- 前端 `SaveToCloudButton` 目前仅做常规保存/替换，不含“体积预检 + 自动精简”。

## 1.4 可复用的成熟体积治理样式

- `components/tavern/TavernImportPanel.tsx` + `lib/tavern-card/cloud.ts` 已有：
  - 云端大小预估；
  - 分级预设（`standard/light/minimal`）；
  - 预估告警与超限提示。

## 1.5 Schema 扩展约束

- 魔法少女/残兽/情景 schema 都对字段有约束，但 `key.startsWith('_')` 允许扩展；
- 因此新增 `_visual_assets` 作为统一扩展字段是安全路径。

## 1.6 审核链路现状

- `pages/api/data-cards.ts` 里：
  - 创建公开卡时，豁免用户会直接 `approved`；
  - 非豁免且开启自动审查时，会触发 `autoReview...`；
  - 更新也有类似“自动审查更新”的路径。
- `DataCardDetailsModal` 当前会跳过 `_` 前缀字段渲染，不利于审核 `_visual_assets`。

---

## 2. 需求拆解

## 2.1 功能需求（FR）

1. 用户可把“生成图/上传图”绑定到角色卡并渲染进卡片；
2. 用户可把“生成图/上传图”绑定到战报卡并渲染进卡片；
3. 上传图必须展示“用户自行上传”小字注释；
4. 支持图片资产信息写入角色卡 JSON（可选含 payload）；
5. 保存云端前提供 JSON 大小指示与超限处理；
6. 提供图片压缩功能（按目标字节反推压缩量并一键应用）。

## 2.2 审核与安全需求（FR-Sec）

1. 含图片数据卡公开前必须人工审核；
2. 豁免用户不再绕过该规则；
3. 含图片卡跳过 AI 自动审查；
4. 管理后台需可视化查看内嵌图片用于审核；
5. 未审核通过的图片不得出现在公开环境。

## 2.3 非功能需求（NFR）

1. Edge Runtime 兼容（不引入 Node-only 图像库到服务端主链路）；
2. 不破坏现有卡片截图与保存流程；
3. 对无图片数据卡保持最小侵入；
4. 对旧数据卡向后兼容。

---

## 3. 方案对比与推荐

## 3.1 方案 A：仅页面本地插图，不写入 JSON

- 优点：实现简单、无体积压力；
- 缺点：JSON 分享无法携带图片，跨端不可复现，和需求不符。

## 3.2 方案 B：统一 `_visual_assets` 写入 JSON + 云端预检（推荐）

- 优点：满足截图分享 + JSON 分享 + 云端治理 + 审核闭环；
- 缺点：实现面较广，需要补齐预检/审核管理。

## 3.3 方案 C：图片完全外置 R2，不在 JSON 放 payload

- 优点：JSON 小、云端压力小；
- 缺点：离线分享差、链接失效风险、审核与引用一致性复杂。

**结论：采用 B，辅以 C 的可演进能力（后续可将大图迁移到对象存储）。**

---

## 4. 统一数据模型设计

## 4.1 角色卡 JSON 扩展字段（推荐）

在角色卡根节点新增：

```ts
type VisualAssetSource = 'generated' | 'uploaded';
type VisualAssetKind = 'portrait' | 'illustration';
type VisualPayloadMode = 'inlineDataUrl' | 'externalUrl' | 'none';

interface VisualAssetPayload {
  dataUrl?: string;      // payloadMode=inlineDataUrl
  url?: string;          // payloadMode=externalUrl
  mime?: string;
  width?: number;
  height?: number;
  bytes?: number;
  sha256?: string;
}

interface VisualAssetItem {
  id: string;
  createdAt: string;
  source: VisualAssetSource;
  kind: VisualAssetKind;
  payloadMode: VisualPayloadMode;
  payload?: VisualAssetPayload;
  note?: string;         // source='uploaded' 时固定写入“用户自行上传”
  provider?: 'modelscope' | 'liblib' | 'unknown';
}

interface VisualBindings {
  characterCard?: {
    primaryAssetId?: string;
    layout?: 'hero-top' | 'inline-top';
    showUploadedNote?: boolean;
  };
}

interface VisualAssetsEnvelope {
  version: 1;
  assets: VisualAssetItem[];
  bindings: VisualBindings;
}

// 角色卡根字段
_visual_assets?: VisualAssetsEnvelope;