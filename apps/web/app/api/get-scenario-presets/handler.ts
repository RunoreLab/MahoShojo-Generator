import { SCENARIO_PRESET_LIST } from '@/lib/scenario-presets';

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export async function GET(): Promise<Response> {
  try {
    return json(SCENARIO_PRESET_LIST);
  } catch (error) {
    console.error('获取预设情景失败:', error);
    return json({ error: '无法加载预设情景列表' }, 500);
  }
}

export function methodNotAllowed(): Response {
  return json({ error: 'Method Not Allowed' }, 405);
}
