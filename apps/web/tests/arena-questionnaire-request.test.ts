import { describe, expect, it } from 'vitest';
import { ArenaRoomHostRuntimeGenerationSchema } from '@mahoshojo/contracts/arena-room';

import { buildArenaQuestionnaireRequest } from '@/components/arena/utils/questionnaireRequest';
import type { QuestionnaireSelection } from '@/components/arena/types';

const questionnaire: QuestionnaireSelection['questionnaire'] = {
  id: 'test', title: '测试问卷', kind: 'magical-girl', questions: [],
};

describe('Arena 问卷生成请求', () => {
  it.each(['preset', 'database', 'upload'] as const)('%s 的缺省字段不会阻止多人生成', (source) => {
    const selection: QuestionnaireSelection = { source, questionnaire };
    const request = buildArenaQuestionnaireRequest([selection]);
    expect(ArenaRoomHostRuntimeGenerationSchema.safeParse(request).success).toBe(true);
    expect(request).toStrictEqual(JSON.parse(JSON.stringify(request)));
    expect(request.questionnaireSelections).toEqual([{
      source, kind: 'magical-girl', ...(source === 'preset' ? { presetId: 'test' } : {}),
    }]);
    expect(request.questionnaires).toEqual([{ id: 'test', title: '测试问卷', kind: 'magical-girl' }]);
  });

  it('保留数据库引用、显式禁用世界书以及空世界书', () => {
    const request = buildArenaQuestionnaireRequest([{
      source: 'database', dataCardId: 'card-1', useLore: false,
      questionnaire: { ...questionnaire, loreMarkdown: '' },
    }]);
    expect(ArenaRoomHostRuntimeGenerationSchema.safeParse(request).success).toBe(true);
    expect(request.questionnaireSelections?.[0]).toEqual({
      source: 'database', kind: 'magical-girl', dataCardId: 'card-1', useLore: false,
    });
    expect(request.questionnaires?.[0]).toEqual({
      id: 'test', title: '测试问卷', kind: 'magical-girl', useLore: false, loreMarkdown: '',
    });
  });

  it('未选择问卷时维持缺省请求语义', () => {
    const request = buildArenaQuestionnaireRequest([]);
    expect(request).toEqual({ questionnaireSelections: undefined, questionnaires: undefined });
    expect(ArenaRoomHostRuntimeGenerationSchema.safeParse(request).success).toBe(true);
  });
});
