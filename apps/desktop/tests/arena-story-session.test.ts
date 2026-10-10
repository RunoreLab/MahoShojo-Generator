import { describe, expect, it, vi } from 'vitest';
import { DesktopArenaStorySession } from '../src/features/arena/story-session';
import { prepareStoryStorageCommit, streamCommittedStoryMarkdown } from '../src/platform/arena-story-storage';
import { createBattleStoryExportMarkdownWriter, projectBattleStoryExportChapter } from '@mahoshojo/domain/arena-story-export';
import { deferred, installStoryCrypto, StoryFixturePort, storyDraft, storyExecution } from './helpers/story-fixture';

installStoryCrypto();
const setup = (extra: Partial<ConstructorParameters<typeof DesktopArenaStorySession>[0]> = {}) => {
  const port=new StoryFixturePort(), execution=storyExecution();let id=0,now=100;
  const owner=new DesktopArenaStorySession({port,id:()=>`test-${++id}`,now:()=>++now,exportMarkdown:async()=>({absolutePath:'fixture.md',byteLength:1}),...extra}); owner.setExecutionScope('account-A');
  return {owner,port,execution};
};

describe('device-owned continuous story journey',()=>{
  it('first chapter and explicit continuation use actual Direct transport, frozen seed and atomic records, never change either draft',async()=>{
    const {owner,port,execution}=setup(); const draft=storyDraft(), original=structuredClone(draft);
    await owner.start({draft,product:'battle'},execution.prepare);
    expect(owner.getSnapshot()).toMatchObject({phase:'completed',resultSaved:true,pending:null,active:{chapterCount:1}});
    expect(port.begin).toHaveBeenCalledTimes(1); expect(execution.requests).toHaveLength(1); expect(draft).toEqual(original);
    const head=owner.getSnapshot().active!;
    draft.combatants[0]!.data.name='其它页角色'; draft.settings.userGuidance='其它页引导';
    await owner.continue('本章独立引导',execution.prepare);
    expect(owner.getSnapshot().active).toMatchObject({id:head.id,chapterCount:2,revision:2});
    const payload=JSON.parse(execution.requests[1]!.arenaInputJson!);
    expect(payload.combatants[0].data.name).toBe('甲'); expect(payload.userGuidance).toBe('本章独立引导');
    expect(payload.internalGuidance).toContain('第 2 章'); expect(payload.internalGuidance).toContain('第1章');
    expect(payload.internalGuidance).not.toContain('其它页'); expect(execution.requests).toHaveLength(2);
    const stored=port.documents.get(`${head.id}:session`)!.value;
    expect(stored.summaryMeta).toMatchObject({mode:'deterministic-fallback',coveredUntilChapterIndex:2});
    expect(stored).not.toHaveProperty('workingCombatants'); expect(JSON.stringify(stored)).not.toContain('apiKey');
  });
  it('rejects over-budget actual seed before any object stringify/clone or model dispatch',async()=>{
    const {owner,port,execution}=setup();const draft=storyDraft();draft.combatants[0]!.data.content='\u0000'.repeat(3*1024*1024);
    const stringify=JSON.stringify.bind(JSON), objectCalls:unknown[]=[];
    const spy=vi.spyOn(JSON,'stringify').mockImplementation(((value:unknown,...args:unknown[])=>{if(value&&typeof value==='object'){objectCalls.push(value);throw new Error('object serialization forbidden');}return stringify(value,...args as []);}) as typeof JSON.stringify);
    try {await owner.start({draft,product:'battle'},execution.prepare);}finally{spy.mockRestore();}
    expect(objectCalls).toHaveLength(0);expect(execution.requests).toHaveLength(0);expect(port.begin).not.toHaveBeenCalled();expect(owner.getSnapshot().phase).toBe('failed');expect(Object.isFrozen(draft.combatants[0]!.data)).toBe(false);
  });
  it('unrelated oversized single-shot history cannot block or enter a small story seed',async()=>{
    const {owner,execution}=setup();const draft=storyDraft();draft.settings.readNarrativeHistory=true;draft.settings.isNarrativeHistoryUnlimited=true;
    Object.defineProperty(draft,'historyReferences',{get:()=>{throw new Error('must not read unrelated draft history');}});
    Object.defineProperty(draft,'narrativeHistoryEntries',{get:()=>{throw new Error('must not read activity draft');}});
    await owner.start({draft,product:'battle'},execution.prepare);
    expect(owner.getSnapshot()).toMatchObject({phase:'completed',resultSaved:true});expect(execution.requests).toHaveLength(1);expect(JSON.parse(execution.requests[0]!.arenaInputJson!)).not.toHaveProperty('narrativeHistory');
  });
  it('reopens through only directory and selected chapter, then reads only last12 context records',async()=>{
    const {owner,port,execution}=setup();await owner.start({draft:storyDraft(),product:'arena'},execution.prepare);
    for(let i=1;i<27;i++) await owner.continue('',execution.prepare);
    const head=owner.getSnapshot().active!; expect(head.chapterCount).toBe(27);
    owner.dispose(); port.describe.mockClear();port.read.mockClear();port.continueState.mockClear();port.listChapters.mockClear();
    const reopened=new DesktopArenaStorySession({port,exportMarkdown:async()=>({absolutePath:'fixture',byteLength:1})});reopened.setExecutionScope('account-B');await reopened.initialize();
    expect(reopened.getSnapshot().chapters).toHaveLength(25); expect(reopened.getSnapshot().active?.chapterCount).toBe(27);
    expect(port.describe.mock.calls.map((call)=>call[2])).toEqual(['chapter']);expect(port.continueState).not.toHaveBeenCalled();
    await reopened.loadMoreChapters();expect(reopened.getSnapshot().chapters).toHaveLength(27);
    port.describe.mockClear();await reopened.continue('',execution.prepare);
    expect(port.continueState).toHaveBeenCalledTimes(1);
    // 12 context chapters, one selected committed chapter; never all history/checkpoints.
    expect(port.describe.mock.calls.filter((call)=>call[2]==='chapter')).toHaveLength(13);
    expect(port.describe.mock.calls.filter((call)=>call[2]==='checkpoint')).toHaveLength(1);
  });
  it('unknown end never rewrites or dispatches another model; missing receipt remains unknown',async()=>{
    const {owner,port,execution}=setup();port.loseEndReply=true;port.hideReceipts=true;
    await owner.start({draft:storyDraft(),product:'battle'},execution.prepare);
    expect(owner.getSnapshot().pending?.evidence).toBe('unknown'); expect(owner.hasUnsavedResult()).toBe(true);
    await owner.savePending();expect(owner.getSnapshot().pending?.evidence).toBe('unknown');
    expect(port.begin).toHaveBeenCalledTimes(1);expect(port.end).toHaveBeenCalledTimes(1);expect(execution.requests).toHaveLength(1);
    owner.setExecutionScope('signed-out');expect(owner.getSnapshot().pending?.evidence).toBe('unknown');
    port.hideReceipts=false;await owner.savePending();expect(owner.getSnapshot()).toMatchObject({pending:null,resultSaved:true,active:{chapterCount:1}});
    expect(port.begin).toHaveBeenCalledTimes(1);expect(execution.requests).toHaveLength(1);
  });
  it('known local save failure retries the exact prepared identity without any model replay',async()=>{
    const {owner,port,execution}=setup();port.failBegin=true;
    await owner.start({draft:storyDraft(),product:'battle'},execution.prepare);
    expect(owner.getSnapshot().pending?.evidence).toBe('not-written'); const first=port.begin.mock.calls[0]![0];
    port.failBegin=false;await owner.savePending();expect(port.begin.mock.calls[1]![0]).toBe(first);expect(execution.requests).toHaveLength(1);
    expect(owner.getSnapshot().active?.chapterCount).toBe(1);
  });
  it('actual preflight failure retains full received prose, disables deterministic retry and performs zero save IPC',async()=>{
    const prepareCommit:typeof prepareStoryStorageCommit=async(input)=>prepareStoryStorageCommit(input,1);
    const {owner,port,execution}=setup({prepareCommit});await owner.start({draft:storyDraft(),product:'battle'},execution.prepare);
    expect(owner.getSnapshot()).toMatchObject({phase:'completed',resultSaved:false,pending:{tooLarge:true,retryable:false}});
    expect(owner.getSnapshot().result?.markdown).toContain('甲与乙');expect(owner.hasUnsavedResult()).toBe(true);
    await owner.savePending();expect(port.begin).not.toHaveBeenCalled();expect(execution.requests).toHaveLength(1);
    expect(owner.getSnapshot().message).toContain('未保存到会话');
  });
  it('manual chapter selection during save takes priority over automatic result reopening',async()=>{
    const {owner,port,execution}=setup();await owner.start({draft:storyDraft(),product:'battle'},execution.prepare);const first=owner.getSnapshot().active!.lastChapterId;
    const gate=deferred<void>();port.beforeEnd=()=>gate.promise;
    const saving=owner.continue('',execution.prepare); await vi.waitFor(()=>expect(port.end).toHaveBeenCalledTimes(2));
    await owner.selectChapter(first);gate.resolve();await saving;
    expect(owner.getSnapshot().selected).toMatchObject({status:'loaded',chapterId:first});expect(owner.getSnapshot().savedUnread?.chapterCount).toBe(2); expect(owner.getSnapshot().active?.chapterCount).toBe(2);
    port.beforeEnd=undefined;await owner.continue('',execution.prepare);expect(owner.getSnapshot().active?.chapterCount).toBe(3);expect(execution.requests).toHaveLength(3);
  });
  it('late details cannot put another chapter body under the new selection',async()=>{
    const {owner,port,execution}=setup();await owner.start({draft:storyDraft(),product:'battle'},execution.prepare);const first=owner.getSnapshot().active!.lastChapterId;await owner.continue('',execution.prepare);const last=owner.getSnapshot().active!.lastChapterId;
    const gate=deferred<void>();port.beforeRead=async(desc)=>{if(desc.recordId===first)await gate.promise;};
    const stale=owner.selectChapter(first);await owner.selectChapter(last);gate.resolve();await stale;
    expect(owner.getSnapshot().selected).toMatchObject({status:'loaded',chapterId:last,chapter:{index:2}});
  });
  it('account/target switch cancels work but retains accepted partial and previously saved story',async()=>{
    const {owner,port,execution}=setup();await owner.start({draft:storyDraft(),product:'battle'},execution.prepare);const saved=owner.getSnapshot().active!;
    const gate=deferred<void>(); const execute=vi.fn(async(_options,input,intent,host,signal,onPartial)=>{onPartial?.({rawText:'收到的原文',markdown:'收到的原文',reasoning:''});await gate.promise;return{status:'cancelled',reason:'aborted',rawText:'收到的原文',markdown:'收到的原文',reasoning:'',requestId:intent.requestId,scopeKey:host.scopeKey,mode:intent.mode,terminal:null} as const;});
    const second=new DesktopArenaStorySession({port,execute,exportMarkdown:async()=>({absolutePath:'x',byteLength:1})});second.setExecutionScope('A');await second.initialize();
    const run=second.continue('',execution.prepare);await vi.waitFor(()=>expect(execute).toHaveBeenCalled());second.setExecutionScope('B');gate.resolve();await run;
    expect(second.getSnapshot()).toMatchObject({phase:'cancelled',result:{rawText:'收到的原文'},active:{id:saved.id,chapterCount:1}});expect(second.hasUnsavedResult()).toBe(true);expect(port.begin).toHaveBeenCalledTimes(1);
  });
  it('reports a fully published export even when cancel races its final successful receipt',async()=>{
    const gate=deferred<{absolutePath:string;byteLength:number}>();
    const {owner,execution}=setup({exportMarkdown:()=>gate.promise});
    await owner.start({draft:storyDraft(),product:'battle'},execution.prepare);
    const exporting=owner.exportSelectedStory();owner.cancelExport();
    gate.resolve({absolutePath:'verified-complete.md',byteLength:42});await exporting;
    expect(owner.getSnapshot()).toMatchObject({exporting:false,exportError:null,exportResult:{absolutePath:'verified-complete.md',byteLength:42}});
  });
  it('complete export crosses visible25 rows, uses shared exact bytes and excludes unsaved results',async()=>{
    const {owner,port,execution}=setup();await owner.start({draft:storyDraft(),product:'battle'},execution.prepare);for(let i=1;i<27;i++)await owner.continue('',execution.prepare);
    const head=owner.getSnapshot().active!; const blocks=[];for await(const chunk of streamCommittedStoryMarkdown(port,head))blocks.push(chunk);
    const actual=Buffer.concat(blocks).toString('utf8'),session=port.documents.get(`${head.id}:session`)!.value;
    const writer=createBattleStoryExportMarkdownWriter(session as never,head.chapterCount);const expected=writer.header+port.chapterDocuments(head.id).map((chapter)=>writer.writeChapter(projectBattleStoryExportChapter(chapter))).join('');
    expect(actual).toBe(expected);expect(actual).toContain('第27章');expect(owner.getSnapshot().chapters).toHaveLength(25);
  });
});
