import { expect, it } from 'vitest';
import { buildSublimationStreamCore } from '../src/sublimation-generation';
it('explicit stream state permissions exclude private state and include requested history', () => {
  const input = { originalData: { name: '星', content: '内容', current_state: {summary:'PRIVATE_STATE'}, arena_history:{entries:[{title:'HISTORY_MARKER',impact:'成长'}]} },
    language:'zh-CN',userGuidance:'',narrativeHistory:'',fieldsToPreserve:[],isDowngrade:false,allowReshapeNames:false,sourceTemplate:'general',targetTemplate:'general',loreText:'',
    stateOptions:{readArenaHistory:true,readCurrentState:false} };
  const prompt=buildSublimationStreamCore(input).prompt;
  expect(prompt).not.toContain('PRIVATE_STATE'); expect(prompt).toContain('HISTORY_MARKER');
});

import { createSublimationGenerationCore } from '../src/sublimation-generation';
import { convertSublimationCharacterCard } from '@mahoshojo/domain/sublimation';
it('structured generic skeleton cannot reintroduce excluded state/history through converted content', () => {
 const originalData={name:'星',content:'正文',current_state:{summary:'PRIVATE_STATE'},arena_history:{entries:[{title:'HISTORY_MARKER'}]}};
 const baseOutputData=convertSublimationCharacterCard(originalData,'general','general').data;
 const before=JSON.stringify(baseOutputData);
 const prompt=createSublimationGenerationCore({originalData,baseOutputData,language:'zh-CN',userGuidance:null,narrativeHistory:null,loreText:null,sourceTemplate:'general',targetTemplate:'general',fieldsToPreserve:[],allowReshapeNames:false,defaultQuestions:{magicalGirl:[],canshou:[]},stateOptions:{readArenaHistory:false,readCurrentState:false,writeArenaHistory:false,writeCurrentState:false}}).promptBuilder();
 expect(prompt).not.toContain('PRIVATE_STATE');expect(prompt).not.toContain('HISTORY_MARKER');
 expect(JSON.stringify(baseOutputData)).toBe(before);
});
