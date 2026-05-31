// pages/api/arena/update-combatants-after-stream.ts

import { getLogger } from '@/lib/logger';
import { NextRequest } from 'next/server';
import { verifySignature } from '@/lib/signature';
import { applyPostBattleUpdates } from '@/lib/arena/service';

const log = getLogger('api-update-combatants-stream');

/**
 * 专门用于流式生成后更新角色数据的端点
 *
 * 安全考虑：
 * 1. 所有签名操作在服务端完成
 * 2. 验证输入角色的原生性
 * 3. 防止客户端注入恶意数据
 */
async function handler(req: NextRequest): Promise<Response> {
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
    }

    try {
        const body = await req.json();
        const {
            combatants,
            report,
            impacts,
            userGuidance,
            scenario,
            writeArenaHistory = true,
            writeCurrentState = true,
        } = body;

        // 验证必需字段
        if (!Array.isArray(combatants) || !report) {
            return new Response(
                JSON.stringify({ error: '缺少必需参数' }),
                { status: 400 }
            );
        }

        if (writeArenaHistory) {
            const headline = typeof report?.headline === 'string' ? report.headline.trim() : '';
            const winner = typeof report?.officialReport?.winner === 'string' ? report.officialReport.winner.trim() : '';
            if (!headline || headline === '魔法少女速报' || !winner || winner === '未知') {
                return new Response(JSON.stringify({ error: '战报内容不完整，已拒绝写入历战记录。' }), { status: 400 });
            }
        }

        // 关键：验证每个角色的原生性
        // 如果角色声称自己是原生的（isNative: true），必须验证签名
        const verifiedCombatants = await Promise.all(
            combatants.map(async (combatant) => {
                if (combatant.isNative) {
                    const isValid = await verifySignature(combatant.data);
                    if (!isValid) {
                        log.warn(`角色 ${combatant.data.codename || combatant.data.name} 声称原生但签名无效，将视为非原生`);
                        return {
                            ...combatant,
                            isNative: false, // 签名无效，降级为非原生
                        };
                    }
                }
                return combatant;
            })
        );

        // 验证情景的原生性（如果存在）
        const isScenarioNative = scenario ? await verifySignature(scenario) : true;
        if (scenario && !isScenarioNative) {
            log.warn('情景声称原生但签名无效');
        }

        // 调用现有的更新逻辑（会在服务端重新签名）
        const updatedCombatants = await applyPostBattleUpdates(
            verifiedCombatants,
            report,
            impacts || [],
            userGuidance || null,
            scenario || null,
            {
                writeArenaHistory,
                writeCurrentState,
            }
        );

        log.info(`成功更新 ${updatedCombatants.length} 个角色的数据`);

        return new Response(
            JSON.stringify({
                updatedCombatants,
                success: true,
            }),
            {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }
        );
    } catch (error) {
        log.error('更新角色数据时发生错误', { error });
        const errorMessage = error instanceof Error ? error.message : '未知错误';
        return new Response(
            JSON.stringify({
                error: '更新角色数据失败',
                message: errorMessage,
            }),
            { status: 500 }
        );
    }
}

export default handler;
