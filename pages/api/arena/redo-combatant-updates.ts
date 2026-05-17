// pages/api/arena/redo-combatant-updates.ts

import { z } from 'zod/v3';
import { NextRequest } from 'next/server';

import { getLogger } from '@/lib/logger';
import { generateWithAI, GenerationConfig, LoadBalanceStrategy } from '@/lib/ai';
import { AI_PROVIDER_CATALOG, resolveAIProviderModel } from '@/lib/ai/constants';
import { config as appConfig, SafetyCheckPolicy, type AIProvider } from '@/lib/config';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { buildPolicySafetyCheckText } from '@/lib/content-safety/server';
import { verifySignature } from '@/lib/signature';
import { recordUserActivityFromRequest } from '@/lib/user-activity/record';

import { CustomProviderSchema } from '@/lib/arena/schemas';
import {
  buildRedoCombatantUpdatesSchema,
  createRedoCombatantUpdatesPrompt,
  precheckBattleReportForRedo,
} from '@/lib/arena/redo-updates';
import { redoPostBattleUpdates } from '@/lib/arena/service';

const log = getLogger('api-redo-combatant-updates');

export const config = {
  runtime: 'edge',
};

async function handler(req: NextRequest): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const body = await req.json();
    const {
      combatants,
      battleReportMarkdown,
      mode = 'classic',
      userGuidance,
      scenario,
      writeArenaHistory = true,
      writeCurrentState = true,
      customProvider: customProviderPayload,
    } = body;

    if (!writeArenaHistory && !writeCurrentState) {
      return new Response(JSON.stringify({ error: '未开启历战记录/当前状态写入，无法重做更新。' }), { status: 400 });
    }

    if (!Array.isArray(combatants) || combatants.length === 0) {
      return new Response(JSON.stringify({ error: '缺少角色列表' }), { status: 400 });
    }

    const reportMarkdown = typeof battleReportMarkdown === 'string' ? battleReportMarkdown.trim() : '';
    const redoPrecheck = precheckBattleReportForRedo(reportMarkdown, mode);
    if (!redoPrecheck.ok) {
      return new Response(JSON.stringify({ error: redoPrecheck.error }), { status: 400 });
    }
    const parsedReport = redoPrecheck.parsed;

    const verifiedCombatants = await Promise.all(
      combatants.map(async (combatant: any) => {
        const claimedNative = Boolean(combatant?.isNative);
        if (!claimedNative) {
          return { ...combatant, isNative: false };
        }

        const isValid = await verifySignature(combatant.data);
        if (!isValid) {
          log.warn(`角色 ${combatant?.data?.codename || combatant?.data?.name} 声称原生但签名无效，将视为非原生`);
          return { ...combatant, isNative: false };
        }

        return { ...combatant, isNative: true };
      })
    );

    let customProviderOverride: AIProvider | null = null;
    let customProviderId: string | null = null;
    let customModelOverride: string | undefined;
    if (customProviderPayload) {
      const parsedResult = CustomProviderSchema.safeParse(customProviderPayload);
      if (!parsedResult.success) {
        log.warn('自定义 AI 供应商配置校验失败', {
          providerId: customProviderPayload?.providerId,
          issues: parsedResult.error.issues,
        });
        return new Response(JSON.stringify({ error: '自定义 AI 供应商配置无效' }), { status: 400 });
      }

      const parsed = parsedResult.data;
      customProviderId = parsed.providerId;
      const providerConfig = AI_PROVIDER_CATALOG.find((item) => item.id === parsed.providerId);
      if (!providerConfig) {
        return new Response(JSON.stringify({ error: '未知的模型供应商 ID' }), { status: 400 });
      }

      const modelResolution = resolveAIProviderModel(providerConfig, parsed.modelId);
      if (!modelResolution) {
        return new Response(JSON.stringify({ error: '未知的模型 ID' }), { status: 400 });
      }

      const sanitizedApiKey = parsed.apiKey.trim();
      if (!sanitizedApiKey && providerConfig.id !== 'system') {
        return new Response(JSON.stringify({ error: 'API Key 不能为空' }), { status: 400 });
      }

      const sanitizedBaseUrl = providerConfig.baseUrl?.trim() ?? '';
      if (!sanitizedBaseUrl) {
        customModelOverride = modelResolution.modelId;
        log.info('检测到 baseUrl 为空的自定义供应商，改用系统默认通道，仅覆盖模型参数', {
          providerId: providerConfig.id,
          model: modelResolution.modelId,
        });
      } else {
        customProviderOverride = {
          name: providerConfig.name,
          apiKey: sanitizedApiKey,
          baseUrl: sanitizedBaseUrl,
          model: modelResolution.modelId,
          type: providerConfig.type,
          mode: providerConfig.mode || 'auto',
          retryCount: 1,
          skipProbability: 0,
          ...(typeof parsed.maxOutputTokens === 'number' ? { defaultMaxOutputTokens: parsed.maxOutputTokens } : {}),
        };
      }
    }

    const shouldDisablePolling = customProviderId !== null && customProviderId !== 'system';
    const providerOptions = (customProviderOverride || shouldDisablePolling)
      ? {
        ...(customProviderOverride ? { providerOverride: customProviderOverride } : {}),
        ...(shouldDisablePolling
          ? { loadBalanceStrategy: LoadBalanceStrategy.CUSTOM }
          : { loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL }),
      }
      : {};

    const finalUserGuidance = typeof userGuidance === 'string' ? userGuidance.trim() : '';

    const isScenarioNative = scenario ? await verifySignature(scenario) : true;
    if (scenario && !isScenarioNative) {
      log.warn('情景声称原生但签名无效');
    }

    const inputsToCheck: { type: keyof SafetyCheckPolicy; content: string; isNative: boolean }[] = [];
    if (finalUserGuidance) {
      inputsToCheck.push({ type: 'userGuidance', content: finalUserGuidance, isNative: false });
    }
    inputsToCheck.push({ type: 'userGuidance', content: reportMarkdown, isNative: false });
    if (scenario) {
      inputsToCheck.push({ type: 'scenario', content: JSON.stringify(scenario), isNative: isScenarioNative });
    }
    verifiedCombatants.forEach((c: any) => {
      inputsToCheck.push({ type: 'character', content: JSON.stringify(c.data), isNative: Boolean(c.isNative) });
    });

    const { combinedText, usedBundle } = buildPolicySafetyCheckText(inputsToCheck, {
      policy: appConfig.SAFETY_CHECK_POLICY,
      enableBundle: appConfig.ENABLE_BUNDLE_SAFETY_CHECK,
    });
    if (usedBundle) {
      log.info('触发"连坐"机制，打包所有非原生内容进行检查。');
    }
    if (combinedText) {
      if (appConfig.ENABLE_SENSITIVE_WORD_FILTER && (await quickCheck(combinedText)).hasSensitiveWords) {
        log.warn('检测到敏感词 (本地过滤)，请求被拒绝', { text: combinedText });
        return new Response(JSON.stringify({ error: '输入内容不合规', shouldRedirect: true, reason: '使用危险符文' }), {
          status: 400,
        });
      }
    }

    const participantNames = verifiedCombatants.map((c: any) => c?.data?.codename || c?.data?.name).filter(Boolean);
    if (participantNames.length === 0) {
      return new Response(JSON.stringify({ error: '参战角色缺少名称' }), { status: 400 });
    }

    const schema = buildRedoCombatantUpdatesSchema({
      enableImpactText: writeArenaHistory,
      enableCurrentState: writeCurrentState,
    });
    type RedoResult = z.infer<typeof schema>;

    const generationConfig: GenerationConfig<RedoResult, null> = {
      systemPrompt: '你只需要输出 JSON。',
      temperature: 0.4,
      promptBuilder: () =>
        createRedoCombatantUpdatesPrompt({
          battleReportMarkdown: reportMarkdown,
          combatants: verifiedCombatants.map((c: any) => ({
            name: (c?.data?.codename || c?.data?.name || '').toString(),
            type: (c?.type || '角色').toString(),
            currentState: c?.data?.current_state ?? null,
          })),
          mode,
          winner: parsedReport.winner,
          writeArenaHistory,
          writeCurrentState,
        }),
      schema,
      taskName: '重做角色更新',
      modelOverride: customModelOverride,
    };

    const redo = await generateWithAI<RedoResult, null>(null, generationConfig, providerOptions);
    recordUserActivityFromRequest(req);

    const normalizedImpacts = (() => {
      const impacts = Array.isArray((redo as any).impacts) ? (redo as any).impacts : [];
      const byName = new Map<string, any>();
      impacts.forEach((item: any) => {
        const name = typeof item?.characterName === 'string' ? item.characterName.trim() : '';
        if (!name || byName.has(name)) return;
        byName.set(name, item);
      });

      return participantNames.map((name: string) => {
        const existing = byName.get(name);
        return {
          characterName: name,
          ...(writeArenaHistory ? { impact: (existing?.impact ?? '在此次事件中获得了成长。').toString() } : {}),
          ...(writeCurrentState
            ? { currentStateSummary: (existing?.currentStateSummary ?? '当前状态受到了一些影响。').toString() }
            : {}),
        };
      });
    })();

    const minimalReport = {
      headline: parsedReport.headline,
      mode,
      officialReport: {
        winner: parsedReport.winner,
        conclusion: '',
      },
    } as any;

    const updatedCombatants = await redoPostBattleUpdates(
      verifiedCombatants,
      minimalReport,
      normalizedImpacts,
      finalUserGuidance || null,
      scenario || null,
      { writeArenaHistory, writeCurrentState }
    );

    log.info(`重做完成，成功更新 ${updatedCombatants.length} 个角色的数据`);
    return new Response(JSON.stringify({ updatedCombatants, success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    log.error('重做角色数据时发生错误', { error });
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    return new Response(JSON.stringify({ error: '重做角色更新失败', message: errorMessage }), { status: 500 });
  }
}

export default handler;
