'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export function NotFoundClient() {
  const router = useRouter();
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCountdown((previousCountdown) => {
        if (previousCountdown <= 1) {
          window.clearInterval(timer);
          router.replace('/');
          return 0;
        }

        return previousCountdown - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [router]);

  const handleManualRedirect = () => {
    router.replace('/');
  };

  return (
    <div className="magic-background">
      <div className="container">
        <div className="card text-center">
          <div className="mb-6">
            <h1 className="mb-4 bg-gradient-to-r from-pink-500 to-purple-600 bg-clip-text text-6xl font-bold text-transparent">
              404
            </h1>
            <h2 className="mb-2 text-2xl font-medium text-gray-800">页面走丢了捏</h2>
          </div>

          <div className="not-found-float mb-6 text-6xl">✨</div>

          <div className="mb-6 rounded-lg border-2 border-pink-200 bg-pink-50 p-4">
            <p className="text-base text-gray-700">
              {countdown > 0 ? (
                <>
                  将在{' '}
                  <span className="mx-1 text-2xl font-bold text-pink-600">{countdown}</span>{' '}
                  秒后自动返回首页
                </>
              ) : (
                <span className="font-semibold text-pink-600">正在跳转...</span>
              )}
            </p>
          </div>

          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={handleManualRedirect}
              className="generate-button text-lg"
              style={{
                background: 'linear-gradient(to right, #ec4899, #8b5cf6)',
                marginBottom: 0,
              }}
            >
              立即返回首页
            </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes not-found-float {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-20px);
          }
        }

        .not-found-float {
          animation: not-found-float 2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
