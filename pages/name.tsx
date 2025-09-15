import React, { useState, useRef, useEffect } from 'react';
import Head from 'next/head';
import { snapdom } from '@zumer/snapdom';
// TODO: 从这里引入怪怪的，但是先这样吧！
import { type AIGeneratedMagicalGirl } from './api/generate-magical-girl';
import { MainColor } from '../lib/main-color';
import Link from 'next/link';
import { useCooldown } from '../lib/cooldown';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { useRouter } from 'next/router';
import TachieGenerator from '../components/TachieGenerator';
import Footer from '../components/Footer';

// 注意：QueueStatus 组件及其相关逻辑已被移除，因为它在Serverless环境下无法正常工作。

interface MagicalGirl {
  realName: string;
  name: string;
  flowerDescription: string;
  appearance: {
    height: string;
    weight: string;
    hairColor: string;
    hairStyle: string;
    eyeColor: string;
    skinTone: string;
    wearing: string;
    specialFeature: string;
    mainColor: string; // 写法有点诡异，但是能用就行.jpg
    firstPageColor: string;
    secondPageColor: string;
  };
  spell: string;
  level: string;
  levelEmoji: string;
}

// 保留原有的 levels 数组和相关函数
const levels = [
  { name: '种', emoji: '🌱' },
  { name: '芽', emoji: '🍃' },
  { name: '叶', emoji: '🌿' },
  { name: '蕾', emoji: '🌸' },
  { name: '花', emoji: '🌺' },
  { name: '宝石权杖', emoji: '💎' }
];

// 定义8套渐变配色方案，与 MainColor 枚举顺序对应
const gradientColors: Record<string, { first: string; second: string }> = {
  [MainColor.Red]: { first: '#ff6b6b', second: '#ee5a6f' },
  [MainColor.Orange]: { first: '#ff922b', second: '#ffa94d' },
  [MainColor.Cyan]: { first: '#22b8cf', second: '#66d9e8' },
  [MainColor.Blue]: { first: '#5c7cfa', second: '#748ffc' },
  [MainColor.Purple]: { first: '#9775fa', second: '#b197fc' },
  [MainColor.Pink]: { first: '#ff9a9e', second: '#fecfef' },
  [MainColor.Yellow]: { first: '#f59f00', second: '#fcc419' },
  [MainColor.Green]: { first: '#51cf66', second: '#8ce99a' }
};

function seedRandom(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function getWeightedRandomFromSeed<T>(array: T[], weights: number[], seed: number, offset: number = 0): T {
  // 使用种子生成 0-1 之间的伪随机数
  const pseudoRandom = ((seed + offset) * 9301 + 49297) % 233280 / 233280.0;

  // 累计权重
  let cumulativeWeight = 0;
  const cumulativeWeights = weights.map(weight => cumulativeWeight += weight);
  const totalWeight = cumulativeWeights[cumulativeWeights.length - 1];

  // 找到对应的索引
  const randomValue = pseudoRandom * totalWeight;
  const index = cumulativeWeights.findIndex(weight => randomValue <= weight);

  return array[index >= 0 ? index : 0];
}

function checkNameLength(name: string): boolean {
  return name.length <= 300;
}

// 使用 API 路由生成魔法少女
async function generateMagicalGirl(inputName: string, language: string): Promise<MagicalGirl> {
  try {
    const response = await fetch('/api/generate-magical-girl', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: inputName, language: language }),
    });

    if (!response.ok) {
      const error = await response.json();
      // 处理不同的 HTTP 状态码
      if (response.status === 429) {
        const retryAfter = error.retryAfter || 60;
        throw new Error(`请求过于频繁！请等待 ${retryAfter} 秒后再试。`);
      } else if (response.status >= 500) {
        throw new Error('服务器内部错误，当前可能正忙，请稍后重试');
      } else {
        throw new Error(error.message || error.error || '生成失败');
      }
    }

    const aiGenerated: AIGeneratedMagicalGirl = await response.json();

    // 等级概率配置: [种, 芽, 叶, 蕾, 花, 宝石权杖]
    const levelProbabilities = [0.1, 0.2, 0.3, 0.3, 0.07, 0.03];

    // 使用加权随机选择生成 level
    const seed = seedRandom(aiGenerated.flowerName + inputName);
    const level = getWeightedRandomFromSeed(levels, levelProbabilities, seed, 6);

    return {
      realName: inputName,
      name: aiGenerated.flowerName,
      flowerDescription: aiGenerated.flowerDescription,
      appearance: aiGenerated.appearance,
      spell: aiGenerated.spell,
      level: level.name,
      levelEmoji: level.emoji
    };
  } catch (error) {
    // 处理网络错误和其他异常
    if (error instanceof Error) {
      // 如果已经是我们抛出的错误，直接重新抛出
      if (error.message.includes('请求过于频繁') ||
        error.message.includes('服务器内部错误') ||
        error.message.includes('生成失败')) {
        throw error;
      }
    }
    // 处理网络连接错误
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error('网络连接失败，请检查网络后重试');
    }

    // 其他未知错误
    throw new Error('生成魔法少女时发生未知错误，请重试');
  }
}

export default function Name() {
  const [inputName, setInputName] = useState('');
  const [magicalGirl, setMagicalGirl] = useState<MagicalGirl | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [savedImageUrl, setSavedImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const { isCooldown, startCooldown, remainingTime } = useCooldown('generateMagicalGirlCooldown', 60000);
  const router = useRouter();
  // 多语言支持
  const [languages, setLanguages] = useState<{ code: string; name: string }[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState('zh-CN');

  useEffect(() => {
    fetch('/languages.json')
      .then(res => res.json())
      .then(data => setLanguages(data))
      .catch(err => console.error("Failed to load languages:", err));
  }, []);

  const handleGenerate = async () => {
    if (isCooldown) {
      setError(`请等待 ${remainingTime} 秒后再生成`);
      return;
    }
    if (!inputName.trim()) return;

    if (!checkNameLength(inputName)) {
      setError('名字太长啦，你怎么回事！');
      return;
    }
    // 检查敏感词
    const result = await quickCheck(inputName.trim());
    if (result.hasSensitiveWords) {
      router.push('/arrested');
      return;
    }
    setIsGenerating(true);
    setError(null);

    try {
      const result = await generateMagicalGirl(inputName.trim(), selectedLanguage);
      setMagicalGirl(result);
      setError(null); // 成功时清除错误
    } catch (error) {
      if (error instanceof Error) {
        const errorMessage = error.message;
        // 检查是否是 rate limit 错误
        if (errorMessage.includes('请求过于频繁')) {
          setError('🚫 请求太频繁了！每2分钟只能生成一次魔法少女哦~请稍后再试吧！');
        } else if (errorMessage.includes('网络')) {
          setError('🌐 网络连接有问题！请检查网络后重试~');
        } else {
          setError(`✨ 魔法失效了！${errorMessage}`);
        }
      } else {
        setError('✨ 魔法失效了！可能是用的人太多狸！请再生成一次试试吧~');
      }
    } finally {
      setIsGenerating(false);
      startCooldown();
    }
  };

  const handleSaveImage = async () => {
    if (!resultRef.current) return;

    try {
      // 临时隐藏保存按钮和说明文字
      const saveButton = resultRef.current.querySelector('.save-button') as HTMLElement;
      const logoPlaceholder = resultRef.current.querySelector('.logo-placeholder') as HTMLElement;
      const downloadJsonButton = resultRef.current.querySelector('#download-json') as HTMLElement;

      if (saveButton) saveButton.style.display = 'none';
      if (logoPlaceholder) logoPlaceholder.style.display = 'flex';
      if (downloadJsonButton) downloadJsonButton.style.display = 'none';

      const result = await snapdom(resultRef.current, {
        scale: 1,
      });

      // 恢复按钮显示
      if (saveButton) saveButton.style.display = 'block';
      if (logoPlaceholder) logoPlaceholder.style.display = 'none';
      if (downloadJsonButton) downloadJsonButton.style.display = 'block';

      // 获取 result.toPng() 生成的 HTMLImageElement 的图片 URL
      // toPng() 返回 Promise<HTMLImageElement>，可通过 .src 获取图片的 base64 url
      const imgElement = await result.toPng();
      const imageUrl = imgElement.src;

      const isMobileDevice = /Mobi/i.test(window.navigator.userAgent);

      if (isMobileDevice) {
        // 在移动端，显示弹窗供用户长按保存
        setSavedImageUrl(imageUrl);
        setShowImageModal(true);
      } else {
        // 在桌面端，直接触发下载
        const link = document.createElement('a');
        link.href = imageUrl;
        link.download = `${magicalGirl?.name || 'magical-girl'}.png`; // 使用魔法少女代号作为文件名
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch {
      alert('生成图片失败，请重试');
      // 确保在失败时也恢复按钮显示
      const saveButton = resultRef.current?.querySelector('.save-button') as HTMLElement;
      const logoPlaceholder = resultRef.current?.querySelector('.logo-placeholder') as HTMLElement;

      if (saveButton) saveButton.style.display = 'block';
      if (logoPlaceholder) logoPlaceholder.style.display = 'none';
    }
  };

  // 新增：处理保存为JSON文件
  const handleSaveJson = () => {
    if (!magicalGirl) return;

    // 签名已包含在 magicalGirl 对象中
    const jsonData = JSON.stringify(magicalGirl, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `魔法少女_${magicalGirl.name}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Head>
        <link rel="preload" href="/logo.svg" as="image" type="image/svg+xml" />
        <link rel="preload" href="/logo-white.svg" as="image" type="image/svg+xml" />
      </Head>
      <div className="magic-background">
        <div className="container">
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: '1rem' }}>
              <img src="/logo.svg" width={250} height={160} alt="Logo" />
            </div>
            <p className="subtitle text-center">你是什么魔法少女呢！</p>
            <p className="subtitle text-center">
              或者要不要来试试 <Link href="/details" className="footer-link">奇妙妖精大调查</Link>？
            </p>
            <div style={{ marginTop: '1rem', marginBottom: '2rem', textAlign: 'center' }}>
              <p style={{ fontSize: '0.8rem', marginTop: '1rem', color: '#999', fontStyle: 'italic' }}>本测试设定来源于小说《下班，然后变成魔法少女》</p>
            </div>
            <div className="input-group">
              <label htmlFor="name" className="input-label">
                请输入你的名字：
              </label>
              <input
                id="name"
                type="text"
                value={inputName}
                onChange={(e) => setInputName(e.target.value)}
                className="input-field"
                placeholder="例如：鹿目圆香"
                onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
              />
            </div>

            <div className="input-group">
              <label htmlFor="language-select" className="input-label">
                <img src="/globe.svg" alt="Language" className="inline-block w-4 h-4 mr-2" />
                生成语言
              </label>
              <select
                id="language-select"
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
                className="input-field"
                disabled={isGenerating}
              >
                {languages.map(lang => (
                  <option key={lang.code} value={lang.code}>{lang.name}</option>
                ))}
              </select>
            </div>

            <button
              onClick={handleGenerate}
              disabled={!inputName.trim() || isGenerating || isCooldown}
              className="generate-button"
            >
              {isCooldown
                ? `请等待 ${remainingTime} 秒`
                : isGenerating
                  ? '少女创造中，请稍后捏 (≖ᴗ≖)✧✨'
                  : 'へんしん(ﾉﾟ▽ﾟ)ﾉ! '}
            </button>

            {/* 返回首页链接 */}
            <div className="text-center" style={{ marginTop: '2rem' }}>
              <button
                onClick={() => router.push('/')}
                className="footer-link"
              >
                返回首页
              </button>
            </div>

            {error && (
              <div className="error-message">
                {error}
              </div>
            )}

            {magicalGirl && (
              <div
                ref={resultRef}
                className="result-card"
                style={{
                  background: (() => {
                    const colors = gradientColors[magicalGirl.appearance.mainColor] || gradientColors[MainColor.Pink];
                    return `linear-gradient(135deg, ${colors.first} 0%, ${colors.second} 100%)`;
                  })()
                }}
              >
                <div className="result-content">
                  <div className="flex justify-center items-center" style={{ marginBottom: '1rem', background: 'transparent' }}>
                    <img src="/mahou-title.svg" width={300} height={70} alt="Logo" style={{ display: 'block', background: 'transparent' }} />
                  </div>
                  <div className="result-item">
                    <div className="result-label">✨ 真名解放</div>
                    <div className="result-value">{magicalGirl.realName}</div>
                  </div>
                  <div className="result-item">
                    <div className="result-label">💝 魔法少女名</div>
                    <div className="result-value">
                      {magicalGirl.name}
                      <div style={{ fontStyle: 'italic', marginTop: '8px', fontSize: '14px', opacity: 0.9 }}>
                        「{magicalGirl.flowerDescription}」
                      </div>
                    </div>
                  </div>

                  <div className="result-item">
                    <div className="result-label">👗 外貌</div>
                    <div className="result-value">
                      身高：{magicalGirl.appearance.height}<br />
                      体重：{magicalGirl.appearance.weight}<br />
                      发色：{magicalGirl.appearance.hairColor}<br />
                      发型：{magicalGirl.appearance.hairStyle}<br />
                      瞳色：{magicalGirl.appearance.eyeColor}<br />
                      肤色：{magicalGirl.appearance.skinTone}<br />
                      穿着：{magicalGirl.appearance.wearing}<br />
                      特征：{magicalGirl.appearance.specialFeature}
                    </div>
                  </div>

                  <div className="result-item">
                    <div className="result-label">✨ 变身咒语</div>
                    <div className="result-value">
                      <div style={{ whiteSpace: 'pre-line' }}>{magicalGirl.spell}</div>
                    </div>
                  </div>

                  <div className="result-item">
                    <div className="result-label">⭐ 魔法等级</div>
                    <div className="result-value">
                      <span className="level-badge">
                        {magicalGirl.levelEmoji} {magicalGirl.level}
                      </span>
                    </div>
                  </div>

                  <button onClick={handleSaveImage} className="save-button">
                    📱 保存为图片
                  </button>

                  <button id="download-json" onClick={handleSaveJson} className="save-button" style={{ marginTop: '0.5rem', background: 'linear-gradient(135deg, #5c7cfa 0%, #748ffc 100%)' }}>
                    📄 下载设定文件
                  </button>

                  <div className="logo-placeholder" style={{ display: 'none', justifyContent: 'center', marginTop: '1rem' }}>
                    <img
                      src="/logo-white-qrcode.svg"
                      width={240}
                      height={240}
                      alt="Logo"
                      style={{
                        display: 'block',
                        maxWidth: '100%',
                        height: 'auto'
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {magicalGirl && (
              <div className="text-center w-full" style={{ marginTop: '2rem' }}>
                <h3 className="text-lg font-medium text-gray-900" style={{ marginBottom: '1rem' }}>立绘生成</h3>
                <TachieGenerator
                  prompt={`${JSON.stringify(magicalGirl.appearance)} , Xiabanmo, 二次元, 魔法少女`}
                />
              </div>
            )}
          </div>

          <Footer />
        </div>

        {showImageModal && savedImageUrl && (
          <div className="fixed inset-0 bg-black flex items-center justify-center z-50"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)', paddingLeft: '2rem', paddingRight: '2rem' }}
          >
            <div className="bg-white rounded-lg max-w-lg w-full max-h-[80vh] overflow-auto relative">
              <div className="flex justify-between items-center m-0">
                <div></div>
                <button
                  onClick={() => setShowImageModal(false)}
                  className="text-gray-500 hover:text-gray-700 text-3xl leading-none"
                  style={{ marginRight: '0.5rem' }}
                >
                  ×
                </button>
              </div>
              <p className="text-center text-sm text-gray-600" style={{ marginTop: '0.5rem' }}>
                💫 长按图片保存到相册
              </p>
              <div className="items-center flex flex-col" style={{ padding: '0.5rem' }}>
                <img
                  src={savedImageUrl}
                  alt="魔法少女登记表"
                  className="w-1/2 h-auto rounded-lg mx-auto"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}