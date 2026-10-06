import { useState, type ComponentType, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';

import type { CharacterManagerCapabilities } from './capabilities';

/** 宿主内链组件：Web 是 `next/link`，Desktop 是 router 内导航 `<a>`。 */
export interface CharacterManagerLinkProps {
  href: string;
  className?: string;
  title?: string;
  onClick?: (event: ReactMouseEvent<HTMLAnchorElement>) => void;
  children?: ReactNode;
}
export type CharacterManagerLinkComponent = ComponentType<CharacterManagerLinkProps>;

export interface CharacterManagerGuideProps {
  readonly capabilities: CharacterManagerCapabilities;
  /** 「保存与导出」条目的正文：Web 是下载/剪贴板，Desktop 是本地库/导出。 */
  readonly saveAndExportText: ReactNode;
  /** 加载条目的附加说明（如「我的数据卡」入口），可选。 */
  readonly loadExtraText?: ReactNode;
  /** 指南尾部宿主附加说明块（Desktop：本地库/签名语义说明）。 */
  readonly extraSections?: ReactNode;
  readonly linkComponent?: CharacterManagerLinkComponent;
  readonly defaultOpen?: boolean;
}

/**
 * 「使用指南」折叠区。条目的存在性由能力投影决定——未交付的能力（立绘、问卷编辑器、
 * 原生性说明）在不具备的宿主上整段不出现，而不是降级成误导性文案。
 */
export function CharacterManagerGuide({
  capabilities,
  saveAndExportText,
  loadExtraText,
  extraSections,
  linkComponent: Link,
  defaultOpen = true,
}: CharacterManagerGuideProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="mb-6 p-4 bg-gray-100 border border-gray-300 rounded-lg text-sm text-gray-800">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full text-left font-bold text-gray-700 mb-2 focus:outline-none"
      >
        {isOpen ? '▼' : '▶'} 使用指南
      </button>
      {isOpen && (
        <div className="mt-2 space-y-3">
          <div>
            <h4 className="font-semibold text-gray-800">核心功能：</h4>
            <ul className="list-disc list-inside space-y-1 mt-1 pl-2">
              <li>
                <span className="font-semibold">加载角色：</span>
                通过上传 <code>.json</code> 文件或直接粘贴文本内容来加载你的角色档案。
                {loadExtraText}
              </li>
              <li><span className="font-semibold">编辑数据：</span>可视化地查看并修改角色的各项设定，包括调整历战记录和新增的“内嵌随机事件”。</li>
              <li><span className="font-semibold">一键换名：</span>修改名称后，可一键替换档案中所有旧名称。</li>
              {capabilities.tachie ? (
                <li><span className="font-semibold">生成立绘：</span>加载角色后，展开下方的“立绘生成”模块，可为你的角色创建立绘。</li>
              ) : null}
              {capabilities.scenarioEditors ? (
                <li><span className="font-semibold">编辑情景：</span>响应用户呼声，现在可以在这里编辑情景文件了。</li>
              ) : null}
              {capabilities.questionnaireEditor && Link ? (
                <li><span className="font-semibold">问卷编辑器：</span><Link href="/questionnaire-editor" className="text-purple-600 hover:text-purple-700 underline">创建与调整自定义问卷</Link>，可导出或保存为云端问卷数据卡。</li>
              ) : null}
              <li><span className="font-semibold">保存与导出：</span>{saveAndExportText}</li>
            </ul>
          </div>
          {capabilities.nativenessInfo ? (
            <>
              <div>
                <h4 className="font-semibold text-gray-800">关于“原生数据”：</h4>
                <ul className="list-disc list-inside space-y-1 mt-1 pl-2">
                  <li>“原生数据”指由本生成器直接产出、未经核心修改的角色文件。它包含一个数字签名，用于验证其真实性。</li>
                  <li>在竞技场等功能中，系统会更信任原生数据。对非原生数据可能会启用更严格的内容安全检查。</li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold text-gray-800">如何保持角色“原生性”：</h4>
                <p className="mt-1">
                  请注意：对角色档案的<span className="font-bold text-red-600">绝大多数修改</span>都会使其失去“原生性”，保存后数字签名将被移除。
                </p>
                <p className="mt-2">
                  以下是<span className="font-bold text-green-600">唯一允许</span>在保持原生性的前提下进行的操作：
                </p>
                <ul className="list-disc list-inside space-y-1 mt-1 pl-2">
                  <li>修改角色的 <code className="bg-gray-200 px-1 rounded text-xs">codename</code> (魔法少女) 或 <code className="bg-gray-200 px-1 rounded text-xs">name</code> (残兽) 字段。</li>
                  <li>在“历战记录管理”中<span className="font-semibold">删除</span>一条或多条历史记录。</li>
                  <li>在“历战记录管理”中点击<span className="font-semibold">“重置属性”或“清除所有记录”</span>按钮。</li>
                  <li><span className="font-semibold">添加、编辑或删除</span>内嵌的随机事件。</li>
                </ul>
                <p className="text-xs text-gray-500 mt-2">（注：新增或修改历战记录、编辑除上述豁免字段外的任何字段，都会导致原生性丧失。）</p>
              </div>
            </>
          ) : null}
          {extraSections}
        </div>
      )}
    </div>
  );
}
