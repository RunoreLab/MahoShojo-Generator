// pages/api/get-scenario-presets.ts

import { NextRequest } from 'next/server';
import { SCENARIO_PRESET_LIST } from '@/lib/scenario-presets';

export const config = {
  runtime: 'edge',
};

export default async function handler(req: NextRequest) {
  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({ error: 'Method Not Allowed' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    return new Response(
      JSON.stringify(SCENARIO_PRESET_LIST),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('获取预设情景失败:', error);
    return new Response(
      JSON.stringify({ error: '无法加载预设情景列表' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

