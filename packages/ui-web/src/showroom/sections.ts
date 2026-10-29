/**
 * 共源视觉样板间分区登记表（SPEC-visual-baseline-v1 VIS-SHOW-001）。
 *
 * 纯数据模块：`ShowroomView` 据此渲染分区导航与内容；契约测试据此校验
 * spec 要求的必备分区都在表内。新增共享组件域时在同一工作单元把它的
 * 样板挂进对应分区——分区就是审查入口，不允许留下无法审查的孤立组件。
 */

export type ShowroomSectionId =
  | 'semantic-colors'
  | 'typography'
  | 'scales'
  | 'controls'
  | 'forms'
  | 'overlay'
  | 'result-surfaces'
  | 'footer';

export interface ShowroomSectionMeta {
  readonly id: ShowroomSectionId;
  readonly title: string;
  readonly summary: string;
}

export const SHOWROOM_SECTIONS: readonly ShowroomSectionMeta[] = [
  {
    id: 'semantic-colors',
    title: '语义色板',
    summary: 'styles.css 的 --app-*/--creator-* 语义 token，亮/暗由根 color-mode 统一解析。',
  },
  {
    id: 'typography',
    title: '字体阶梯',
    summary: '--app-font-sans/--app-font-mono 字体族与 --app-text-* 字号阶。',
  },
  {
    id: 'scales',
    title: '主题无关刻度',
    summary: '--app-space-* 4px 间距网格、--app-radius-* 圆角、--app-shadow-* 阴影、--app-z-* 层级。',
  },
  {
    id: 'controls',
    title: '操作控件',
    summary: '生成操作三档（primary/secondary/destructive）与禁用态；问卷生产导航的上一题/下一题、必答、提交中及蓝色主题；直接页码跳转的确认、范围校验与加载禁用态。',
  },
  {
    id: 'forms',
    title: '表单底座',
    summary: '.input-group/.input-label/.input-field、生成方式默认/宿主说明、卡牌工坊源卡/附加要求输入与主题色选中/自定义态、NovelAI 简单/自定义/禁用设置与优化器插槽、模型选择器长列表的局部滚动/状态更新/键盘导航及 battle-lite 文本/盒面共享类。',
  },
  {
    id: 'overlay',
    title: '弹层',
    summary: '共源 BaseModal 原语：Escape 层级栈、焦点圈留与背景点按与生产一致；叙事历史选择器的空列表、JSON 导入入口与反馈。',
  },
  {
    id: 'result-surfaces',
    title: '卡片与结果面',
    summary: '情景安全 Markdown 与可撤回换行预览、真实角色结果卡与导出账号标注、完整结果 JSON 复制、角色更新折叠保留状态、竞技场安全源码、普通/Web 显示与沉浸工具栏、独立作品窗口控件与长源码滚动、完整/简版结果布局、战报卡片自动/手动宽度与禁用态、品牌/模型用量、故事读取错误、红蓝错误文字与完整/简化版操作反馈、图片生成等待/未知结果/原任务查询、独立图片库上传/预览/回收站与删除确认。',
  },
  {
    id: 'footer',
    title: '页脚',
    summary: 'ProductFooter 共源页脚：站内/站外导航、品牌资源与主题联动，以及 Web 专属下载链接插槽。',
  },
];
