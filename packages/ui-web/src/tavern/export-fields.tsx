import type { ReactNode } from 'react';
import type { ExportFields } from '@mahoshojo/domain/tavern-card';

export interface TavernExportFieldsProps { fields: ExportFields; disabled?: boolean; onFieldChange: (key: keyof ExportFields, value: string | number | boolean) => void; scenarioTools?: ReactNode }
export interface TavernChunkOptions { overwriteExisting: boolean; includeCcv3: boolean; includeChara: boolean }
export interface TavernExportChunkOptionsProps { options: TavernChunkOptions; disabled?: boolean; onOptionChange: (key: keyof TavernChunkOptions, value: boolean) => void }

export function TavernExportFields({ fields, disabled, onFieldChange, scenarioTools }: TavernExportFieldsProps) { return (<div className="rounded-xl border border-pink-200 bg-white/70 p-4">
                <div className="grid gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-pink-700">name</label>
                    <input
                      className="mt-2 w-full rounded-xl border border-pink-100 bg-white/80 p-3 text-sm text-gray-900"
                      aria-label="name" value={fields.name}
                      onChange={(e) => onFieldChange('name', e.target.value)}
                      disabled={disabled}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-pink-700">tags（逗号或换行分隔）</label>
                    <input
                      className="mt-2 w-full rounded-xl border border-pink-100 bg-white/80 p-3 text-sm text-gray-900"
                      aria-label="tags" value={fields.tags}
                      onChange={(e) => onFieldChange('tags', e.target.value)}
                      disabled={disabled}
                    />
                  </div>
                </div>

                <div className="mt-4">
                  <label className="block text-sm font-semibold text-pink-700">description</label>
                  <textarea
                    className="mt-2 w-full resize-y rounded-xl border border-pink-100 bg-white/80 p-3 text-sm text-gray-900"
                    aria-label="description" value={fields.description}
                    onChange={(e) => onFieldChange('description', e.target.value)}
                    disabled={disabled}
                    rows={6}
                  />
                </div>

                <div className="mt-4">
                  <label className="block text-sm font-semibold text-pink-700">personality</label>
                  <textarea
                    className="mt-2 w-full resize-y rounded-xl border border-pink-100 bg-white/80 p-3 text-sm text-gray-900"
                    aria-label="personality" value={fields.personality}
                    onChange={(e) => onFieldChange('personality', e.target.value)}
                    disabled={disabled}
                    rows={4}
                  />
                </div>

                <div className="mt-4">
                  <label className="block text-sm font-semibold text-pink-700">scenario</label>
                  <textarea
                    className="mt-2 w-full resize-y rounded-xl border border-pink-100 bg-white/80 p-3 text-sm text-gray-900"
                    aria-label="scenario" value={fields.scenario}
                    onChange={(e) => onFieldChange('scenario', e.target.value)}
                    disabled={disabled}
                    rows={3}
                  />

                  {scenarioTools}
                </div>
              </div>); }

export function TavernExportDialogueFields({ fields, disabled, onFieldChange }: TavernExportFieldsProps) { return (<div className="grid gap-4">
                <div>
                  <label className="block text-sm font-semibold text-pink-700">first_mes</label>
                  <textarea
                    className="mt-2 w-full resize-y rounded-xl border border-pink-100 bg-white/80 p-3 text-sm text-gray-900"
                    aria-label="first_mes" value={fields.firstMes}
                    onChange={(e) => onFieldChange('firstMes', e.target.value)}
                    disabled={disabled}
                    rows={4}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-pink-700">mes_example</label>
                  <textarea
                    className="mt-2 w-full resize-y rounded-xl border border-pink-100 bg-white/80 p-3 text-sm text-gray-900"
                    aria-label="mes_example" value={fields.mesExample}
                    onChange={(e) => onFieldChange('mesExample', e.target.value)}
                    disabled={disabled}
                    rows={4}
                  />
                </div>
              </div>); }

export function TavernExportCreatorFields({ fields, disabled, onFieldChange }: TavernExportFieldsProps) { return (<div className="grid gap-4">
                <div>
                  <label className="block text-sm font-semibold text-pink-700">creator</label>
                  <input
                    className="mt-2 w-full rounded-xl border border-pink-100 bg-white/80 p-3 text-sm text-gray-900"
                    aria-label="creator" value={fields.creator}
                    onChange={(e) => onFieldChange('creator', e.target.value)}
                    disabled={disabled}
                  />
                  <div className="mt-1 text-xs text-gray-600">建议保留自动拼接的来源信息，可按需调整。</div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-pink-700">creator_notes</label>
                  <textarea
                    className="mt-2 w-full resize-y rounded-xl border border-pink-100 bg-white/80 p-3 text-sm text-gray-900"
                    aria-label="creator_notes" value={fields.creatorNotes}
                    onChange={(e) => onFieldChange('creatorNotes', e.target.value)}
                    disabled={disabled}
                    rows={3}
                  />
                </div>
                <div className="grid gap-3">
                  <div>
                    <label className="block text-sm font-semibold text-pink-700">talkativeness（0~1）</label>
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      max="1"
                      className="mt-2 w-full rounded-xl border border-pink-100 bg-white/80 p-3 text-sm text-gray-900"
                      aria-label="talkativeness" value={String(fields.talkativeness)}
                      onChange={(e) => onFieldChange('talkativeness', Number(e.target.value))}
                      disabled={disabled}
                    />
                    <div className="mt-1 text-xs text-gray-600">
                      SillyTavern 常用的“话多程度”参数。参考值：0.3（更简洁）/ 0.5（中性，默认）/ 0.8（更健谈）。不确定就保持 0.5。
                    </div>
                  </div>
                  <label className="flex items-start gap-2 rounded-xl border border-pink-100 bg-white/70 p-3">
                    <input
                      type="checkbox"
                      checked={fields.fav}
                      onChange={(e) => onFieldChange('fav', e.target.checked)}
                      disabled={disabled}
                      className="mt-1"
                    />
                    <div className="min-w-0">
                      <div className="text-sm text-gray-900">fav（收藏标记）</div>
                      <div className="mt-1 text-xs text-gray-600">通常仅影响 SillyTavern 侧的排序/显示，不影响角色设定；默认不勾选。</div>
                    </div>
                  </label>
                </div>
              </div>); }

export function TavernExportAdvancedFields({ fields, disabled, onFieldChange }: TavernExportFieldsProps) { return (<details className="rounded-xl border border-pink-100 bg-white/60 p-3">
                <summary className="cursor-pointer text-sm font-semibold text-pink-700">高级字段（谨慎写入）</summary>
                <div className="mt-3">
                  <label className="block text-sm font-semibold text-pink-700">system_prompt</label>
                  <textarea
                    className="mt-2 w-full resize-y rounded-xl border border-pink-100 bg-white/80 p-3 text-sm text-gray-900"
                    aria-label="system_prompt" value={fields.systemPrompt}
                    onChange={(e) => onFieldChange('systemPrompt', e.target.value)}
                    disabled={disabled}
                    rows={3}
                  />
                </div>
                <div className="mt-3">
                  <label className="block text-sm font-semibold text-pink-700">post_history_instructions</label>
                  <textarea
                    className="mt-2 w-full resize-y rounded-xl border border-pink-100 bg-white/80 p-3 text-sm text-gray-900"
                    aria-label="post_history_instructions" value={fields.postHistoryInstructions}
                    onChange={(e) => onFieldChange('postHistoryInstructions', e.target.value)}
                    disabled={disabled}
                    rows={3}
                  />
                </div>
                <div className="mt-2 text-xs text-gray-600">
                  注意：这些字段很容易携带隐私信息或提示注入内容。默认推荐保持为空。
                </div>
              </details>); }

export function TavernExportChunkOptions({ options, disabled, onOptionChange }: TavernExportChunkOptionsProps) { return (<div className="rounded-xl border border-pink-200 bg-white/70 p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex items-start gap-2 rounded-xl border border-pink-100 bg-white/70 p-3">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={options.overwriteExisting}
                      onChange={(e) => onOptionChange('overwriteExisting', e.target.checked)}
                      disabled={disabled}
                    />
                    <div className="min-w-0">
                      <div className="text-sm text-gray-900">覆盖已有酒馆块（推荐）</div>
                      <div className="mt-1 text-xs text-gray-600">避免重复块导致导入结果不确定。</div>
                    </div>
                  </label>

                  <div className="grid gap-2">
                    <label className="flex items-center gap-2 rounded-xl border border-pink-100 bg-white/70 p-3">
                      <input
                        type="checkbox"
                        checked={options.includeCcv3}
                        onChange={(e) => onOptionChange('includeCcv3', e.target.checked)}
                        disabled={disabled}
                      />
                      <span className="text-sm text-gray-900">写入 ccv3</span>
                    </label>
                    <label className="flex items-center gap-2 rounded-xl border border-pink-100 bg-white/70 p-3">
                      <input
                        type="checkbox"
                        checked={options.includeChara}
                        onChange={(e) => onOptionChange('includeChara', e.target.checked)}
                        disabled={disabled}
                      />
                      <span className="text-sm text-gray-900">写入 chara（旧版兼容）</span>
                    </label>
                  </div>
                </div>
              </div>); }
