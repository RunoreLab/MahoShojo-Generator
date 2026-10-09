import { useCallback, useMemo, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Link, useRouter } from '@tanstack/react-router';
import { LocalTeamPanel } from '@mahoshojo/ui-web/team';
import { saveImportedUnsignedCharacter } from '@mahoshojo/local-library/imported-unsigned-card';
import { MagicalGirlCard, CanshouCard, GeneralCharacterCard, resolveMagicalGirlGradient } from '@mahoshojo/ui-web/character-card';
import { ProductFooter } from '@mahoshojo/ui-web/shell';
import { buildSafeFileName } from '@mahoshojo/ui-web/client';
import { IpcLocalCardRepository } from '../platform/local-card-bridge';
import { downloadTextFile } from '../platform/download-text-file';
import { asCharacterCardPreview } from '../features/character-manager/editor';
import { useExternalLinks } from '../features/external-links/external-links-provider';
import { useLeaveGuard } from './useLeaveGuard';
import { navigateByProductHref, resolveInternalHrefForHashHistory } from './hash-history-fragment';

export function DesktopParty() {
  const router = useRouter();
  const { openFixed } = useExternalLinks();
  const repository = useMemo(() => new IpcLocalCardRepository((command, args) => invoke(command, args as never)), []);
  const busy = useRef(false);
  const dirty = useRef(false);
  const onDirtyChange = useCallback((value: boolean) => { dirty.current = value; }, []);
  const onBusyChange = useCallback((value: boolean) => { busy.current = value; }, []);
  const guard = useLeaveGuard(
    () => busy.current || dirty.current,
    '有尚未保存的队伍或未使用的粘贴内容，或操作仍在进行。请保存、等待完成，或确认放弃后再离开。',
    '窗口关闭保护初始化失败，组队操作暂不可用。请重新打开页面后重试。',
    () => !busy.current && window.confirm('队伍编排或粘贴内容尚未保存。确认放弃并离开？'),
  );
  return <div className="magic-background-white"><div className="container !max-w-[1100px]"><div className="card !max-w-none">
    <h1 className="title text-center">🧩 角色组队</h1>
    <p className="subtitle text-center">把多个角色卡拼接成一张“队伍角色卡”。字符串与数组会自动加上 <code>【角色名/代号】</code> 前缀，缺失字段会被自动忽略。</p>
    <LocalTeamPanel repository={repository} disabled={!guard.ready} onBusyChange={onBusyChange} onDirtyChange={onDirtyChange}
      saveCard={(data, name) => saveImportedUnsignedCharacter(repository, data, name)}
      downloadJson={(data, name) => downloadTextFile(buildSafeFileName(name, 'json', '队伍'), JSON.stringify(data, null, 2))}
      renderPreview={(result) => {
        const preview = asCharacterCardPreview({ original: null, cardType: 'character', title: '队伍', data: result.data });
        if (preview?.kind === 'magical-girl') return <MagicalGirlCard magicalGirl={preview.data} gradientStyle={resolveMagicalGirlGradient(preview.data.appearance.colorScheme)} />;
        if (preview?.kind === 'canshou') return <CanshouCard canshou={preview.data} />;
        if (preview?.kind === 'general') return <GeneralCharacterCard general={preview.data} />;
        return <p>请查看下方合并 JSON。</p>;
      }} />
    {guard.message ? <p role="alert">{guard.message}</p> : null}
    <div className="mt-8 text-center"><Link to="/" className="footer-link">返回首页</Link></div>
  </div><ProductFooter className="footer" assetSource={{ baseUrl: '/' }} onNavigateInternal={(href) => navigateByProductHref(router, href)} resolveInternalHref={resolveInternalHrefForHashHistory} onNavigateExternal={openFixed} /></div></div>;
}
