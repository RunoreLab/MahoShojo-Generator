'use client';

import Link from 'next/link';

import { EncyclopediaLinks } from '@/components/encyclopedia/EncyclopediaLinks';
import { ThemeImage } from '@/components/shared/ThemeImage';
import { CollapsibleSection } from '@/components/shared/CollapsibleSection';

export function BattleHeader() {
  return (
    <>
      <div className="text-center mb-4">
        <ThemeImage lightSrc="/arena-black.svg" darkSrc="/arena-white.svg" width={320} height={90} alt="魔法少女竞技场" />
        <p className="subtitle" style={{ marginBottom: '1rem', marginTop: '1rem' }}>
          能亲眼见到强者之战，这下就算死也会值回票价呀！
        </p>
      </div>

      <CollapsibleSection
        title="📰 使用须知"
        description="熟悉流程后可收起，减少滚动"
        defaultOpen
        storageKey="arena.section.guide.open"
        className="mb-6"
        contentClassName="text-sm"
      >
        <ol className="list-decimal list-inside space-y-1">
          <li>
            前往
            <Link href="/details" className="footer-link">
              【奇妙妖精大调查】
            </Link>
            或
            <Link href="/canshou" className="footer-link">
              【研究院残兽调查】
            </Link>
            页面，生成角色并下载其【设定文件】。
          </li>
          <li>收集 2-10 位角色的设定文件（.json 格式）。</li>
          <li>选择预设、上传设定文件，或使用随机匹配功能添加参战者。</li>
          <li>选择一个模式，然后敬请期待「命运的舞台」上的故事！</li>
        </ol>
        <EncyclopediaLinks
          className="mt-3 flex flex-wrap gap-3 text-xs"
          items={[
            { slug: 'arena', text: '百科：竞技场' },
            { slug: 'guidance', text: '引导/裁判事件/读写状态' },
          ]}
          linkClassName="text-blue-700 hover:underline"
        />
      </CollapsibleSection>
    </>
  );
}
