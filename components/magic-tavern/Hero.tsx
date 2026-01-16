import Link from 'next/link';

import { ErrorMessage } from '@/components/ErrorMessage';

type MagicTavernHeroProps = {
  globalError: string | null;
};

export function MagicTavernHero({ globalError }: MagicTavernHeroProps) {
  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-pink-800">魔法酒馆</h1>
          <p className="mt-1 text-sm text-gray-600">聊天记录保存在本地浏览器；魔法酒馆仅支持自备 API Key。</p>
        </div>
        <Link href="/" className="text-sm text-pink-700 hover:underline">
          返回首页
        </Link>
      </div>

      {globalError ? (
        <div className="mt-4">
          <ErrorMessage
            message={globalError}
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            linkClassName="text-red-700 underline underline-offset-2 hover:opacity-95"
          />
        </div>
      ) : null}
    </>
  );
}
