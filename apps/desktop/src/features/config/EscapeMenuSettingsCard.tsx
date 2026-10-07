import {
  SettingsCard,
  SettingsFieldRow,
  SettingsToggle,
} from '@mahoshojo/ui-web/settings';

import { useDesktopConfig } from './use-desktop-config';

/**
 * 「Esc 快捷菜单」开关（D5.1-N1，`desktop.escapeMenu.enabled`）。
 *
 * 字段归属外观与交互组、持久化在 `config.json`——与其他分组共用同一个
 * `DesktopConfigStore` snapshot，不存在第二份默认值或第二套读写路径。文件不可
 * 编辑（不可作为基底/读取失败）时控件禁用并按默认值生效；文件诊断归「数据与
 * 存储」组的 `DesktopConfigFileCard`，写失败/冲突反馈归设置页共同位置的
 * `DesktopConfigFeedback`（同一份投影，不在此处重复渲染）。
 */
export const EscapeMenuSettingsCard = () => {
  const { state, editable, setField } = useDesktopConfig();
  const busy = state.saving || state.status === 'loading';

  return (
    <SettingsCard
      title="Esc 快捷菜单"
      description="按 Esc 打开快捷操作菜单（继续/首页/本地库/百科/设置）；关闭后 Esc 只逐层关闭已打开的弹层。"
    >
      {state.status === 'unavailable' ? (
        <p role="alert" className="py-3 text-sm text-(--app-accent-strong)">
          配置暂不可用（{state.readError ?? '读取失败'}），已按默认值生效；设置控件暂不可用。
        </p>
      ) : (
        <SettingsFieldRow
          label="Esc 快捷菜单"
          description="菜单不会中断正在进行的生成或离开守卫；跳转与顶栏入口走同一条导航路径。"
          control={
            <SettingsToggle
              checked={state.values.escapeMenuEnabled}
              onChange={(value) => setField('escapeMenuEnabled', value)}
              disabled={!editable || busy}
              ariaLabel="Esc 快捷菜单"
            />
          }
        />
      )}
    </SettingsCard>
  );
};
