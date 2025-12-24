import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Footer from '../components/Footer';
import { useAuth } from '@/lib/useAuth';
import { UserWithTitle } from '@/components/UserTitle';
import { featureCategories, getAllFeatureImages } from '@/config/features';

export default function Home() {
  const [, setImagesLoaded] = useState(false);
  const { user, userBadges, isAuthenticated, loading } = useAuth();

  useEffect(() => {
    const preloadImages = async () => {
      const imageUrls = getAllFeatureImages();

      const imagePromises = imageUrls.map(url => {
        return new Promise((resolve, reject) => {
          const img = new window.Image();
          img.onload = resolve;
          img.onerror = reject;
          img.src = url;
        });
      });

      try {
        await Promise.all(imagePromises);
        setImagesLoaded(true);
      } catch (error) {
        console.log('图片预加载完成，但部分图片可能失败', error);
        setImagesLoaded(true);
      }
    };

    preloadImages();
  }, []);

  return (
    <>
      <Head>
        <title>✨ 魔法少女生成器 ✨</title>
        <meta name="description" content="AI驱动的魔法少女角色生成器，创建独一无二的魔法少女角色" />
        {getAllFeatureImages().map((src, index) => (
          <link
            key={index}
            rel="preload"
            href={src}
            as="image"
            type="image/svg+xml"
          />
        ))}
      </Head>
      <div className="magic-background-white">
        <div className="container">
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: '2rem' }}>
              <img src="/logo.svg" width={280} height={180} alt="魔法少女生成器" />
            </div>

            <div className="flex justify-center mb-4">
              {loading ? (
                <span className="text-sm text-gray-600">加载中...</span>
              ) : isAuthenticated ? (
                <div className="flex flex-col items-center gap-2">
                  <Link
                    href="/character-manager"
                    className="inline-flex items-center px-4 py-2 text-sm bg-pink-100 text-pink-700 rounded-lg hover:bg-pink-200 transition-colors"
                  >
                    <span>欢迎回来，</span>
                    <UserWithTitle
                      username={user?.username || ''}
                      usernameClassName="text-pink-700 font-semibold"
                      titleClassName="text-xs"
                      badges={userBadges}
                      showBadges={true}
                    />
                    <span className="ml-2">点击进入档案馆</span>
                  </Link>
                  <Link href="/me" className="text-sm text-blue-600 hover:underline">
                    个人页：战报记录 / PVP 战绩（测试版）
                  </Link>
                </div>
              ) : (
                <Link
                  href="/character-manager"
                  className="inline-flex items-center px-4 py-2 text-sm bg-pink-600 text-white rounded-lg hover:bg-pink-700 transition-colors"
                >
                  注册或登录
                </Link>
              )}
            </div>
            <p className="subtitle text-center mb-4">
              欢迎来到魔法国度！选择一个项目开始玩耍吧！
            </p>

            {/* 分类功能导航 */}
            <div className="space-y-8">
              {featureCategories.map((category) => (
                <div key={category.id} className="feature-category">
                  {/* 分类标题 */}
                  <h2 className="text-center text-lg font-semibold mb-4 text-pink-700">
                    {category.title}
                  </h2>

                  {/* 功能按钮网格 */}
                  <div
                    className={`feature-grid ${category.columns === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}
                  >
                    {category.features.map((feature) => (
                      <Link
                        key={feature.id}
                        href={feature.href}
                        className={`feature-button ${feature.className}`}
                      >
                        <div className="gradient-overlay"></div>
                        <div className="feature-button-content">
                          <div className="feature-title-container">
                            <img
                              src={feature.src}
                              width={feature.width}
                              height={feature.height}
                              alt={feature.alt}
                              className="feature-title-svg"
                            />
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: '2rem', textAlign: 'center' }}>
              <p style={{ fontSize: '0.8rem', marginTop: '1rem', color: '#999', fontStyle: 'italic' }}>
                设定来源于小说《下班，然后变成魔法少女》
              </p>
            </div>
          </div>

          <Footer className="footer" />
        </div>
      </div>
    </>
  );
}
