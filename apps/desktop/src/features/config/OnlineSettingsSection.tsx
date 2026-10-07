import {
  SettingsCard,
  SettingsFieldRow,
  SettingsOptionButtons,
  SettingsToggle,
} from '@mahoshojo/ui-web/settings';
import type { AnnouncementsCheckPolicy } from '@mahoshojo/contracts/desktop-config';

import { useDesktopConfig } from './use-desktop-config';

/**
 * 设置页「在线与通知」分组（D5.1-S2，`DESK-SET-004`/`005`）。
 *
 * 两个真实消费者字段：公告检查策略、内容外链确认——同一 config snapshot
 * 同时喂给这里的控件和 `DesktopAnnouncementsStore`/`ExternalLinksProvider`，
 * 不产生第二份本地默认值。写入反馈（saveError/冲突草稿）归设置页共同
 * 位置的 `DesktopConfigFeedback`，文件诊断归「数据与存储」组的
 * `DesktopConfigFileCard`——config 字段已跨分组分布，文件级状态不再
 * 绑在本组（D5.1-N1-r1）。
 */

const CHECK_POLICY_OPTIONS: ReadonlyArray<{ value: AnnouncementsCheckPolicy; label: string }> = [
  { value: 'on-launch', label: '启动时检查' },
  { value: 'manual', label: '仅手动' },
];

export const OnlineSettingsSection = () => {
  const { state, editable, setField } = useDesktopConfig();
  const busy = state.saving || state.status === 'loading';

  return (
    <div className="flex flex-col gap-4">
      <SettingsCard
        title="公告与外链"
        description="保存在本机配置文件中，不随账号同步。"
      >
        {state.status === 'loading' && state.fileStatus === 'unknown' ? (
          <p role="status" className="py-3 text-sm text-(--app-text-subtle)">
            正在读取配置…
          </p>
        ) : null}
        {state.status === 'unavailable' ? (
          <p role="alert" className="py-3 text-sm text-(--app-accent-strong)">
            配置暂不可用（{state.readError ?? '读取失败'}），已按默认值生效；设置控件暂不可用。
          </p>
        ) : null}
        {state.status === 'ready' || state.status === 'loading' ? (
          <>
            <SettingsFieldRow
              label="公告检查"
              description="启动时自动获取一次公告，或仅在公告入口里手动刷新。"
              control={
                <SettingsOptionButtons
                  value={state.values.announcementsCheckPolicy}
                  options={CHECK_POLICY_OPTIONS}
                  onChange={(value) => {
                    if (editable && !busy) setField('announcementsCheckPolicy', value);
                  }}
                  disabled={!editable || busy}
                  ariaLabel="公告检查策略"
                />
              }
            />
            <SettingsFieldRow
              label="内容外链确认"
              description="打开消息、卡片等用户内容里的链接前进行确认；固定产品链接不受影响。"
              control={
                <SettingsToggle
                  checked={state.values.confirmContentLinks}
                  onChange={(value) => setField('confirmContentLinks', value)}
                  disabled={!editable || busy}
                  ariaLabel="内容外链确认"
                />
              }
            />
          </>
        ) : null}
      </SettingsCard>
    </div>
  );
};
