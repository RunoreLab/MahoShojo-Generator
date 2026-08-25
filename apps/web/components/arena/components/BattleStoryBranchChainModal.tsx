'use client';

import { useMemo } from 'react';

import { BaseModal } from '@/components/shared/BaseModal';
import type { BattleStorySessionRecord } from '@/lib/ai-session/battle-story/types';

type BattleStoryBranchChainModalProps = {
  isOpen: boolean;
  sessions: BattleStorySessionRecord[];
  activeSession: BattleStorySessionRecord | null;
  onSelectSession: (sessionId: string) => void;
  onClose: () => void;
};

export function BattleStoryBranchChainModal(props: BattleStoryBranchChainModalProps) {
  const { isOpen, sessions, activeSession, onSelectSession, onClose } = props;

  const { chain, children } = useMemo(() => {
    if (!activeSession) return { chain: [], children: [] as BattleStorySessionRecord[] };

    const sessionMap = new Map(sessions.map((session) => [session.id, session]));
    const chainStack: BattleStorySessionRecord[] = [];
    let cursor: BattleStorySessionRecord | undefined = activeSession;

    while (cursor) {
      chainStack.push(cursor);
      const parentId = cursor.branchOf?.sessionId;
      if (!parentId) break;
      cursor = sessionMap.get(parentId);
      if (!cursor) break;
    }

    const childSessions = sessions
      .filter((session) => session.branchOf?.sessionId === activeSession.id)
      .sort((left, right) => right.updatedAt - left.updatedAt);

    return {
      chain: chainStack.reverse(),
      children: childSessions,
    };
  }, [activeSession, sessions]);

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="分支链"
      description="查看连续战报会话的父链与子分支，并快速跳转。"
      maxWidthClassName="max-w-2xl"
    >
      {!activeSession ? (
        <div className="text-sm text-gray-500">尚未选择连续战报会话。</div>
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
                      isActive ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-emerald-100 bg-white hover:bg-emerald-50/60'
                    }`}
                    onClick={() => {
                      if (!isActive) onSelectSession(session.id);
                      onClose();
                    }}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{session.title}</div>
                      <div className="text-[11px] text-gray-500">
                        {index === 0 ? '根会话' : session.branchLabel || '分支会话'} · {new Date(session.updatedAt).toLocaleString()}
                      </div>
                    </div>
                    {isActive ? <span className="text-[11px] font-semibold text-emerald-700">当前</span> : null}
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
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-emerald-100 bg-white px-3 py-2 text-left hover:bg-emerald-50/60"
                    onClick={() => {
                      onSelectSession(session.id);
                      onClose();
                    }}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{session.title}</div>
                      <div className="text-[11px] text-gray-500">
                        {session.branchLabel || '分支会话'} · {new Date(session.updatedAt).toLocaleString()}
                      </div>
                    </div>
                    <span className="text-[11px] text-emerald-700">跳转</span>
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
