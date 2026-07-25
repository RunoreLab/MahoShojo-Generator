// pages/api/admin/ai-models.ts

import { config } from '@/lib/config';
import type { NextRequest } from 'next/server';

export const runtime = 'edge';

const normalizeModelId = (modelId: unknown): string | null => {
  if (typeof modelId !== 'string') return null;
  const trimmed = modelId.trim();
  if (!trimmed) return null;
  if (trimmed === 'default') return null;
  return trimmed;
};

export default async function handler(req: NextRequest) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ success: false, error: 'Method Not Allowed' }), { status: 405 });
  }

  try {
    const modelSet = new Set<string>();
    for (const provider of config.PROVIDERS) {
      const models = Array.isArray(provider.model) ? provider.model : [provider.model];
      for (const modelId of models) {
        const normalized = normalizeModelId(modelId);
        if (!normalized) continue;
        modelSet.add(normalized);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        models: Array.from(modelSet.values()).sort(),
        loadBalanceStrategy: config.LOAD_BALANCE_STRATEGY,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Admin API - 获取 AI 模型列表失败:', error);
    return new Response(JSON.stringify({ success: false, error: '获取 AI 模型列表失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

