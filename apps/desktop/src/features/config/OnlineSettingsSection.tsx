import {
  SettingsCard,
  SettingsFieldRow,
  SettingsOptionButtons,
  SettingsToggle,
} from '@mahoshojo/ui-web/settings';
import type { AnnouncementsCheckPolicy } from '@mahoshojo/contracts/desktop-config';

import { useDesktopConfig } from './use-desktop-config';

/**
 * 设置页「在线」分组（D5.1-S2，`DESK-SET-004`/`005`）。
 *
 * 两个真实消费者字段：公告检查策略、内容外链确认——同一 config snapshot
 * 同时喂给这里的控件和 `DesktopAnnouncementsStore`/`ExternalLinksProvider`，
 * 不产生第二份本地默认值。下方诊断卡是「人工配置」这条产品线的另一半：
 * 文件在哪、坏了怎么办（重载/恢复默认/打开目录），全部走窄命令。
 */

const CHECK_POLICY_OPTIONS: ReadonlyArray<{ value: AnnouncementsCheckPolicy; label: string }> = [
  { value: 'on-launch', label: '启动时检查' },
  { value: 'manual', label: '仅手动' },
];

const fileStatusText = (status: string, fatal: boolean): string => {
  switch (status) {
    case 'missing':
      return '文件尚不存在——修改任一设置时创建';
    case 'ok':
      return fatal ? '文件存在但内容不可用（见下方诊断）' : '文件正常';
    case 'oversized':
      return '文件超过大小上限，当前按默认值生效';
    case 'invalid-utf8':
      return '文件不是合法 UTF-8 文本，当前按默认值生效';
    default:
      return '尚未读取';
  }
};

export const OnlineSettingsSection = () => {
  const { state, editable, setField, reload, resetToDefaults, openDirectory } = useDesktopConfig();
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
        {state.saveError ? (
          <p role="alert" className="mt-2 text-xs text-(--app-accent-strong)">
            {state.saveError}
          </p>
        ) : null}
      </SettingsCard>

      <SettingsCard
        title="配置文件"
        description={`config.json · ${fileStatusText(state.fileStatus, state.fileFatal)}`}
        actions={
          <button
            type="button"
            className="ui-web-settings-motion rounded-md border border-(--app-border) px-3 py-1.5 text-xs font-medium text-(--app-text-muted) transition-colors enabled:hover:border-(--app-accent-strong) enabled:hover:text-(--app-accent-strong) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--app-accent-strong) disabled:cursor-not-allowed disabled:opacity-50"
            disabled={state.status === 'loading' || state.status === 'idle'}
            onClick={reload}
          >
            重新加载
          </button>
        }
      >
        {state.path ? (
          <p className="break-all text-xs text-(--app-text-subtle)" data-testid="config-path">
            {state.path}
          </p>
        ) : null}
        {state.backupPresent ? (
          <p className="mt-1 text-xs text-(--app-text-subtle)">
            同目录存在 config.json.bak（上一次有效文件的备份）。
          </p>
        ) : null}
        {state.diagnostics.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1" data-testid="config-diagnostics">
            {state.diagnostics.map((diagnostic) => (
              <li key={`${diagnostic.path}:${diagnostic.message}`} className="text-xs text-(--app-accent-strong)">
                {diagnostic.path === '$' ? '' : `${diagnostic.path}：`}
                {diagnostic.message}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="ui-web-settings-motion rounded-md border border-(--app-border) px-3 py-1.5 text-xs font-medium text-(--app-text-muted) transition-colors enabled:hover:border-(--app-accent-strong) enabled:hover:text-(--app-accent-strong) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--app-accent-strong) disabled:cursor-not-allowed disabled:opacity-50"
            disabled={state.status !== 'ready'}
            onClick={openDirectory}
          >
            打开所在目录
          </button>
          {state.fileStatus === 'missing' ? null : (
            <button
              type="button"
              className="ui-web-settings-motion rounded-md border border-(--app-border) px-3 py-1.5 text-xs font-medium text-(--app-text-muted) transition-colors enabled:hover:border-(--app-accent-strong) enabled:hover:text-(--app-accent-strong) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--app-accent-strong) disabled:cursor-not-allowed disabled:opacity-50"
              disabled={state.status !== 'ready' || busy}
              onClick={resetToDefaults}
            >
              恢复默认并写入
            </button>
          )}
        </div>
        <p className="mt-3 text-xs text-(--app-text-subtle)">
          可手工编辑该文件；回到本页点「重新加载」生效。文件被外部修改时应用内写入会让位，不会静默覆盖。
        </p>
      </SettingsCard>
    </div>
  );
};
