import TachieGenerator from '@/components/TachieGenerator';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

import type { BetaAccessFeatureId } from '@/config/beta-access';
import { buildBetaAccessUrl } from '@/lib/beta-access';
import { useBetaAccessStatus } from '@/lib/beta-access-client';
import { useAuth } from '@/lib/useAuth';

export default function TachiePage() {
  const router = useRouter();
  const { isAuthenticated, loading, userBadges } = useAuth();
  const betaFeatureId: BetaAccessFeatureId = 'tachie';
  const betaAccess = useBetaAccessStatus({
    featureId: betaFeatureId,
    isAuthenticated,
    loading,
    badges: userBadges,
  });

  const [prompt, setPrompt] = useState<string>('');

  useEffect(() => {
    if (betaAccess.status === 'blocked' || betaAccess.status === 'error') {
      void router.replace(buildBetaAccessUrl(betaFeatureId));
    }
  }, [betaAccess.status, betaFeatureId, router]);

  if (betaAccess.status !== 'allowed') {
    return (
      <div className="magic-background-white">
        <div className="container">
          <div className="card">
            <div className="py-10 text-center text-sm text-gray-600">正在核验内测权限…</div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-100 via-purple-50 to-cyan-100 py-12">
      <div className="container mx-auto px-4">
        <h1 className="text-3xl font-bold text-center mb-8 text-purple-800">
          立绘生成
        </h1>
        <p className="text-center text-sm text-gray-600 mb-4">
          推荐截取 .json 文件中的 appearance 的部分，否则会报错
        </p>
        <div className="input-group">
          <label htmlFor="prompt" className="input-label">
            提示词描述
          </label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="请输入角色外观描述"
            className="input-field"
            rows={6}
            style={{
              resize: 'vertical',
              minHeight: '120px',
              fontFamily: 'inherit',
              lineHeight: '1.5'
            }}
          />
        </div>
        <TachieGenerator prompt={`${prompt}, Xiabanmo, 二次元, 魔法少女`} />

        <div className="mt-12 text-center">
          <p className="text-sm text-gray-600">
            这是一个测试页面，用于测试 TachieGenerator 组件的功能
          </p>
          <p className="text-xs text-gray-500 mt-2">
            需要有效的 LibLib Access Key 和 Secret Key 才能进行图片生成
          </p>
        </div>
      </div>
    </div>
  );
}
