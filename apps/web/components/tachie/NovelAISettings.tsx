'use client';

import { NovelAISettingsFields as SharedNovelAISettingsFields, type NovelAISettingsFieldsProps } from '@mahoshojo/ui-web/image-generation';
import { NovelAIPromptOptimizer } from './NovelAIPromptOptimizer';

type Props = Omit<NovelAISettingsFieldsProps, 'promptOptimizer'> & {
  textProviderStorageNamespace?: string;
  onOptimizerBusyChange: (value: boolean) => void;
};

/** Web 仅装配有配置读取与网络副作用的优化器。 */
export function NovelAISettingsFields({ textProviderStorageNamespace, onOptimizerBusyChange, ...props }: Props) {
  return <SharedNovelAISettingsFields {...props} promptOptimizer={
    <NovelAIPromptOptimizer prompt={props.prompt} imageModel={props.settings.model}
      sourceStorageNamespace={textProviderStorageNamespace}
      onApply={props.onPromptChange} onBusyChange={onOptimizerBusyChange} disabled={props.disabled} />
  } />;
}
