import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '魔法茶馆',
};

export default function MagicTavernRoute() {
  return (
    <div className="magic-background-white">
      <meta httpEquiv="refresh" content="0;url=/magic-tea-party" />
      <div className="container !max-w-[1200px]">
        <div className="card !max-w-none">
          <div className="py-12 text-center text-sm text-gray-600">
            正在跳转到魔法茶会…
            <div className="mt-3">
              <Link href="/magic-tea-party" className="text-pink-700 hover:underline">
                /magic-tea-party
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
