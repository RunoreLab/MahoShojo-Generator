import React from 'react';

import { type QuestionnaireOption } from '@/lib/questionnaires';

export type QuestionnaireTheme = {
  card: string;
  progressText: string;
  progressTrack: string;
  progressBar: string;
  questionText: string;
  sourceText: string;
  noticeText: string;
  helperText: string;
  skipText: string;
  quickOptionButton: string;
  optionsCard: string;
  optionsHintText: string;
  optionButton: string;
  optionButtonDisabled: string;
  suggestionCard: string;
  suggestionHintText: string;
  suggestionButton: string;
  inputCounterText: string;
  limitLabelText: string;
  overLimitText: string;
  noTextInputHint: string;
};

export const DETAILS_QUESTIONNAIRE_THEME: QuestionnaireTheme = {
  card: 'rounded-2xl border border-pink-100 bg-white/90 p-4 shadow-sm',
  progressText: 'text-sm text-gray-600',
  progressTrack: 'bg-pink-100',
  progressBar: 'bg-pink-400',
  questionText: 'text-xl font-semibold leading-relaxed text-center text-pink-700 transition-all duration-300 ease-out',
  sourceText: 'text-center text-xs text-gray-400',
  noticeText: 'text-xs text-center text-gray-500 mt-2',
  helperText: 'mt-2 text-sm text-gray-600 text-center',
  skipText: 'mt-2 text-xs text-pink-500 text-center',
  quickOptionButton: 'rounded-full border border-pink-200 bg-white px-4 py-1.5 font-medium text-pink-600 transition-colors hover:border-pink-400 hover:bg-pink-50',
  optionsCard: 'rounded-2xl border border-pink-100 bg-white p-4 shadow-sm',
  optionsHintText: 'text-xs text-gray-500 mb-2',
  optionButton: 'rounded-lg border px-3 py-2 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-pink-300 border-pink-200 bg-white text-gray-700 hover:border-pink-400 hover:bg-pink-50',
  optionButtonDisabled: 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed',
  suggestionCard: 'rounded-2xl border border-pink-100 bg-white/80 p-3 shadow-sm',
  suggestionHintText: 'text-xs text-gray-500 mb-2',
  suggestionButton: 'rounded-full border border-pink-200 bg-white px-3 py-1.5 text-xs text-pink-600 transition-colors hover:border-pink-400 hover:bg-pink-50',
  inputCounterText: 'text-xs text-gray-500',
  limitLabelText: 'text-[11px] text-gray-400',
  overLimitText: 'mt-1 text-right text-xs text-amber-600',
  noTextInputHint: 'mt-3 text-center text-xs text-gray-500',
};

export const CANSHOU_QUESTIONNAIRE_THEME: QuestionnaireTheme = {
  card: 'rounded-2xl border border-slate-700 bg-slate-900/80 p-4 shadow-sm',
  progressText: 'text-sm text-slate-200',
  progressTrack: 'bg-slate-800',
  progressBar: 'bg-emerald-400',
  questionText: 'text-xl font-semibold text-center text-slate-100',
  sourceText: 'text-center text-xs text-slate-500',
  noticeText: 'text-xs text-center text-slate-400 mt-2',
  helperText: 'mt-2 text-sm text-slate-300 text-center',
  skipText: 'mt-2 text-xs text-emerald-300 text-center',
  quickOptionButton: 'rounded-full border border-slate-600 bg-slate-900 px-4 py-1.5 font-medium text-emerald-300 transition-colors hover:border-emerald-400 hover:text-emerald-200',
  optionsCard: 'rounded-2xl border border-slate-700 bg-slate-900/70 p-4 shadow-sm',
  optionsHintText: 'text-xs text-slate-400 mb-3',
  optionButton: 'rounded-lg border text-sm px-3 py-2 transition-colors text-left border-slate-600 bg-slate-800 text-slate-100 hover:border-emerald-400 hover:text-emerald-200',
  optionButtonDisabled: 'border-slate-700 bg-slate-800 text-slate-500 cursor-not-allowed',
  suggestionCard: 'rounded-2xl border border-slate-700 bg-slate-900/60 p-3 shadow-sm',
  suggestionHintText: 'text-xs text-slate-400 mb-2',
  suggestionButton: 'rounded-full border border-slate-600 bg-slate-900 px-3 py-1.5 text-xs text-emerald-200 transition-colors hover:border-emerald-400 hover:text-emerald-100',
  inputCounterText: 'text-xs text-gray-500',
  limitLabelText: 'text-[11px] text-gray-400',
  overLimitText: 'mt-1 text-right text-xs text-amber-300',
  noTextInputHint: 'mt-3 text-center text-xs text-slate-500',
};

type QuestionnaireQuestionPanelProps = {
  theme: QuestionnaireTheme;
  progressLabel: string;
  progressPercent: number;
  progressExtra?: React.ReactNode;
  questionText: string;
  questionnaireTitle?: string;
  noticeText: string;
  helperText?: string;
  isRequired: boolean;
  skipText: string;
  quickOptions?: string[];
  quickOptionDisabled?: boolean;
  onQuickOption?: (value: string) => void;
  options?: QuestionnaireOption[];
  optionsHintText: string;
  onOptionSelect?: (value: string) => void;
  suggestions?: string[];
  onSuggestionSelect?: (value: string) => void;
  showTextInput: boolean;
  answer: string;
  onAnswerChange?: (value: string) => void;
  placeholder?: string;
  answerLength: number;
  maxLength?: number | null;
  limitLabel?: string;
  showLimitLabel?: boolean;
  isOverLimit?: boolean;
  overLimitText?: string;
  noTextInputHint?: string;
  isTransitioning?: boolean;
  transitionClassName?: string;
  transitionStyle?: React.CSSProperties;
  prevLabel: string;
  nextButtonContent: React.ReactNode;
  onPrev: () => void;
  onNext: () => void;
  disablePrev?: boolean;
  disableNext?: boolean;
  prevButtonClass?: string;
  nextButtonClass?: string;
};

export function QuestionnaireQuestionPanel({
  theme,
  progressLabel,
  progressPercent,
  progressExtra,
  questionText,
  questionnaireTitle,
  noticeText,
  helperText,
  isRequired,
  skipText,
  quickOptions,
  quickOptionDisabled,
  onQuickOption,
  options,
  optionsHintText,
  onOptionSelect,
  suggestions,
  onSuggestionSelect,
  showTextInput,
  answer,
  onAnswerChange,
  placeholder,
  answerLength,
  maxLength,
  limitLabel,
  showLimitLabel,
  isOverLimit,
  overLimitText,
  noTextInputHint,
  isTransitioning,
  transitionClassName = 'transition-opacity duration-200',
  transitionStyle,
  prevLabel,
  nextButtonContent,
  onPrev,
  onNext,
  disablePrev,
  disableNext,
  prevButtonClass = 'generate-button',
  nextButtonClass = 'generate-button',
}: QuestionnaireQuestionPanelProps) {
  const safeQuestion = questionText?.trim() ? questionText : '未加载题目';
  const quickOptionList = (quickOptions ?? []).filter(Boolean);
  const suggestionList = (suggestions ?? []).filter(Boolean);
  const hasOptions = (options?.length ?? 0) > 0;

  return (
    <>
      <div className="mt-4 space-y-4">
        <div className={theme.card}>
          <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 ${theme.progressText}`}>
            <span>{progressLabel}</span>
            <span>进度 {progressPercent}%</span>
            {progressExtra}
          </div>
          <div className={`mt-2 h-2 w-full overflow-hidden rounded-full ${theme.progressTrack}`}>
            <div
              className={`h-full rounded-full transition-all duration-300 ease-out ${theme.progressBar}`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div
            className={`mt-4 min-h-[60px] flex items-center justify-center ${transitionClassName} ${isTransitioning ? 'opacity-0' : 'opacity-100'}`}
            style={transitionStyle}
          >
            <h3 className={theme.questionText}>{safeQuestion}</h3>
          </div>
          {questionnaireTitle ? (
            <p className={theme.sourceText}>问卷来源：{questionnaireTitle}</p>
          ) : null}
          {noticeText ? <p className={theme.noticeText}>{noticeText}</p> : null}
          {helperText ? <p className={theme.helperText}>{helperText}</p> : null}
          {!isRequired && <p className={theme.skipText}>{skipText}</p>}
          {quickOptionList.length > 0 && (
            <div className="mt-3 flex flex-wrap justify-center gap-3 text-xs">
              {quickOptionList.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onQuickOption?.(option)}
                  disabled={quickOptionDisabled}
                  className={theme.quickOptionButton}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
        </div>

        {hasOptions && (
          <div className={theme.optionsCard}>
            <p className={theme.optionsHintText}>{optionsHintText}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {options?.map((option, index) => {
                const value = typeof option === 'string' ? option : option.value;
                const label = typeof option === 'string' ? option : option.label;
                const disabled = typeof option !== 'string' && option.disabled;
                return (
                  <button
                    type="button"
                    key={`${value}-${index}`}
                    onClick={() => !disabled && onOptionSelect?.(value)}
                    disabled={disabled}
                    className={disabled ? theme.optionButtonDisabled : theme.optionButton}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {suggestionList.length > 0 && (
          <div className={theme.suggestionCard}>
            <p className={theme.suggestionHintText}>灵感提示（点击将内容填入文本框，可再编辑）</p>
            <div className="flex flex-wrap gap-2">
              {suggestionList.map((suggestion) => (
                <button
                  type="button"
                  key={suggestion}
                  onClick={() => onSuggestionSelect?.(suggestion)}
                  className={theme.suggestionButton}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {showTextInput && (
        <div className="input-group mt-4">
          <textarea
            value={answer}
            onChange={(e) => onAnswerChange?.(e.target.value)}
            placeholder={placeholder}
            className="input-field min-h-[6rem] resize-y"
          />
          <div className={`mt-1 flex items-center justify-between ${theme.inputCounterText}`}>
            <span>有效字数：{answerLength}/{maxLength ?? '不限'}</span>
            {showLimitLabel && limitLabel ? (
              <span className={theme.limitLabelText}>{limitLabel}</span>
            ) : null}
          </div>
          {isOverLimit && overLimitText ? (
            <div className={theme.overLimitText}>{overLimitText}</div>
          ) : null}
        </div>
      )}
      {!showTextInput && (
        <div className={noTextInputHint ?? theme.noTextInputHint}>本题仅可从选项中选择，无需填写文本。</div>
      )}

      <div className="mt-4 flex flex-col sm:flex-row gap-2">
        <button className={prevButtonClass} onClick={onPrev} disabled={disablePrev}>
          {prevLabel}
        </button>
        <button onClick={onNext} disabled={disableNext} className={nextButtonClass}>
          {nextButtonContent}
        </button>
      </div>
    </>
  );
}
