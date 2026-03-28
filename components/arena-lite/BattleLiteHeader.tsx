'use client';

import Link from 'next/link';

import { EncyclopediaLinks } from '@/components/encyclopedia/EncyclopediaLinks';
import { ThemeImage } from '@/components/shared/ThemeImage';
import { CollapsibleSection } from '@/components/shared/CollapsibleSection';

import { ArenaPageLinks } from '@/components/arena/shared/ArenaPageLinks';

export function BattleLiteHeader() {
  return (
    <>
      <div
        className="relative overflow-hidden rounded-[28px] border px-5 py-6 text-center sm:px-8"
        style={{
          borderColor: 'rgba(244, 114, 182, 0.18)',
          background:
            'linear-gradient(135deg, rgba(255,255,255,0.96) 0%, rgba(253,242,248,0.92) 45%, rgba(239,246,255,0.88) 100%)',
          boxShadow: '0 18px 45px rgba(244, 114, 182, 0.12)',
        }}
      >
        <div className="inline-flex items-center rounded-full border border-pink-200 bg-white/80 px-3 py-1 text-xs font-semibold tracking-[0.22em] text-pink-700">
          简洁版竞技场
        </div>
        <div className="mt-4 flex justify-center">
          <ThemeImage lightSrc="/arena-black.svg" darkSrc="/arena-white.svg" width={300} height={84} alt="魔法少女竞技场" />
        </div>
        <p className="mt-4 text-sm leading-6 text-slate-700 sm:text-[15px]">
          基于 2025 年 9 月的单列流程重新整理，优先保留第一次打开时的轻量感，同时继续复用最新版后端与结果链路。
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-600 sm:text-sm">
          <span>需要辅助情景、问卷 Lore、裁判编辑器等完整能力时，可随时</span>
          <ArenaPageLinks variant="lite" className="font-semibold text-sky-700 hover:underline" />
        </div>
      </div>

      <CollapsibleSection
        title="📰 使用须知"
        description="熟悉后可收起；这里也说明了简洁版 / 完整版的分流方式"
        defaultOpen
        storageKey="battle-lite.section.guide.open"
        className="mt-5"
        contentClassName="text-sm"
      >
        <ol className="list-decimal list-inside space-y-2 text-slate-700">
          <li>
            本页是 `/battle` 简洁版，与
            <Link href="/arena" className="mx-1 text-sky-700 hover:underline">
              完整版竞技场
            </Link>
            共享同一套已选角色、情景与生成结果。
          </li>
          <li>
            前往
            <Link href="/details" className="mx-1 text-pink-700 hover:underline">
              奇妙妖精大调查
            </Link>
            或
            <Link href="/canshou" className="mx-1 text-pink-700 hover:underline">
              研究院残兽调查
            </Link>
            页面生成角色并下载设定文件，或直接使用本页的预设角色 / 在线角色库。
          </li>
          <li>简洁版只保留主情景、故事方向引导、自定义 AI 提供商和基础生成方式；高级控制项已收敛到完整版。</li>
          <li>页面底部仍保留连续战报会话、立绘生成等结果扩展能力，便于在主流程完成后继续使用。</li>
        </ol>
        <EncyclopediaLinks
          className="mt-3 flex flex-wrap gap-3 text-xs"
          items={[
            { slug: 'arena', text: '百科：竞技场' },
            { slug: 'guidance', text: '百科：故事引导与读写状态' },
          ]}
          linkClassName="text-blue-700 hover:underline"
        />
      </CollapsibleSection>
    </>
  );
}
