import type { ArenaGenerationPrompt } from './runtime';
import {
  WebPackagePromptProjectionSchema,
  WebPackageRefSchema,
} from '@mahoshojo/contracts/web-package';
import {
  buildWebPackagePromptFromProjection,
  buildWebPackagePromptProjection,
  resolveWebPackage,
} from '@mahoshojo/web-package';
import { assembleArenaGenerationPrompt } from '@mahoshojo/ai-core/arena-generation';
export { isStrictRankedArenaRequest } from '@mahoshojo/ai-core/arena-generation';
import {
  isPackageBackedOutputContract,
  type ArenaGenerationOutputContract,
} from './output-contract';

export type { ArenaGenerationOutputContract } from './output-contract';
export { isPackageBackedOutputContract, isWebArenaOutputContract } from './output-contract';

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

export const resolveArenaGenerationOutputContract = (
  payload: Record<string, unknown>,
): ArenaGenerationOutputContract => {
  const serverContext = asRecord(payload.__arenaServerContextV1);
  const endpoint = text(serverContext?.endpoint);
  // Room producers have a signed frozen snapshot; legacy PVP producers do not.
  const legacyPvp = Boolean(asRecord(serverContext?.trustedPvpContext) ?? asRecord(payload.pvpContext))
    && !asRecord(payload.multiplayerGenerationSnapshot);
  if (payload.reportFormat === 'web' && !legacyPvp && endpoint !== 'api/arena/session/generate-next') {
    return payload.webPackageRef != null ? 'web-package-target' : 'web-document';
  }
  return serverContext?.deliveryMode === 'non-stream'
    && (endpoint === 'api/arena/generate' || endpoint === 'api/generate-battle-story')
    ? 'structured-report'
    : 'stream-markdown';
};

const JOURNALISTS = [
  ['蓝星单推人', '兽扑'],
  ['间界上单', 'molimoli弹幕视频网'],
  ['情报专家Mentha', '国度论坛-魔法少女板块-A.R.E.N.A.大腿榜'],
  ['弧盐'], ['佚名'], ['牢雀'], ['冲师逆徒'], ['嗜血观众'], ['长颈鹿'],
  ['魔法少女战队unofficial'], ['扣137送萝莉小前辈'], ['魔法少女苍蓝星'],
  ['下班，然后观察魔法少女'], ['向日葵（征集新闻线索中）'], ['妖精保护协会'],
  ['野史学家'], ['A[LI]CE'], ['蓝色小屁孩'], ['大道至简受害者'],
  ['AAA竞技场专业修复小银全天无休'],
] as const;
const PUBLICATIONS = [
  'A.R.E.N.A.论坛-综合板块',
  'MGA论坛-魔法少女国家地理-竞技场',
  '魔乎-如何评价魔法少女？',
  '摆渡贴吧-A.R.E.N.A.吧-【精】近期新闻合集',
  '银廊树洞-A.R.E.N.A.相关',
  'MagicRevue-命运的舞台',
  '国度论坛-魔法少女板块',
  '魔法国度娱乐中心-时事趣闻',
  '魔信公众号平台',
] as const;

const randomReporter = (random: () => number): { name: string; publication: string } => {
  const journalist = JOURNALISTS[Math.floor(random() * JOURNALISTS.length)]
    ?? ['佚名'];
  return {
    name: journalist[0],
    publication: journalist[1]
      ?? PUBLICATIONS[Math.floor(random() * PUBLICATIONS.length)]
      ?? '魔法国度时报',
  };
};

export const buildArenaGenerationPrompt = async (input: {
  actorKey: string;
  payload: Record<string, unknown>;
  random?: () => number;
}): Promise<ArenaGenerationPrompt> => {
  const { payload } = input;
  const random = input.random ?? Math.random;
  const outputContract = resolveArenaGenerationOutputContract(payload);
  const webPackageRef = payload.webPackageRef === undefined
    ? undefined
    : WebPackageRefSchema.parse(payload.webPackageRef);
  if (webPackageRef && !isPackageBackedOutputContract(outputContract)) {
    throw new Error('ARENA_WEB_PACKAGE_REQUIRES_WEB');
  }
  const webPackagePromptProjection = payload.webPackagePromptProjection === undefined
    ? undefined
    : WebPackagePromptProjectionSchema.parse(payload.webPackagePromptProjection);
  if (webPackagePromptProjection) {
    if (!webPackageRef
      || webPackagePromptProjection.package.id !== webPackageRef.id
      || webPackagePromptProjection.package.version !== webPackageRef.version
      || webPackagePromptProjection.package.digest !== webPackageRef.digest) {
      throw new Error('ARENA_WEB_PACKAGE_PROJECTION_MISMATCH');
    }
  }
  // Server-resolvable packages always rebuild a canonical Projection; a client
  // Projection is only authoritative when the server cannot resolve the ref.
  let trustedProjection = webPackagePromptProjection;
  let packagePrompt: string | undefined;
  if (webPackageRef) {
    try {
      const base = await resolveWebPackage(webPackageRef);
      const canonical = buildWebPackagePromptProjection(base);
      if (
        webPackagePromptProjection
        && JSON.stringify(webPackagePromptProjection) !== JSON.stringify(canonical)
      ) {
        throw new Error('ARENA_WEB_PACKAGE_PROJECTION_MISMATCH');
      }
      trustedProjection = canonical;
      packagePrompt = buildWebPackagePromptFromProjection(canonical);
    } catch (error) {
      if (error instanceof Error && error.message === 'ARENA_WEB_PACKAGE_PROJECTION_MISMATCH') {
        throw error;
      }
      if (!webPackagePromptProjection) throw error;
      packagePrompt = buildWebPackagePromptFromProjection(webPackagePromptProjection);
    }
  }
  const rawUserGuidance = text(payload.userGuidance);
  // Legacy non-stream handlers bounded this field before safety, prompting,
  // response projection and history writes. Streaming intentionally remains
  // free-form and keeps the full guidance text.
  const userGuidance = (
    asRecord(payload.__arenaServerContextV1)?.deliveryMode === 'non-stream'
      ? rawUserGuidance.slice(0, 200)
      : rawUserGuidance
  ) || null;
  return assembleArenaGenerationPrompt({
    payload: { ...payload, userGuidance },
    outputContract,
    reporterInfo: randomReporter(random),
    adjudicationResults: Array.isArray(payload.adjudicationResults) ? payload.adjudicationResults : null,
    ...(webPackageRef ? {
      packageContext: { ref: webPackageRef, projection: trustedProjection, prompt: packagePrompt },
    } : {}),
  });
};
