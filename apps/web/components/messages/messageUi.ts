import type { MessagePriority, MessageScope } from '@/lib/messages/types';

export function getMessageScopeLabel(scope: MessageScope): string {
  return scope === 'site' ? '全站通知' : '定向通知';
}

export function getMessagePriorityClassName(priority: MessagePriority): string {
  if (priority === 'high') {
    return 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-200';
  }
  if (priority === 'low') {
    return 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300';
  }
  return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-950/40 dark:text-sky-200';
}

export function getMessagePriorityLabel(priority: MessagePriority): string {
  if (priority === 'high') {
    return '高优先级';
  }
  if (priority === 'low') {
    return '低优先级';
  }
  return '普通优先级';
}

export function formatMessageTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
