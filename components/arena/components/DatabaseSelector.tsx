'use client';

import Link from 'next/link';

import { MAX_COMBATANTS } from '../types';

interface DatabaseSelectorProps {
  onOpenCharacterModal: () => void;
  onRandomMatchCharacter: () => void;
  isAuthenticated: boolean;
  isGenerating: boolean;
  isMatching: 'character' | 'scenario' | null;
  combatantCount: number;
  maxCombatants?: number;
  className?: string;
  title?: string | null;
  layout?: 'row' | 'column';
}

export function DatabaseSelector({
  onOpenCharacterModal,
  onRandomMatchCharacter,
  isAuthenticated,
  isGenerating,
  isMatching,
  combatantCount,
  maxCombatants = MAX_COMBATANTS,
  className,
  title = '从数据库选择角色',
  layout = 'row',
}: DatabaseSelectorProps) {
  const rootClassName = ['mb-6', className].filter(Boolean).join(' ');
  const buttonsClassName = layout === 'column' ? 'flex flex-col gap-2' : 'flex gap-2';
  const buttonWidthClassName = layout === 'column' ? 'w-full' : 'flex-1';

  return (
    <div className={rootClassName}>
      {title ? <h3 className="input-label">{title}</h3> : null}
      <div className={buttonsClassName}>
        <button
          onClick={onOpenCharacterModal}
          disabled={isGenerating || combatantCount >= maxCombatants}
          className={`${buttonWidthClassName} px-4 py-2 bg-pink-500 text-white rounded hover:bg-pink-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm`}
        >
          浏览在线角色库
        </button>
        <button
          onClick={onRandomMatchCharacter}
          disabled={isGenerating || isMatching !== null || combatantCount >= maxCombatants}
          className={`${buttonWidthClassName} px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm`}
        >
          {isMatching === 'character' ? '匹配中...' : '随机匹配角色'}
        </button>
      </div>
      {!isAuthenticated && (
        <div className="text-xs text-gray-500 flex items-center px-2 mt-2">
          <Link href="/character-manager" className="text-pink-600 hover:text-pink-800 underline">
            登录后可访问私有数据卡
          </Link>
        </div>
      )}
    </div>
  );
}
