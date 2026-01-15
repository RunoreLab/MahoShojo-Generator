'use client';

import Link from 'next/link';

import { EncyclopediaLinks } from '@/components/encyclopedia/EncyclopediaLinks';
import { ThemeImage } from '@/components/shared/ThemeImage';

export function BattleHeader() {
  return (
    <>
      <div className="text-center mb-4">
        <ThemeImage lightSrc="/arena-black.svg" darkSrc="/arena-white.svg" width={320} height={90} alt="魔法少女竞技场" />
        <p className="subtitle" style={{ marginBottom: '1rem', marginTop: '1rem' }}>
          能亲眼见到强者之战，这下就算死也会值回票价呀！
        </p>
      </div>

      <div className="mb-6 p-4 bg-gray-200 border border-gray-300 rounded-lg text-sm text-gray-800">
        <h3 className="font-bold mb-2">📰 使用须知</h3>
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
      </div>
    </>
  );
}
