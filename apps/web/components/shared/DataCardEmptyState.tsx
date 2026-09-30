'use client';

import Link from 'next/link';

/**
 * 数据卡选择弹窗的空状态。
 *
 * 此前所有页签共用一句「暂无数据卡」，本地库第一次打开时和公开库为空在
 * 文案、视觉上完全无法区分，而且本地库用户在这个视图里找不到任何填充入口——
 * 唯一的入口（详情弹窗「存到本地库」）在他看不到的地方。这里按页签区分，
 * 并让每个空状态都明确告诉用户下一步能做什么。
 */
export type DataCardEmptyStateTab = 'my' | 'public' | 'recommended' | 'favorites' | 'local';

const LOCAL_LIBRARY_HREF = '/encyclopedia/local-library';

export function DataCardEmptyState({
  tab,
  typeLabel,
  error,
  hasActiveSearch,
  onRetry,
}: {
  tab: DataCardEmptyStateTab;
  /** 弹窗当前的数据卡类型称呼（角色 / 情景 / …），用于拼出「选择X数据卡」这类文案。 */
  typeLabel: string;
  /** 列表加载失败。为真时只提示重试，不假装这是「本来就没有」。 */
  error?: boolean;
  /** 是否处于搜索/筛选状态。搜索无结果和「库里真的没有」要说不同的话。 */
  hasActiveSearch?: boolean;
  onRetry?: () => void;
}) {
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-sm text-gray-500">{tab === 'local' ? '本地库读取失败，请重试。' : '数据卡加载失败，请重试。'}</p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="min-h-11 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 hover:bg-gray-50"
          >
            重试
          </button>
        ) : null}
      </div>
    );
  }

  if (tab === 'local') {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center dark:border-gray-700">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">本地库还是空的</p>
        <p className="mx-auto mt-2 max-w-xl text-xs leading-6 text-gray-600 dark:text-gray-300">
          本地库把{typeLabel}数据卡和 Web 包保存在这台设备的浏览器里，不需要登录、不上传、也不会跟账号跨设备同步。
        </p>
        <ul className="mx-auto mt-3 max-w-xl space-y-1.5 text-left text-xs leading-6 text-gray-600 dark:text-gray-300">
          <li>· 在任意{typeLabel}详情弹窗里点「存到本地库」，把线上那张卡复制一份到本机</li>
          <li>· 勾选导入区的「同时保存到本地库」，之后导入的内容会自动存进来</li>
          <li>· 内容相同的卡会自动更新原卡，不会堆出一堆近似重复项</li>
        </ul>
        <p className="mx-auto mt-3 max-w-xl text-xs leading-6 text-amber-700 dark:text-amber-300">
          ⚠️ 清除本站数据会一并删除本地库；目前还没有整库导出/备份，换设备前请先导出需要的卡。
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={LOCAL_LIBRARY_HREF}
            className="inline-flex min-h-11 items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
          >
            本地库说明
          </Link>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="min-h-11 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
            >
              重新读取
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const copy = (() => {
    if (tab === 'my') {
      return {
        title: `还没有云端${typeLabel}数据卡`,
        hint: '在档案馆里保存或导入一张，就会出现在这里。本地库里的卡属于另一页签，不会列在这里。',
      };
    }
    if (tab === 'favorites') {
      return { title: '还没有收藏', hint: '在其它页签点开「收藏」就能把卡片收进来，收藏同样保存在云端账号里。' };
    }
    if (tab === 'recommended') {
      return { title: '暂时没有推荐内容', hint: '可以先按名称或标签搜索，或到公开库看看。' };
    }
    return {
      title: hasActiveSearch ? '没有匹配的数据卡' : `公开库里还没有公开的${typeLabel}数据卡`,
      hint: hasActiveSearch
        ? '换个关键词，或点「重置」清掉筛选条件再试。'
        : '可以先搜索、粘贴分享链接，或自己生成一张并设为公开。',
    };
  })();

  return (
    <div className="py-8 text-center">
      <p className="text-sm text-gray-500">{copy.title}</p>
      <p className="mx-auto mt-2 max-w-xl text-xs leading-6 text-gray-500">{copy.hint}</p>
    </div>
  );
}
