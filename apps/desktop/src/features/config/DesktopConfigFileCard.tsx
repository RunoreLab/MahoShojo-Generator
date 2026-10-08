import { SettingsCard } from '@mahoshojo/ui-web/settings';

import { useDesktopConfig } from './use-desktop-config';

/**
 * 「配置文件」诊断卡（D5.1-S2，`DESK-SET-004`/`005`；自「在线与通知」组抽出）。
 *
 * 这是「人工配置」产品线的另一半：文件在哪、坏了怎么办（重载/恢复默认/
 * 打开目录），全部走窄命令。挂在「数据与存储」组——config.json 是本机
 * 存储文件，不再归属在线分组；写入反馈（saveError/冲突草稿）由设置页
 * 共同位置的 `DesktopConfigFeedback` 投影，不在此重复。
 */

const fileStatusText = (status: string, fatal: boolean, invalidPresent: boolean): string => {
  switch (status) {
    case 'missing':
      return invalidPresent
        ? '文件不存在，但同目录有被隔离的 config.json.invalid（见下）'
        : '文件尚不存在——修改任一设置时创建';
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

export const DesktopConfigFileCard = () => {
  const { state, reload, resetToDefaults, createDefaultConfig, openDirectory } =
    useDesktopConfig();
  const busy = state.saving || state.status === 'loading';

  return (
    <SettingsCard
      title="配置文件"
      description={`config.json · ${fileStatusText(state.fileStatus, state.fileFatal, state.invalidPresent)}`}
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
      {state.invalidPresent ? (
        <p className="mt-1 text-xs text-(--app-text-subtle)" data-testid="config-invalid-present">
          同目录存在 config.json.invalid（被隔离的不可读文件，可手工打捞或删除；下方
          「创建默认配置」不会改动该文件）。
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
        {state.fileStatus === 'missing' ? (
          // `.invalid` 隔离残留时给显式恢复入口：创建默认文件且不碰隔离
          // 原件；普通首启则沿用「修改任一设置时创建」的惰性路径。
          state.invalidPresent ? (
            <button
              type="button"
              className="ui-web-settings-motion rounded-md border border-(--app-border) px-3 py-1.5 text-xs font-medium text-(--app-text-muted) transition-colors enabled:hover:border-(--app-accent-strong) enabled:hover:text-(--app-accent-strong) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--app-accent-strong) disabled:cursor-not-allowed disabled:opacity-50"
              disabled={state.status !== 'ready' || busy}
              onClick={createDefaultConfig}
            >
              创建默认配置
            </button>
          ) : null
        ) : (
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
  );
};
