'use client';

import { useMemo } from 'react';

import { BaseModal } from '@/components/shared/BaseModal';
import type { MagicTeaPartySession } from '@/lib/magic-tea-party/types';

type MagicTeaPartyBranchChainModalProps = {
  isOpen: boolean;
  sessions: MagicTeaPartySession[];
  activeSession: MagicTeaPartySession | null;
  onSelectSession: (sessionId: string) => void;
  onClose: () => void;
};

export function MagicTeaPartyBranchChainModal(props: MagicTeaPartyBranchChainModalProps) {
  const { isOpen, sessions, activeSession, onSelectSession, onClose } = props;

  const { chain, children } = useMemo(() => {
    if (!activeSession) return { chain: [], children: [] as MagicTeaPartySession[] };
    const map = new Map(sessions.map((session) => [session.id, session]));
    const chainStack: MagicTeaPartySession[] = [];
    let cursor: MagicTeaPartySession | undefined = activeSession;
    while (cursor) {
      chainStack.push(cursor);
      const parentId = cursor.forkedFrom?.sessionId;
      if (!parentId) break;
      cursor = map.get(parentId);
      if (!cursor) break;
    }
    const childSessions = sessions
      .filter((session) => session.forkedFrom?.sessionId === activeSession.id)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    return { chain: chainStack.reverse(), children: childSessions };
  }, [activeSession, sessions]);

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="分支链"
      description="查看父子会话关系，并快速跳转到目标分支。"
      maxWidthClassName="max-w-2xl"
    >
      {!activeSession ? (
        <div className="text-sm text-gray-500">尚未选择会话。</div>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="text-sm font-semibold text-gray-800">主线链路</div>
            <div className="mt-2 space-y-2">
              {chain.map((session, index) => {
                const isActive = session.id === activeSession.id;
                return (
                  <button
                    key={session.id}
                    type="button"
                    className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                      isActive ? 'border-pink-300 bg-pink-50 text-pink-800' : 'border-pink-100 bg-white hover:bg-pink-50/60'
                    }`}
                    onClick={() => {
                      if (!isActive) onSelectSession(session.id);
                      onClose();
                    }}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{session.title}</div>
                      <div className="text-[11px] text-gray-500">
                        {index === 0 ? '根会话' : session.branchLabel || '分支会话'} · {new Date(session.updatedAt).toLocaleString()}
                      </div>
                    </div>
                    {isActive ? <span className="text-[11px] font-semibold text-pink-700">当前</span> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="text-sm font-semibold text-gray-800">子分支</div>
            {children.length === 0 ? (
              <div className="mt-2 text-xs text-gray-500">当前会话没有子分支。</div>
            ) : (
              <div className="mt-2 space-y-2">
                {children.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-pink-100 bg-white px-3 py-2 text-left hover:bg-pink-50/60"
                    onClick={() => {
                      onSelectSession(session.id);
                      onClose();
                    }}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{session.title}</div>
                      <div className="text-[11px] text-gray-500">{session.branchLabel || '分支会话'} · {new Date(session.updatedAt).toLocaleString()}</div>
                    </div>
                    <span className="text-[11px] text-pink-600">跳转</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </BaseModal>
  );
}
