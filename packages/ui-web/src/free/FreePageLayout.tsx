import type { ReactNode } from 'react';

export interface FreePageLayoutProps {
  readonly controls: ReactNode;
  readonly result?: ReactNode;
  readonly footer?: ReactNode;
}

/** 同一视口使用同一输入/预览布局；与执行位置、UA 和宿主身份无关。 */
export function FreePageLayout({ controls, result, footer }: FreePageLayoutProps) {
  return (
    <div data-testid="page-free" className="magic-background-white">
      <div className="container !max-w-[980px] lg:!max-w-[1200px]">
        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          <div className="card !max-w-none min-w-0">
            <div className="text-center mb-4">
              <h1 className="text-2xl font-bold text-pink-700">自由生成</h1>
              <p className="subtitle mt-2">
                自由输入任意提示词，选择 Schema 后生成数据卡（角色 / 情景）。自由生成产物将被视为非原生卡（不生成签名）。
              </p>
            </div>
            {controls}
          </div>
          <div className="min-w-0" data-testid="free-preview">
            {result ? (
              <div className="space-y-4">{result}</div>
            ) : (
              <div className="card !max-w-none hidden lg:block">
                <div className="text-center">
                  <h2 className="text-lg font-semibold text-gray-800">预览区</h2>
                  <p className="mt-2 text-sm text-gray-600">
                    开始生成后，结果会在这里显示，便于在宽屏下边调提示词边对照输出。
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
        {footer}
      </div>
    </div>
  );
}
