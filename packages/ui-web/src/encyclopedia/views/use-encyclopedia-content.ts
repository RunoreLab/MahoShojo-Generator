import { useCallback, useEffect, useState } from 'react';

import { encyclopediaContentUrl, type EncyclopediaContentSource } from '../content-source';
import { getEncyclopediaEntry, type EncyclopediaEntry } from '../catalog';

/**
 * 条目正文的取回。
 *
 * ## 为什么由共享层负责，而不只是把 fetch 交给宿主
 *
 * 正文 URL 由 `EncyclopediaContentSource` 决定（`D3.0-1`），因此共享层已经知道该读什么。真正由宿主
 * 决定的只有一件：**base 在哪**。把 fetch 一起收进来，两个 app 就不会各自实现一遍 loading / error /
 * 竞态处理——而那份竞态处理正是"快速切换条目时旧正文覆盖新正文"这类 bug 的来源。
 *
 * `reload` 依赖保证条目切换时重新取回。忽略它会让上一条目的正文留在界面上，这是竞态而不是缓存。
 */
export interface EncyclopediaContentState {
  readonly entry: EncyclopediaEntry | null;
  readonly content: string;
  readonly loading: boolean;
  readonly error: string | null;
}

export const useEncyclopediaContent = (
  slug: string | undefined,
  source: EncyclopediaContentSource,
): EncyclopediaContentState => {
  const entry = getEncyclopediaEntry(slug) ?? null;
  const [state, setState] = useState<{ slug: string | undefined; content: string; error: string | null }>({
    slug: undefined,
    content: '',
    error: null,
  });

  // 记录上一次请求的 slug，让 effect 只在它变化时重新取回。直接依赖 entry 对象会让每次渲染都
  // 产生新引用，从而每帧重取一次。
  const requestedSlug = entry?.slug;

  useEffect(() => {
    if (!entry) {
      setState({ slug: undefined, content: '', error: null });
      return;
    }

    let cancelled = false;
    setState((previous) => ({ slug: requestedSlug, content: previous.slug === requestedSlug ? previous.content : '', error: null }));

    void fetch(encyclopediaContentUrl(source, entry.contentFile))
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.text();
      })
      .then((content) => {
        if (!cancelled) setState({ slug: requestedSlug, content, error: null });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setState({
          slug: requestedSlug,
          content: '',
          error: cause instanceof Error ? cause.message : String(cause),
        });
      });

    return () => {
      cancelled = true;
    };
    // source 是宿主注入的常量对象；把它写进依赖会让每次渲染都重新取回。
  }, [entry, requestedSlug, source]);

  return {
    entry,
    content: state.slug === requestedSlug ? state.content : '',
    loading: entry !== null && state.slug === requestedSlug && state.error === null && state.content === '',
    error: state.slug === requestedSlug ? state.error : null,
  };
};

/**
 * 供宿主使用的稳定回调。
 *
 * 目录页与条目页都要把「点了某一条目」交给自己的 router；把它做成 hook 而不是让每个调用点各自
 * `useCallback`，是为了让签名只有一处。
 */
export const useEncyclopediaEntryHref = (): ((slug: string) => string) =>
  useCallback((slug: string) => `/encyclopedia/${slug}`, []);