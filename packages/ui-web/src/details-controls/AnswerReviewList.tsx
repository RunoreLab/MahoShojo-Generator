import React, { useState } from 'react';

export type AnswerReviewListVariant = 'light' | 'dark' | 'app';

export interface AnswerReviewListItem {
  key: string;
  /** 0 基题序，渲染为 Q{n+1}。 */
  index: number;
  question: string;
  questionnaireTitle?: string;
  /** 已填答案原文；空串/缺省渲染「尚未填写」。 */
  answer: string;
}

export interface AnswerReviewListProps {
  items: AnswerReviewListItem[];
  /** 「编辑此题」跳转；缺省不渲染按钮。 */
  onEdit?: (index: number) => void;
  variant?: AnswerReviewListVariant;
  title?: string;
  /** 受控折叠（Web 把 UI 折叠态写进草稿）；缺省为非受控内部状态。 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

type ThemeClasses = {
  container: string;
  toggle: string;
  card: string;
  questionIndex: string;
  questionText: string;
  answer: string;
  emptyAnswer: string;
  editButton: string;
};

const THEMES: Record<AnswerReviewListVariant, ThemeClasses> = {
  light: {
    container: 'my-4 bg-blue-50 border border-blue-200 rounded-lg p-3',
    toggle: 'flex w-full items-center justify-between text-left text-sm font-semibold text-blue-700',
    card: 'rounded-lg bg-white/90 p-3 shadow-sm',
    questionIndex: 'text-xs font-semibold text-pink-600',
    questionText: 'mt-1 text-xs text-gray-500',
    answer: 'mt-2 text-gray-800 whitespace-pre-wrap',
    emptyAnswer: 'text-gray-400',
    editButton: 'text-xs text-pink-500 hover:underline',
  },
  dark: {
    container: 'my-4 rounded-lg border border-slate-700 bg-slate-900/60 p-3',
    toggle: 'flex w-full items-center justify-between text-left text-sm font-semibold text-emerald-300',
    card: 'rounded-lg border border-slate-700 bg-slate-950/40 p-3',
    questionIndex: 'text-xs font-semibold text-emerald-400',
    questionText: 'mt-1 text-xs text-slate-400',
    answer: 'mt-2 text-slate-100 whitespace-pre-wrap',
    emptyAnswer: 'text-slate-500',
    editButton: 'text-xs text-emerald-300 hover:underline',
  },
  app: {
    container: 'my-4 rounded-lg border border-(--app-border) bg-(--app-surface) p-3',
    toggle: 'flex w-full items-center justify-between text-left text-sm font-semibold text-(--app-text)',
    card: 'rounded-lg border border-(--app-border) p-3',
    questionIndex: 'text-xs font-semibold text-(--app-text-muted)',
    questionText: 'mt-1 text-xs text-(--app-text-muted)',
    answer: 'mt-2 text-(--app-text) whitespace-pre-wrap',
    emptyAnswer: 'opacity-50',
    editButton: 'text-xs text-(--app-text) underline',
  },
};

/** 「答案概览」共享区段：按题序列出全部回答，可跳回编辑。 */
export function AnswerReviewList({
  items,
  onEdit,
  variant = 'light',
  title = '答案概览',
  open: openProp,
  onOpenChange,
}: AnswerReviewListProps) {
  const classes = THEMES[variant];
  const [innerOpen, setInnerOpen] = useState(false);
  const open = openProp ?? innerOpen;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setInnerOpen(next);
    onOpenChange?.(next);
  };
  return (
    <div className={classes.container}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={classes.toggle}
      >
        <span>{title}</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1 text-sm">
          {items.map((item) => (
            <div key={item.key} className={classes.card}>
              <div className={classes.questionIndex}>Q{item.index + 1}</div>
              <div className={classes.questionText}>
                {item.questionnaireTitle ? `(${item.questionnaireTitle}) ` : ''}{item.question}
              </div>
              <div className={classes.answer}>
                {item.answer.trim().length > 0
                  ? item.answer
                  : <span className={classes.emptyAnswer}>尚未填写</span>}
              </div>
              {onEdit && (
                <div className="mt-2 text-right">
                  <button
                    type="button"
                    onClick={() => onEdit(item.index)}
                    className={classes.editButton}
                  >
                    编辑此题
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
