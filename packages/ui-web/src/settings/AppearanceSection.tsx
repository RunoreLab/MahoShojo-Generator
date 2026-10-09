/**
 * 「外观与交互」分组内容（DESK-SET-007）。
 *
 * 三个字段全部是 ui-web 设备偏好存储（同 color-mode 先例）：本机
 * localStorage，不同步账号、离线可改、不触发账号查询。主题色与顶栏
 * 外观菜单读的是同一个 `useColorModePreference`，动效标记是 init 脚本
 * 与 `useMotionPreference` 共同维护的 `data-motion`——页面内与设置页
 * 修改的是同一个值。
 */
import { COLOR_MODE_OPTIONS, useColorModePreference } from '../color-mode/index';
import {
  MOTION_PREFERENCE_OPTIONS,
  useMotionPreference,
  useResultAutoScrollEnabled,
} from '../device-preferences/index';

import { SettingsCard, SettingsFieldRow, SettingsOptionButtons, SettingsToggle } from './primitives';

export const AppearanceSettingsSection = () => {
  const colorMode = useColorModePreference();
  const motion = useMotionPreference();
  const autoScroll = useResultAutoScrollEnabled();

  return (
    <div className="flex flex-col gap-4">
      <SettingsCard
        title="外观"
        description="保存在本机设备上，不随账号同步。"
      >
        <div className="divide-y divide-(--app-border)">
          <SettingsFieldRow
            label="主题"
            control={
              <SettingsOptionButtons
                ariaLabel="主题"
                value={colorMode.preference}
                options={COLOR_MODE_OPTIONS}
                onChange={colorMode.setPreference}
              />
            }
          />
          <SettingsFieldRow
            label="减少动态效果"
            description="「跟随系统」读取系统偏好；「减少」始终关闭非必要动效。"
            control={
              <SettingsOptionButtons
                ariaLabel="减少动态效果"
                value={motion.preference}
                options={MOTION_PREFERENCE_OPTIONS}
                onChange={motion.setPreference}
              />
            }
          />
        </div>
      </SettingsCard>
      <SettingsCard
        title="交互"
      >
        <div className="divide-y divide-(--app-border)">
          <SettingsFieldRow
            label="结果自动定位"
            description="新生成的数据卡或战报首次可预览且位于视口下方时自动定位；同一结果只定位一次，恢复与历史查看不触发。"
            control={
              <SettingsToggle
                ariaLabel="结果自动定位"
                checked={autoScroll.enabled}
                onChange={autoScroll.setEnabled}
              />
            }
          />
        </div>
      </SettingsCard>
    </div>
  );
};
