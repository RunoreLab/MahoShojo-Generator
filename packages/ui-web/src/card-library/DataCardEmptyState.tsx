import type { ReactNode } from 'react';

/**
 * 数据卡选择弹窗的空状态。
 *
 * 此前所有页签共用一句「暂无数据卡」，本地库第一次打开时和公开库为空在
 * 文案、视觉上完全无法区分，而且本地库用户在这个视图里找不到任何填充入口——
 * 唯一的入口（详情弹窗「存到本地库」）在他看不到的地方。这里按页签区分，
 * 并让每个空状态都明确告诉用户下一步能做什么。
 */
export type DataCardEmptyStateTab = 'my' | 'public' | 'recommended' | 'favorites' | 'local';

/**
 * 「这一页签本来就没有」和「搜索/筛选没命中」必须分开说。
 *
 * 页签徽标显示的是**未过滤**的总数，所以在本地库里搜不到东西时，界面会同时出现
 * `本地库 (5)` 和空列表——这时说「本地库还是空的」不只是含糊，还会把用户推去
 * 重新导入他们已经有的卡，正好抵消掉去重设计要防的事。
 */
const NoQueryMatch = ({ title, hint }: { title: string; hint: string }) => (
  <div className="py-8 text-center">
    <p className="text-sm text-gray-500">{title}</p>
    <p className="mx-auto mt-2 max-w-xl text-xs leading-6 text-gray-500">{hint}</p>
  </div>
);

export function DataCardEmptyState({
  tab,
  typeLabel,
  error,
  hasActiveSearch,
  onRetry,
  localLibraryLink,
  renderLocalEmpty,
  cacheView,
  cachedStatus,
}: {
  tab: DataCardEmptyStateTab;
  /** 弹窗当前的数据卡类型称呼（角色 / 情景 / …），用于拼出「选择X数据卡」这类文案。 */
  typeLabel: string;
  /** 列表加载失败。为真时只提示重试，不假装这是「本来就没有」。 */
  error?: boolean;
  /** 是否处于搜索/标签/高级筛选状态。 */
  hasActiveSearch?: boolean;
  onRetry?: () => void;
  /** 「本地」空态里的本地库入口链接（宿主注入，Web 是 next/link）。 */
  localLibraryLink?: ReactNode;
  /** 「本地」空态整体替换：存储介质/风险措辞是宿主事实（浏览器站点数据 vs 本机磁盘）。 */
  renderLocalEmpty?: (context: { typeLabel: string; onRetry?: () => void }) => ReactNode;
  /** 公开缓存视图（D5.1-K2）：'browse' 用户主动浏览缓存；'degraded' 在线失败降级到缓存。 */
  cacheView?: 'browse' | 'degraded' | null;
  /** 缓存库状态——unavailable/unsupported-schema 时空态要如实说明，不冒充「缓存为空」。 */
  cachedStatus?: 'empty' | 'ready' | 'unavailable' | 'unsupported-schema';
}) {
  // 缓存视图里「缓存不可读 / 版本不兼容」必须先于线上错误文案——
  // 缓存故障不能伪装成「缓存为空」（DESK-CACHE-002），降级场景的
  // 线上失败只增加上下文，不抢走这个优先级。
  if (cacheView) {
    if (cachedStatus === 'unavailable') {
      return (
        <NoQueryMatch
          title={cacheView === 'degraded' ? '公开库连接失败，本机缓存当前也不可读取' : '本机缓存当前不可用'}
          hint="缓存文件无法读写（可能被占用或损坏）。这不影响本地库与线上公开库——线上恢复后可重试，修复缓存后即可继续浏览。"
        />
      );
    }
    if (cachedStatus === 'unsupported-schema') {
      return (
        <NoQueryMatch
          title={cacheView === 'degraded' ? '公开库连接失败，且本机缓存由更新版本的应用创建' : '本机缓存由更新版本的应用创建'}
          hint="当前版本不能读取它，也不会覆盖写入。升级应用后可继续使用；线上公开库不受影响。"
        />
      );
    }
    if (error && cacheView === 'degraded') {
      // 主动浏览缓存视图时线上错误与「缓存里有什么」无关——
      // 只有自动降级才需要把线上失败写进空态并提供重试。
      return (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-sm text-gray-500">公开库连接失败，本机缓存中也没有可显示的内容。</p>
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
    if (hasActiveSearch) {
      return (
        <NoQueryMatch
          title="本机缓存中没有匹配的内容"
          hint="离线搜索只作用于已缓存的集合。换个关键词或清空筛选再试；缓存里没有不等于线上没有。"
        />
      );
    }
    return (
      <NoQueryMatch
        title={cacheView === 'degraded' ? '线上不可用，且本机缓存还没有捕获过公开资料' : '本机缓存中还没有公开的' + typeLabel + '数据卡'}
        hint="联网状态下浏览公开库时，可公开的内容会自动缓存到本机，之后离线也能浏览。缓存里没有不等于线上没有。"
      />
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-sm text-gray-500">
          {tab === 'local' ? '本地库读取失败，请重试。' : '数据卡加载失败，请重试。'}
        </p>
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
    if (hasActiveSearch) {
      return (
        <NoQueryMatch
          title="没有匹配的本地数据卡"
          hint="本地库里是有卡的，只是当前的搜索 / 标签 / 筛选条件没有命中。页签上的数字显示的是未过滤的总数。清空搜索框，或用标签区的「清空」与高级筛选的「重置」再试。"
        />
      );
    }
    if (renderLocalEmpty) {
      return <>{renderLocalEmpty({ typeLabel, onRetry })}</>;
    }
    return (
      <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center dark:border-gray-700">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">本地库还是空的</p>
        <p className="mx-auto mt-2 max-w-xl text-xs leading-6 text-gray-600 dark:text-gray-300">
          本地库把{typeLabel}数据卡和 Web 包保存在这台设备的浏览器里，不需要登录、不上传、也不会跟账号跨设备同步。
        </p>
        <ul className="mx-auto mt-3 max-w-xl space-y-1.5 text-left text-xs leading-6 text-gray-600 dark:text-gray-300">
          <li>· 在任意{typeLabel}详情弹窗里点「存到本地库」，把线上那张卡复制一份到本机</li>
          <li>· 在竞技场上传参战者时勾选「同时保存到本地库」，之后上传的内容会自动存进来</li>
          <li>· 内容相同的卡会自动更新原卡，不会堆出一堆近似重复项</li>
        </ul>
        <p className="mx-auto mt-3 max-w-xl text-xs leading-6 text-amber-700 dark:text-amber-300">
          ⚠️ 清除本站数据会一并删除本地库；换设备前请用「本地库」页面的整库导出一份 `.zip`。
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          {localLibraryLink}
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
      title: `公开库里还没有公开的${typeLabel}数据卡`,
      hint: '可以先搜索、粘贴分享链接，或自己生成一张并设为公开。',
    };
  })();

  if (hasActiveSearch) {
    return (
      <NoQueryMatch
        title="没有匹配的数据卡"
        hint="换个关键词，或清空搜索框、用标签区的「清空」与高级筛选的「重置」再试。"
      />
    );
  }

  return (
    <div className="py-8 text-center">
      <p className="text-sm text-gray-500">{copy.title}</p>
      <p className="mx-auto mt-2 max-w-xl text-xs leading-6 text-gray-500">{copy.hint}</p>
    </div>
  );
}
