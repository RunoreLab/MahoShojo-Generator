import { useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';

import {
  SETTINGS_GROUPS,
  isSettingsGroupId,
  settingsGroupAnchorId,
  type SettingsGroupId,
} from './groups';

/**
 * 共同设置页壳（DESK-SET-001）。
 *
 * 分组名称与顺序由 `SETTINGS_GROUPS` 定义，两端一致；宿主只为有实际
 * 内容的分组传入 `content`——空分组整体不渲染，不放占位开关
 * （「无此宿主能力的条目隐藏」）。
 *
 * `section` 深链：Web `/settings?section=account` 与 Desktop
 * `#/settings?section=account` 落到同一锚点约定 `settings-<group>`；
 * 旧 `/me?tab=settings` 由 Web 侧兼容重定向到 `?section=account`。
 * 非法 section 值按未指定处理（落回页面顶部），不报错。
 */

export interface SettingsGroupSection {
  id: SettingsGroupId;
  /** 缺省用分组登记的统一名称。 */
  title?: ReactNode;
  description?: ReactNode;
  content: ReactNode;
}

export interface SettingsPageProps {
  /** `?section=` 解析出的分组 id；非法值宿主应传 undefined。 */
  section?: string;
  /** 页头标题/导语可按宿主口径覆盖。 */
  heading?: ReactNode;
  intro?: ReactNode;
  groups: ReadonlyArray<SettingsGroupSection>;
}

export const SettingsPage = ({ section, heading = '设置', intro, groups }: SettingsPageProps) => {
  const orderedGroups = useMemo(() => {
    const provided = new Map(groups.map((group) => [group.id, group]));
    return SETTINGS_GROUPS.filter((group) => provided.has(group.id)).map((group) => ({
      meta: group,
      section: provided.get(group.id)!,
    }));
  }, [groups]);

  // 深链章节定位：挂载后把目标分组滚进视野。只在 section 变化时执行，
  // 用户后续滚动不被拉回。
  useEffect(() => {
    if (section === undefined || !isSettingsGroupId(section)) return;
    const target = document.getElementById(settingsGroupAnchorId(section));
    target?.scrollIntoView({ block: 'start' });
  }, [section]);

  return (
    <div data-testid="settings-page" className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
      <header>
        <h1 className="text-lg font-semibold text-(--app-text)">{heading}</h1>
        {intro ? <p className="mt-1 text-sm text-(--app-text-muted)">{intro}</p> : null}
        {orderedGroups.length > 1 ? (
          <nav aria-label="设置分组" className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            {orderedGroups.map(({ meta }) => (
              <button
                key={meta.id}
                type="button"
                className="text-xs text-(--app-text-muted) underline-offset-2 transition hover:text-(--app-accent-strong) hover:underline"
                onClick={() => {
                  document
                    .getElementById(settingsGroupAnchorId(meta.id))
                    ?.scrollIntoView({ block: 'start' });
                }}
              >
                {meta.label}
              </button>
            ))}
          </nav>
        ) : null}
      </header>
      {orderedGroups.map(({ meta, section: groupSection }) => (
        <section
          key={meta.id}
          id={settingsGroupAnchorId(meta.id)}
          aria-label={meta.label}
          className="scroll-mt-24"
        >
          <h2 className="mb-2 text-sm font-semibold text-(--app-text-muted)">
            {groupSection.title ?? meta.label}
          </h2>
          {groupSection.description ? (
            <p className="mb-2 text-xs text-(--app-text-subtle)">{groupSection.description}</p>
          ) : null}
          <div className="flex flex-col gap-4">{groupSection.content}</div>
        </section>
      ))}
    </div>
  );
};
