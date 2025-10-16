import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function Custom404() {
  const router = useRouter();
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    // 倒计时逻辑
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          router.push('/');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // 清理定时器
    return () => clearInterval(timer);
  }, [router]);

  const handleManualRedirect = () => {
    router.push('/');
  };

  return (
    <>
      <Head>
        <title>404 - 页面不存在 | 魔法少女生成器</title>
        <meta name="description" content="页面未找到" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="magic-background">
        <div className="container">
          <div className="card text-center">
            {/* 404 标题 */}
            <div className="mb-6">
              <h1 className="text-6xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-purple-600 mb-4">
                404
              </h1>
              <h2 className="text-2xl font-medium text-gray-800 mb-2">
                页面走丢了捏
              </h2>
            </div>

            {/* 装饰性图标/表情 */}
            <div className="text-6xl mb-6 animate-bounce">
              ✨
            </div>

            {/* 倒计时提示 */}
            <div className="mb-6 p-4 bg-pink-50 rounded-lg border-2 border-pink-200">
              <p className="text-gray-700 text-base">
                {countdown > 0 ? (
                  <>
                    将在 <span className="text-2xl font-bold text-pink-600 mx-1">{countdown}</span> 秒后自动返回首页
                  </>
                ) : (
                  <span className="text-pink-600 font-semibold">正在跳转...</span>
                )}
              </p>
            </div>

            {/* 手动跳转按钮 */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={handleManualRedirect}
                className="generate-button text-lg"
                style={{
                  background: 'linear-gradient(to right, #ec4899, #8b5cf6)',
                  marginBottom: 0
                }}
              >
                立即返回首页
              </button>
            </div>
          </div>
        </div>

        {/* 添加一些魔法粒子效果（可选） */}
        <style jsx>{`
          @keyframes float {
            0%, 100% {
              transform: translateY(0px);
            }
            50% {
              transform: translateY(-20px);
            }
          }

          .animate-bounce {
            animation: float 2s ease-in-out infinite;
          }
        `}</style>
      </div>
    </>
  );
}
