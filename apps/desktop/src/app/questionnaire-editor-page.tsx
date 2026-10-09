import { useCallback, useMemo, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Link, useRouter } from '@tanstack/react-router';
import { LocalQuestionnairePanel } from '@mahoshojo/ui-web/questionnaire-editor';
import { ProductFooter } from '@mahoshojo/ui-web/shell';
import { buildSafeFileName } from '@mahoshojo/ui-web/client';
import { IpcLocalCardRepository } from '../platform/local-card-bridge';
import { downloadTextFile } from '../platform/download-text-file';
import { saveCardDraft } from '../features/character-manager/editor';
import { useExternalLinks } from '../features/external-links/external-links-provider';
import { useLeaveGuard } from './useLeaveGuard';
import { navigateByProductHref, resolveInternalHrefForHashHistory } from './hash-history-fragment';

export function DesktopQuestionnaireEditor() {
  const router = useRouter();
  const { openFixed } = useExternalLinks();
  const repository = useMemo(() => new IpcLocalCardRepository((command, args) => invoke(command, args as never)), []);
  const busy = useRef(false);
  const dirty = useRef(false);
  const onDirtyChange = useCallback((value: boolean) => { dirty.current = value; }, []);
  const onBusyChange = useCallback((value: boolean) => { busy.current = value; }, []);
  const guard = useLeaveGuard(
    () => busy.current || dirty.current,
    '问卷有未保存的编辑、未使用的粘贴或操作仍在进行，请保存或确认放弃后再离开。',
    '窗口关闭保护初始化失败，问卷编辑暂不可用，请重新打开页面。',
    () => !busy.current && window.confirm('问卷编辑或粘贴尚未保存，确认放弃并离开？'),
  );
  return <div className="magic-background-white"><div className="container !max-w-[1100px]"><div className="card !max-w-none">
    <h1 className="title text-center">问卷编辑器</h1>
    <p className="subtitle text-center">把问卷当作可维护的创作工具箱</p>
    <LocalQuestionnairePanel repository={repository} disabled={!guard.ready} onBusyChange={onBusyChange} onDirtyChange={onDirtyChange}
      confirmReplace={() => window.confirm('当前问卷或粘贴内容尚未保存，确认放弃并载入新来源？')}
      saveCard={async (data, title) => {
        const result = await saveCardDraft(repository, { original: null, cardType: 'questionnaire', title, data });
        if (result.kind === 'in-recycle-bin') throw new Error('相同内容已在回收站，未覆盖或恢复，请先检查本地库。');
        if (result.kind === 'document-too-large') throw new Error('保存记录超过本地大小上限，请精简内容。');
        if (result.kind === 'exists') {
          const existing = await repository.get(result.id);
          if (!existing || existing.deletedAt !== undefined || existing.cardType !== 'questionnaire') throw new Error('相同内容记录暂不可用或类型不同，请检查本地库。');
          return 'already-present';
        }
        return 'saved';
      }}
      downloadText={(text, name) => downloadTextFile(buildSafeFileName(name, 'json', '问卷'), text)} />
    {guard.message ? <p role="alert">{guard.message}</p> : null}
    <div className="mt-8 text-center"><Link to="/" className="footer-link">返回首页</Link></div>
  </div><ProductFooter className="footer" assetSource={{ baseUrl: '/' }} onNavigateInternal={(href) => navigateByProductHref(router, href)} resolveInternalHref={resolveInternalHrefForHashHistory} onNavigateExternal={openFixed} /></div></div>;
}
