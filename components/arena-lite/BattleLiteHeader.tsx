'use client';

import Link from 'next/link';

import { EncyclopediaLinks } from '@/components/encyclopedia/EncyclopediaLinks';
import { ThemeImage } from '@/components/shared/ThemeImage';
import { CollapsibleSection } from '@/components/shared/CollapsibleSection';

import { ArenaPageLinks } from '@/components/arena/shared/ArenaPageLinks';

export function BattleLiteHeader() {
  return (
    <>
      <div className="battle-lite-hero-card relative overflow-hidden rounded-[28px] border px-5 py-6 text-center sm:px-8">
        <div className="battle-lite-hero-pill inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold tracking-[0.22em]">
          简洁版竞技场
        </div>
        <div className="mt-4 flex justify-center">
          <ThemeImage lightSrc="/arena-black.svg" darkSrc="/arena-white.svg" width={300} height={84} alt="魔法少女竞技场" />
        </div>
        <p className="battle-lite-muted-text mt-4 text-sm leading-6 sm:text-[15px]">
          基于 2025 年 9 月的轻量怀旧版本，同时加入了选择AI模型等实用新功能，继续复用最新版竞技场后端与结果链路。
        </p>
        <div className="battle-lite-subtle-text mt-4 flex flex-wrap items-center justify-center gap-2 text-xs sm:text-sm">
          <span>需要辅助情景、问卷 Lore 等完整能力时，可随时</span>
          <ArenaPageLinks variant="lite" className="battle-lite-link font-semibold" />
        </div>
      </div>

      <CollapsibleSection
        title="📰 使用须知"
        description="熟悉后可收起该部分，或前往完整版竞技场获取更丰富的功能。"
        defaultOpen
        storageKey="battle-lite.section.guide.open"
        className="mt-5"
        contentClassName="text-sm"
      >
        <ol className="battle-lite-muted-text list-decimal list-inside space-y-2">
          <li>
            本页是 `/battle` 简洁版，与
            <Link href="/arena" className="battle-lite-link mx-1">
              完整版竞技场
            </Link>
            共享同一套已选角色、情景与生成结果。
          </li>
          <li>
            前往
            <Link href="/details" className="battle-lite-link mx-1">
              奇妙妖精大调查
            </Link>
            或
            <Link href="/canshou" className="battle-lite-link mx-1">
              研究院残兽调查
            </Link>
            页面生成角色并下载设定文件，或直接使用本页的预设角色 / 在线角色库。
          </li>
          <li>简洁版只保留主情景、故事方向引导、自定义 AI 提供商和基础生成方式；高级控制项已收敛到完整版。</li>
          <li>页面底部仍保留连续战报会话、立绘生成等结果扩展能力。</li>
        </ol>
        <EncyclopediaLinks
          className="mt-3 flex flex-wrap gap-3 text-xs"
          items={[
            { slug: 'arena', text: '百科：竞技场' },
            { slug: 'guidance', text: '百科：故事引导与读写状态' },
          ]}
          linkClassName="battle-lite-link"
        />
      </CollapsibleSection>
    </>
  );
}
