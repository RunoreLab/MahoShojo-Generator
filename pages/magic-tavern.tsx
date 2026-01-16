import Head from 'next/head';

export default function MagicTavernRedirect() {
  return (
    <>
      <Head>
        <meta httpEquiv="refresh" content="0;url=/magic-tea-party" />
        <title>魔法茶会</title>
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
