import type { ReactNode } from 'react';
import { ThemeImage } from '../media/ThemeImage';
import { EncyclopediaLinks } from '../encyclopedia/views/EncyclopediaLinks';

/** Web/Desktop 共用单列外框；输入卡、结果卡与宿主弹窗保持兄弟位置。 */
export function SublimationPageFrame({ children, afterContainer }: { children: ReactNode; afterContainer?: ReactNode }) {
  return <div data-testid="page-sublimation" className="magic-background-white"><div className="container">{children}</div>{afterContainer}</div>;
}

export function SublimationPageHeader({ onNavigate, resolveInternalHref, loreEnabled = true }: { onNavigate: (href: string) => void; resolveInternalHref?: (href: string) => string; loreEnabled?: boolean }) {
  return <>
    <div className="text-center mb-4">
        <div className="flex justify-center items-center" style={{ marginBottom: '1rem' }}>
            <ThemeImage lightSrc="/sublimation.svg" darkSrc="/sublimation-white.svg" width={360} height={40} alt="角色成长升华" />
        </div>
        <p className="subtitle mt-2">角色成长升华，见证她们在战斗与经历中完成的蜕变</p>
    </div>
    <div className="mb-6 p-4 bg-purple-50 border border-purple-200 rounded-lg text-sm text-purple-800">
        <h3 className="font-bold mb-2">✨ 功能说明</h3>
        <ol className="list-decimal list-inside space-y-1">
            <li>上传任意.json格式的设定文件（部分兼容非规范文件），历战记录 <span className="font-semibold">可选</span>，如存在会增强升华叙事。</li>
            <li>选择目标模板（默认沿用原模板，无匹配时自动切换为通用角色），并可指定需要保留的字段。如果希望借此切换角色模板，建议选择【完全重塑】。</li>
            <li>可额外提供叙事历史（手动输入或上传），AI 将结合设定、历战记录与成长引导生成“升华后”的新形态设定。</li>
            <li>若提供叙事历史，本次升华结果将标记为<strong>非原生</strong>。</li>
            {loreEnabled && <li>若注入了<strong>非原生许可</strong>的问卷/设定卡设定（Lore），本次升华结果同样会标记为<strong>非原生</strong>。</li>}
        </ol>
        <EncyclopediaLinks className="mt-3 flex flex-wrap gap-3 text-xs" onNavigate={onNavigate} resolveInternalHref={resolveInternalHref} items={[{ slug: 'sublimation', text: '百科：成长升华' }, { slug: 'sensitive-words', text: '敏感词与逮捕（含恢复）' }, { slug: 'shield-words', text: '屏蔽词（和谐替换）' }, { slug: 'archive', text: '档案馆（角色管理）' }]} />
    </div>

  </>;
}
