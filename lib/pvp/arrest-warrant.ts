import type { NewsReport } from '@/components/BattleReportCard';

const hashStringToUint32 = (input: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const formatInspectorId = (seed: string): string => {
  const n = hashStringToUint32(seed) % 1_000_000;
  return `HK-${String(n).padStart(6, '0')}`;
};

const formatCaseNumber = (roomId: string, matchId: string, roundId: string): string => {
  const room = roomId.slice(0, 6) || 'ROOM';
  const match = matchId.slice(0, 8) || 'MATCH';
  const round = roundId.slice(0, 8) || 'ROUND';
  return `PVP-${room}-${match}-${round}`;
};

const formatIssuedAt = (issuedAt: Date): string => {
  const iso = issuedAt.toISOString();
  return iso.replace('T', ' ').replace(/\.\d{3}Z$/, 'Z');
};

export const buildPvpSensitiveArrestWarrantReport = (params: {
  reason?: string | null;
  roomId: string;
  matchId: string;
  roundId: string;
  issuedAt?: Date;
}): NewsReport => {
  const reason = (params.reason || '使用危险符文').trim() || '使用危险符文';
  const issuedAt = params.issuedAt ?? new Date();
  const caseNumber = formatCaseNumber(params.roomId, params.matchId, params.roundId);
  const inspectorId = formatInspectorId(`${params.roomId}:${params.roundId}`);
  const magicalTimestamp = formatIssuedAt(issuedAt);

  const body = [
    '## 逮捕令',
    '',
    '**批 准 逮 捕**',
    '',
    '### 案件信息',
    `- **案件编号**：${caseNumber}`,
    `- **签发时间**：${magicalTimestamp}`,
    `- **事由**：${reason}`,
    `- **巡查使 花牌认证编号**：${inspectorId}`,
    '',
    '### 处理结果',
    '- 本轮对局触发敏感词拦截，调查院已接管战报并自动截断。',
    '- 为避免向对手回传不合规内容并保证公平性，本轮判定为 **平局**。',
    '',
    '---',
    '',
    '⚠️ **金绿猫眼权杖严正声明** ⚠️',
    '',
    '城际网络并非法外之地！',
    '',
  ].join('\n');

  return {
    headline: '调查院逮捕令',
    reporterInfo: {
      name: '巡查使 花牌',
      publication: '魔法国度调查院',
    },
    article: {
      body,
      analysis: '内容触发调查院规则拦截，本轮已按平局处理。',
    },
    officialReport: {
      winner: '平局',
      conclusion: '本轮对局触发敏感词拦截，战报已被调查院接管并自动截断，结果判定为平局。',
    },
  };
};
