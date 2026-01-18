import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect } from 'react';

export default function MagicTavernRedirect() {
  const router = useRouter();

  useEffect(() => {
    void router.replace('/magic-tea-party');
  }, [router]);

  return (
    <>
      <Head>
        <title>魔法茶馆</title>
      </Head>
      <div className="magic-background-white">
        <div className="container !max-w-[1200px]">
          <div className="card !max-w-none">
            <div className="py-12 text-center text-sm text-gray-600">正在跳转到魔法茶会…</div>
          </div>
        </div>
      </div>
    </>
  );
}
