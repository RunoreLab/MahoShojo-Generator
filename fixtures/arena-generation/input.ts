/** Test-only, synthetic fixture frozen against 76acdab3 before pure-core extraction. */
export const arenaModes = ['classic', 'kizuna', 'daily', 'scenario'] as const;
export const arenaDeliveries = ['stream', 'non-stream'] as const;
export const arenaParityPayload = (mode: string, deliveryMode: string) => ({
  mode, reportFormat: 'markdown', language: 'ja', storyLength: 'long', customStoryLength: '0880',
  userGuidance: '重逢，保留扩展设定',
  combatants: ['雪绒', '白玫瑰'].map((name, index) => ({
    type: 'general-character', data: {
      name, content: `角色${index + 1}设定`, extension: { nested: ['不可丢失', index] },
      signature: 'excluded-signature', userAnswers: ['旧回答'],
      current_state: { summary: '仍持红伞', fields: [{ label: '约定', type: 'boolean', value: true }] },
      arena_history: { entries: [{ id: 7, title: '前次相遇', participants: ['雪绒', '白玫瑰'], winner: '平局', impact: '达成约定', metadata: {} }] },
    },
    teamId: index + 1, characterGuidance: '守约',
  })),
  scenario: mode === 'scenario' ? { templateId: '通用情景', title: '雨夜车站', content: '列车刚刚到站', extension: '情景扩展' } : undefined,
  auxScenarios: mode === 'scenario' ? [{ title: '旧城', content: '车站外的街道' }] : undefined,
  teams: { 1: ['雪绒'], 2: ['白玫瑰'] }, teamNames: { 1: '红伞', 2: '白灯' },
  materials: [{ name: '站牌', sourceType: 'raw-json', fileName: 'station.json', content: { station: '终点站', nested: { detail: '夜色' }, signature: 'excluded-material-signature' } }],
  questionnaires: [{ id: 'lore', title: '地方志', kind: 'magical-girl', loreMarkdown: '雨城的约定' }],
  readArenaHistory: true, arenaHistoryReadLimit: null, writeArenaHistory: true,
  readCurrentState: true, writeCurrentState: true,
  readNarrativeHistory: true, writeNarrativeHistory: true, narrativeHistoryReadLimit: 2,
  narrativeHistory: [{ title: '前情', content: '旧约定仍有效', createdAt: '2026-01-01', updatedAt: '2026-01-02' }],
  adjudicationResults: [{ depth: 0, description: '列车是否晚点', type: 'binary', roll: 10, outcome: '成功', details: '掷骰(10) vs 成功率(50%)' }],
  __arenaServerContextV1: { deliveryMode, endpoint: 'api/arena/generate' },
});
