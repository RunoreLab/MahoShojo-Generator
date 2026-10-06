/**
 * 角色管理页的产品能力投影（D5.1-P2-r5）。
 *
 * 共享区段只表达「这个宿主此刻提供什么」，不表达「这是什么 runtime」——
 * Web 与 Desktop 各用自己的快照喂同一组组件；未交付的能力表现为入口不存在，
 * 而不是渲染一个点击无效的占位按钮（`DESK-PARITY-001/005`）。
 */
export interface CharacterManagerCapabilities {
  /**
   * 云端数据卡入口深度：
   * - `'manage'`：Web 的完整管理台（浏览、增删改、回收站、公开设置）；
   * - `'browse'`：可浏览并载入编辑，但不能在页内管理云端记录；
   * - `'none'`：不出现任何云端入口。
   */
  readonly cloudCards: 'manage' | 'browse' | 'none';
  /** 立绘生成模块（Web 独有切片；Desktop 未交付）。 */
  readonly tachie: boolean;
  /** 自定义问卷编辑器入口（指南中 `/questionnaire-editor` 链接）。 */
  readonly questionnaireEditor: boolean;
  /** 「内容模板」空白创建与模板转换选择器。 */
  readonly templateSelect: boolean;
  /** 「原生数据」概念与签名保持性说明区块（与宿主保存语义相关，不是纯文案）。 */
  readonly nativenessInfo: boolean;
  /** 敏感词控制台与字段内联提示。 */
  readonly sensitiveWords: boolean;
  /** 结构化情景编辑器（ScenarioEditor 与章节规划编辑）。 */
  readonly scenarioEditors: boolean;
}
