'use client';

/**
 * 「保存到本地库」设备偏好行。
 *
 * 两处调用方共用同一个偏好与同一段说明文案，但标签各自贴合所在区域：名册上传处
 * 用默认的「同时保存到本地库」，Web 包选择器覆盖成「导入时保存到本地库」。
 * 改默认标签会同时改动两个界面。
 */
export function LocalLibrarySavePreference({
  checked,
  onChange,
  disabled,
  label = '同时保存到本地库',
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div className="mt-2">
      <label className="flex min-h-11 cursor-pointer items-start gap-2 text-sm text-gray-700 dark:text-gray-200">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-1 h-4 w-4 shrink-0"
        />
        <span>
          {label}
          <span className="block text-xs text-gray-500">
            打开后，之后导入的内容会自动存入本机本地库；内容相同会自动更新原卡而不是新增一张。
          </span>
        </span>
      </label>
      <p className="mt-1 text-xs text-gray-500">
        本地库保存在此浏览器中，不会跨设备同步；清除站点数据会一并删除。
      </p>
    </div>
  );
}
