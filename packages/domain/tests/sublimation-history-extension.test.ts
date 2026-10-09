import { expect, it } from 'vitest';
import { applySublimationArenaHistoryStrategy } from '../src/sublimation';
it('keep-all preserves history and attribute extensions without mutating source', () => {
 const source={extension:{x:1},attributes:{world_line_id:'old',future_extension:{x:2}},entries:[{id:'old',type:'unknown',future:3}]};
 const before=JSON.stringify(source);
 const value=applySublimationArenaHistoryStrategy({sourceArenaHistory:source,strategy:'keep-all',newEntry:{type:'sublimation'},nowISO:'2026-10-09',createWorldLineId:()=> 'new'});
 expect(value).toHaveProperty('extension',{x:1}); expect(value.attributes).toHaveProperty('future_extension',{x:2});
 expect(value.entries[0]).toHaveProperty('future',3); expect(JSON.stringify(source)).toBe(before);
 const reset=applySublimationArenaHistoryStrategy({sourceArenaHistory:source,strategy:'reset-all',newEntry:{type:'sublimation'},nowISO:'2026-10-09',createWorldLineId:()=> 'new'});
 expect(reset).not.toHaveProperty('extension'); expect(reset.attributes).not.toHaveProperty('future_extension');
});
it('keep-all refuses malformed history entries instead of silently discarding them', () => {
 const source={attributes:{},entries:[{id:1,type:'battle'},'legacy raw entry']};
 expect(()=>applySublimationArenaHistoryStrategy({sourceArenaHistory:source,strategy:'keep-all',newEntry:{},nowISO:'2026-10-09'})).toThrow();
 expect(source.entries).toHaveLength(2);
});
