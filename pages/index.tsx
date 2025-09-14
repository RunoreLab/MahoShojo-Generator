import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Footer from '../components/Footer';

interface LogoConfig {
  id: string;
  src: string;
  width: number;
  height: number;
  alt: string;
  href?: string;
  className?: string;
  color?: string;
}

const logoConfigs: LogoConfig[] = [
  {
    id: 'magical-generator',
    src: '/logo-white.svg',
    width: 250,
    height: 60,
    alt: '魔法少女生成器',
    href: '/name',
    className: 'magical-generator',
    color: 'white'
  },
  {
    id: 'fairy-quest',
    src: '/questionnaire-logo.svg',
    width: 250,
    height: 40,
    alt: '奇妙妖精大调查',
    href: '/details',
    className: 'fairy-quest'
  },
  {
    id: 'canshou-generator',
    src: '/beast-logo-white.svg',
    width: 280,
    height: 40,
    alt: '危险残兽大调查',
    href: '/canshou',
    className: 'canshou-generator',
    color: 'white'
  },
  {
    id: 'battle-arena',
    src: '/arena-white.svg',
    width: 280,
    height: 80,
    alt: '魔法少女竞技场',
    href: '/battle',
    className: 'battle-arena',
    color: 'white'
  },
  {
    id: 'scenario-generator',
    src: '/scenario.svg',
    width: 280,
    height: 40,
    alt: '自定义情景生成',
    href: '/scenario',
    className: 'scenario-generator'
  },
  {
    id: 'sublimation',
    src: '/sublimation-white.svg',
    width: 280,
    height: 40,
    alt: '角色成长升华',
    href: '/sublimation',
    className: 'sublimation'
  },
  {
    id: 'character-manager',
    src: '/character-manager-white.svg',
    width: 280,
    height: 40,
    alt: '角色数据管理',
    href: '/character-manager',
    className: 'character-manager'
  }
];

export default function Home() {
  const [, setImagesLoaded] = useState(false);

  useEffect(() => {
    const preloadImages = async () => {
      const imageUrls = logoConfigs.map(logo => logo.src);

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
        {logoConfigs.map(logo => (
          <link
            key={logo.id}
            rel="preload"
            href={logo.src}
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

            <p className="subtitle text-center mb-4">
              欢迎来到魔法国度！选择一个项目开始玩耍吧！
            </p>

            {/* 登录/注册按钮 */}
            {/* <div className='flex justify-center mb-2'>
              <Link
                href="/character-manager"
                className="px-2 py-1 text-sm bg-white-600 text-black hover:text-pink-700 rounded hover:border-pink-700 border-1"
              >
                <span className='mr-2'>👤</span>
                前往账号管理界面
              </Link>
            </div> */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {logoConfigs.filter(logo => logo.href).map((logo) => (
                <Link key={logo.id} href={logo.href!} className={`feature-button ${logo.className}`}>
                  <div className="gradient-overlay"></div>
                  <div className="feature-button-content">
                    <div className="feature-title-container">
                      <img
                        src={logo.src}
                        width={logo.width}
                        height={logo.height}
                        alt={logo.alt}
                        className="feature-title-svg"
                      />
                    </div>
                  </div>
                </Link>
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