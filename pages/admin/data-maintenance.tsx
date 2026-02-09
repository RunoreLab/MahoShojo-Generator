import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Play, Search, Trash2 } from 'lucide-react';

type CleanupTarget = 'battle_report_generations' | 'arena_rating_events' | 'pvp_rounds' | 'large_objects';
type RiskLevel = 'low' | 'medium' | 'high';

type ScopeState = {
  dateFrom: string;
  dateTo: string;
  statusInText: string;
  queue: '' | 'strict' | 'free';
  kind: string;
  pvpOnly: boolean;
};

type FieldDefinition = {
  field: string;
  label: string;
  defaultValue: string | null;
};

type TargetSchema = {
  target: CleanupTarget;
  label: string;
  fieldDefinitions: FieldDefinition[];
  supportsKind: boolean;
  supportsPvpOnly: boolean;
  queueValues: Array<'strict' | 'free'>;
  statusValues: string[];
};

type ActionDraftField = {
  type: 'field';
  field: string;
  op: 'truncate' | 'set_null_or_default';
  maxChars: number;
  setMode: 'null' | 'empty' | 'default';
};

type ActionDraftDelete = {
  type: 'delete_rows';
  deleteR2: boolean;
};

type ActionDraft = ActionDraftField | ActionDraftDelete;

type PreviewResponse = {
  success: true;
  preview: {
    target: CleanupTarget;
    targetLabel: string;
    planHash: string;
    affectedRows: number;
    estimatedBytesBefore: number;
    estimatedBytesAfter: number;
    estimatedBytesSaved: number;
    riskLevel: RiskLevel;
    warnings: string[];
    dependencyImpact: Record<string, number>;
    samples: Array<{
      id: string | number;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    }>;
  };
} | {
  success: false;
  error?: string;
};

type ExecuteResponse = {
  success: true;
  result: {
    totalMatchedRows: number;
    selectedRows: number;
    truncatedByMaxRows: boolean;
    affectedRows: number;
    cellChanges: number;
    batchCount: number;
    warnings: string[];
    r2Deleted: number;
    r2DeleteFailed: number;
    dependencyImpact: Record<string, number>;
  };
} | {
  success: false;
  error?: string;
};

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
};

const parseStatusIn = (text: string): string[] => {
  return Array.from(
    new Set(
      text
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
};

const defaultScope: ScopeState = {
  dateFrom: '',
  dateTo: '',
  statusInText: '',
  queue: '',
  kind: '',
  pvpOnly: false,
};

const fieldActionToRequest = (action: ActionDraftField) => {
  if (action.op === 'truncate') {
    return {
      type: 'field' as const,
      field: action.field,
      op: action.op,
      truncate: { maxChars: action.maxChars },
    };
  }
  return {
    type: 'field' as const,
    field: action.field,
    op: action.op,
    setMode: action.setMode,
  };
};

export default function AdminDataMaintenancePage() {
  const [schemas, setSchemas] = useState<TargetSchema[]>([]);
  const [loadingSchemas, setLoadingSchemas] = useState(true);
  const [schemaError, setSchemaError] = useState<string | null>(null);

  const [target, setTarget] = useState<CleanupTarget>('battle_report_generations');
  const [scope, setScope] = useState<ScopeState>(defaultScope);
  const [actions, setActions] = useState<ActionDraft[]>([]);

  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Extract<PreviewResponse, { success: true }>['preview'] | null>(null);

  const [executeLoading, setExecuteLoading] = useState(false);
  const [executeError, setExecuteError] = useState<string | null>(null);
  const [executeResult, setExecuteResult] = useState<Extract<ExecuteResponse, { success: true }>['result'] | null>(null);

  const [maxRows, setMaxRows] = useState(5000);
  const [batchSize, setBatchSize] = useState(200);
  const [confirmText, setConfirmText] = useState('');

  const selectedSchema = useMemo(() => schemas.find((item) => item.target === target) ?? null, [schemas, target]);
  const hasDeleteRowsAction = useMemo(() => actions.some((item) => item.type === 'delete_rows'), [actions]);

  const invalidateRunState = () => {
    setPreview(null);
    setPreviewError(null);
    setExecuteResult(null);
    setExecuteError(null);
  };

  const createDefaultActionForTarget = (nextTarget: CleanupTarget, schemaList: TargetSchema[]): ActionDraft[] => {
    const found = schemaList.find((item) => item.target === nextTarget);
    if (!found) return [];
    if (found.fieldDefinitions.length <= 0) {
      return [{ type: 'delete_rows', deleteR2: true }];
    }
    return [
      {
        type: 'field',
        field: found.fieldDefinitions[0]!.field,
        op: 'truncate',
        maxChars: 800,
        setMode: 'null',
      },
    ];
  };

  useEffect(() => {
    void (async () => {
      setLoadingSchemas(true);
      setSchemaError(null);
      try {
        const response = await fetch('/api/admin/data-maintenance/preview');
        const json = await response.json().catch(() => ({})) as {
          success?: boolean;
          schemas?: TargetSchema[];
          error?: string;
        };
        if (!response.ok || json.success !== true || !Array.isArray(json.schemas)) {
          throw new Error(json.error || '无法加载清理目标配置');
        }
        setSchemas(json.schemas);
        if (json.schemas.length > 0) {
          const firstTarget = json.schemas[0]!.target;
          setTarget(firstTarget);
          setActions(createDefaultActionForTarget(firstTarget, json.schemas));
        }
      } catch (error) {
        setSchemaError(error instanceof Error ? error.message : '未知错误');
      } finally {
        setLoadingSchemas(false);
      }
    })();
  }, []);

  const scopePayload = useMemo(() => {
    const payload: Record<string, unknown> = {};
    if (scope.dateFrom) payload.dateFrom = scope.dateFrom;
    if (scope.dateTo) payload.dateTo = scope.dateTo;

    const statuses = parseStatusIn(scope.statusInText);
    if (statuses.length > 0) payload.statusIn = statuses;

    if (scope.queue) payload.queue = scope.queue;
    if (scope.kind.trim()) payload.kind = scope.kind.trim();
    if (selectedSchema?.supportsPvpOnly) payload.pvpOnly = scope.pvpOnly;
    return payload;
  }, [scope, selectedSchema?.supportsPvpOnly]);

  const actionsPayload = useMemo(() => {
    return actions.map((action) => {
      if (action.type === 'delete_rows') {
        return { type: 'delete_rows' as const, deleteR2: action.deleteR2 };
      }
      return fieldActionToRequest(action);
    });
  }, [actions]);

  const doPreview = async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    setExecuteError(null);
    setExecuteResult(null);
    try {
      const response = await fetch('/api/admin/data-maintenance/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target,
          scope: scopePayload,
          actions: actionsPayload,
        }),
      });
      const json = await response.json().catch(() => ({})) as PreviewResponse;
      if (!response.ok || json.success !== true) {
        throw new Error((json as { error?: string }).error || '预览失败');
      }
      setPreview(json.preview);
    } catch (error) {
      setPreview(null);
      setPreviewError(error instanceof Error ? error.message : '未知错误');
    } finally {
      setPreviewLoading(false);
    }
  };

  const doExecute = async () => {
    if (!preview?.planHash) return;
    setExecuteLoading(true);
    setExecuteError(null);
    setExecuteResult(null);
    try {
      const response = await fetch('/api/admin/data-maintenance/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target,
          scope: scopePayload,
          actions: actionsPayload,
          planHash: preview.planHash,
          maxRows,
          batchSize,
          confirmText,
        }),
      });
      const json = await response.json().catch(() => ({})) as ExecuteResponse;
      if (!response.ok || json.success !== true) {
        throw new Error((json as { error?: string }).error || '执行失败');
      }
      setExecuteResult(json.result);
    } catch (error) {
      setExecuteError(error instanceof Error ? error.message : '未知错误');
    } finally {
      setExecuteLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>数据库清理工作台 - Admin</title>
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-violet-50 to-slate-50 p-4 sm:p-6">
        <div className="mx-auto max-w-7xl space-y-4">
          <div className="flex items-center justify-between">
            <Link href="/admin" className="text-sm text-purple-600 hover:underline">
              ← 返回管理后台主页
            </Link>
          </div>

          <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
            <h1 className="text-2xl font-bold text-gray-800">数据库清理工作台（MVP）</h1>
            <p className="mt-2 text-sm text-gray-500">
              支持字段级清理（截断/设空）与整行删除。请先预览，再执行。
            </p>
          </div>

          <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
            <div className="mb-3 text-sm font-semibold text-gray-800">1) 清理范围</div>
            {loadingSchemas ? (
              <div className="text-sm text-gray-500">加载目标配置中...</div>
            ) : schemaError ? (
              <div className="text-sm text-red-600">{schemaError}</div>
            ) : (
              <div className="grid gap-3 md:grid-cols-3">
                <label className="text-sm">
                  <span className="mb-1 block text-gray-600">目标</span>
                  <select
                    className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                    value={target}
                    onChange={(e) => {
                      const nextTarget = e.target.value as CleanupTarget;
                      setTarget(nextTarget);
                      setActions(createDefaultActionForTarget(nextTarget, schemas));
                      setScope(defaultScope);
                      setConfirmText('');
                      invalidateRunState();
                    }}
                  >
                    {schemas.map((item) => (
                      <option key={item.target} value={item.target}>
                        {item.label}（{item.target}）
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-sm">
                  <span className="mb-1 block text-gray-600">起始日期（可选）</span>
                  <input
                    type="date"
                    className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                    value={scope.dateFrom}
                    onChange={(e) => {
                      setScope((prev) => ({ ...prev, dateFrom: e.target.value }));
                      invalidateRunState();
                    }}
                  />
                </label>

                <label className="text-sm">
                  <span className="mb-1 block text-gray-600">截止日期（可选）</span>
                  <input
                    type="date"
                    className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                    value={scope.dateTo}
                    onChange={(e) => {
                      setScope((prev) => ({ ...prev, dateTo: e.target.value }));
                      invalidateRunState();
                    }}
                  />
                </label>

                {selectedSchema?.statusValues?.length ? (
                  <label className="text-sm md:col-span-2">
                    <span className="mb-1 block text-gray-600">状态过滤（逗号分隔）</span>
                    <input
                      className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                      placeholder={`可选：${selectedSchema.statusValues.join(', ')}`}
                      value={scope.statusInText}
                      onChange={(e) => {
                        setScope((prev) => ({ ...prev, statusInText: e.target.value }));
                        invalidateRunState();
                      }}
                    />
                  </label>
                ) : null}

                {selectedSchema?.queueValues?.length ? (
                  <label className="text-sm">
                    <span className="mb-1 block text-gray-600">队列</span>
                    <select
                      className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                      value={scope.queue}
                      onChange={(e) => {
                        setScope((prev) => ({ ...prev, queue: e.target.value as ScopeState['queue'] }));
                        invalidateRunState();
                      }}
                    >
                      <option value="">全部</option>
                      {selectedSchema.queueValues.map((queue) => (
                        <option key={queue} value={queue}>
                          {queue}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {selectedSchema?.supportsKind ? (
                  <label className="text-sm">
                    <span className="mb-1 block text-gray-600">kind 过滤</span>
                    <input
                      className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                      placeholder="例如 battle_report_generation_output"
                      value={scope.kind}
                      onChange={(e) => {
                        setScope((prev) => ({ ...prev, kind: e.target.value }));
                        invalidateRunState();
                      }}
                    />
                  </label>
                ) : null}

                {selectedSchema?.supportsPvpOnly ? (
                  <label className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={scope.pvpOnly}
                      onChange={(e) => {
                        setScope((prev) => ({ ...prev, pvpOnly: e.target.checked }));
                        invalidateRunState();
                      }}
                    />
                    仅 PVP 战报
                  </label>
                ) : null}
              </div>
            )}
          </div>

          <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-800">2) 清理动作</div>
              <button
                className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => {
                  if (!selectedSchema) return;
                  if (selectedSchema.fieldDefinitions.length > 0) {
                    setActions((prev) => [
                      ...prev,
                      {
                        type: 'field',
                        field: selectedSchema.fieldDefinitions[0]!.field,
                        op: 'truncate',
                        maxChars: 800,
                        setMode: 'null',
                      },
                    ]);
                  } else {
                    setActions((prev) => [...prev, { type: 'delete_rows', deleteR2: true }]);
                  }
                  invalidateRunState();
                }}
                disabled={!selectedSchema}
              >
                + 添加动作
              </button>
            </div>

            <div className="space-y-3">
              {actions.map((action, index) => (
                <div key={index} className="rounded-lg border border-gray-200 p-3">
                  <div className="grid gap-3 md:grid-cols-5">
                    <label className="text-sm">
                      <span className="mb-1 block text-gray-600">动作类型</span>
                      <select
                        className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                        value={action.type}
                        onChange={(e) => {
                          const nextType = e.target.value as ActionDraft['type'];
                          setActions((prev) => {
                            const next = [...prev];
                            if (nextType === 'delete_rows') {
                              next[index] = { type: 'delete_rows', deleteR2: true };
                            } else {
                              const field = selectedSchema?.fieldDefinitions[0]?.field ?? 'output_preview';
                              next[index] = {
                                type: 'field',
                                field,
                                op: 'truncate',
                                maxChars: 800,
                                setMode: 'null',
                              };
                            }
                            return next;
                          });
                          invalidateRunState();
                        }}
                      >
                        <option value="field">字段操作</option>
                        <option value="delete_rows">整行删除</option>
                      </select>
                    </label>

                    {action.type === 'field' ? (
                      <>
                        <label className="text-sm">
                          <span className="mb-1 block text-gray-600">字段</span>
                          <select
                            className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                            value={action.field}
                            onChange={(e) => {
                              setActions((prev) => {
                                const next = [...prev];
                                if (next[index]?.type !== 'field') return next;
                                next[index] = { ...(next[index] as ActionDraftField), field: e.target.value };
                                return next;
                              });
                              invalidateRunState();
                            }}
                          >
                            {(selectedSchema?.fieldDefinitions ?? []).map((item) => (
                              <option key={item.field} value={item.field}>
                                {item.label}（{item.field}）
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="text-sm">
                          <span className="mb-1 block text-gray-600">操作</span>
                          <select
                            className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                            value={action.op}
                            onChange={(e) => {
                              const nextOp = e.target.value as ActionDraftField['op'];
                              setActions((prev) => {
                                const next = [...prev];
                                if (next[index]?.type !== 'field') return next;
                                next[index] = { ...(next[index] as ActionDraftField), op: nextOp };
                                return next;
                              });
                              invalidateRunState();
                            }}
                          >
                            <option value="truncate">截断压缩</option>
                            <option value="set_null_or_default">设空/默认</option>
                          </select>
                        </label>

                        {action.op === 'truncate' ? (
                          <label className="text-sm">
                            <span className="mb-1 block text-gray-600">截断长度</span>
                            <input
                              type="number"
                              min={1}
                              max={200000}
                              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                              value={action.maxChars}
                              onChange={(e) => {
                                const nextValue = Math.max(1, Math.min(200000, Number(e.target.value || 1)));
                                setActions((prev) => {
                                  const next = [...prev];
                                  if (next[index]?.type !== 'field') return next;
                                  next[index] = { ...(next[index] as ActionDraftField), maxChars: nextValue };
                                  return next;
                                });
                                invalidateRunState();
                              }}
                            />
                          </label>
                        ) : (
                          <label className="text-sm">
                            <span className="mb-1 block text-gray-600">设值模式</span>
                            <select
                              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                              value={action.setMode}
                              onChange={(e) => {
                                const nextMode = e.target.value as ActionDraftField['setMode'];
                                setActions((prev) => {
                                  const next = [...prev];
                                  if (next[index]?.type !== 'field') return next;
                                  next[index] = { ...(next[index] as ActionDraftField), setMode: nextMode };
                                  return next;
                                });
                                invalidateRunState();
                              }}
                            >
                              <option value="null">设为 NULL</option>
                              <option value="empty">设为空字符串</option>
                              <option value="default">设为默认值</option>
                            </select>
                          </label>
                        )}
                      </>
                    ) : (
                      <label className="text-sm md:col-span-3 flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">
                        <input
                          type="checkbox"
                          checked={action.deleteR2}
                          onChange={(e) => {
                            setActions((prev) => {
                              const next = [...prev];
                              if (next[index]?.type !== 'delete_rows') return next;
                              next[index] = { type: 'delete_rows', deleteR2: e.target.checked };
                              return next;
                            });
                            invalidateRunState();
                          }}
                          disabled={target !== 'large_objects'}
                        />
                        {target === 'large_objects' ? '删除索引时联动删除 R2 对象' : '将删除命中范围内的整行记录'}
                      </label>
                    )}

                    <button
                      className="inline-flex items-center justify-center rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      onClick={() => {
                        setActions((prev) => prev.filter((_, i) => i !== index));
                        invalidateRunState();
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button
                className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                onClick={() => void doPreview()}
                disabled={previewLoading || actions.length <= 0}
              >
                <Search className="h-4 w-4" />
                {previewLoading ? '预览中...' : '预览影响'}
              </button>
              {previewError ? <span className="text-sm text-red-600">{previewError}</span> : null}
            </div>
          </div>

          {preview ? (
            <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
              <div className="mb-3 text-sm font-semibold text-gray-800">3) 预览结果</div>
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-md border border-gray-200 p-3">
                  <div className="text-xs text-gray-500">命中行数</div>
                  <div className="mt-1 text-xl font-semibold text-gray-800">{preview.affectedRows}</div>
                </div>
                <div className="rounded-md border border-gray-200 p-3">
                  <div className="text-xs text-gray-500">预计节省</div>
                  <div className="mt-1 text-xl font-semibold text-gray-800">{formatBytes(preview.estimatedBytesSaved)}</div>
                </div>
                <div className="rounded-md border border-gray-200 p-3">
                  <div className="text-xs text-gray-500">风险等级</div>
                  <div className={`mt-1 text-xl font-semibold ${preview.riskLevel === 'high' ? 'text-red-600' : preview.riskLevel === 'medium' ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {preview.riskLevel}
                  </div>
                </div>
                <div className="rounded-md border border-gray-200 p-3">
                  <div className="text-xs text-gray-500">planHash</div>
                  <div className="mt-1 break-all text-xs text-gray-700">{preview.planHash}</div>
                </div>
              </div>

              {preview.warnings?.length ? (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                  {preview.warnings.map((warning, idx) => (
                    <div key={idx}>- {warning}</div>
                  ))}
                </div>
              ) : null}

              {Object.keys(preview.dependencyImpact || {}).length > 0 ? (
                <div className="mt-3 rounded-md border border-gray-200 p-3 text-sm text-gray-700">
                  <div className="mb-1 font-medium text-gray-800">关联影响</div>
                  {Object.entries(preview.dependencyImpact).map(([key, value]) => (
                    <div key={key}>- {key}: {value}</div>
                  ))}
                </div>
              ) : null}

              {preview.samples?.length ? (
                <div className="mt-3 space-y-2">
                  <div className="text-sm font-medium text-gray-800">样本对比（最多 8 条）</div>
                  {preview.samples.map((sample) => (
                    <details key={String(sample.id)} className="rounded-md border border-gray-200 p-3">
                      <summary className="cursor-pointer text-sm text-gray-700">ID: {String(sample.id)}</summary>
                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        <pre className="overflow-x-auto rounded bg-gray-50 p-2 text-xs">{JSON.stringify(sample.before, null, 2)}</pre>
                        <pre className="overflow-x-auto rounded bg-gray-50 p-2 text-xs">{JSON.stringify(sample.after, null, 2)}</pre>
                      </div>
                    </details>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
            <div className="mb-3 text-sm font-semibold text-gray-800">4) 执行</div>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-sm">
                <span className="mb-1 block text-gray-600">maxRows（本次最多处理行数）</span>
                <input
                  type="number"
                  min={1}
                  max={100000}
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                  value={maxRows}
                  onChange={(e) => setMaxRows(Math.max(1, Math.min(100000, Number(e.target.value || 1))))}
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-gray-600">batchSize</span>
                <input
                  type="number"
                  min={1}
                  max={5000}
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                  value={batchSize}
                  onChange={(e) => setBatchSize(Math.max(1, Math.min(5000, Number(e.target.value || 1))))}
                />
              </label>
              {hasDeleteRowsAction ? (
                <label className="text-sm">
                  <span className="mb-1 block text-gray-600">删除确认口令</span>
                  <input
                    className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={`DELETE ${target}`}
                  />
                </label>
              ) : null}
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button
                className="inline-flex items-center gap-2 rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
                onClick={() => void doExecute()}
                disabled={!preview || executeLoading}
              >
                <Play className="h-4 w-4" />
                {executeLoading ? '执行中...' : '执行清理'}
              </button>
              {!preview ? <span className="text-sm text-gray-500">请先完成预览。</span> : null}
              {executeError ? <span className="text-sm text-red-600">{executeError}</span> : null}
            </div>

            {executeResult ? (
              <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                <div>- 命中总数：{executeResult.totalMatchedRows}</div>
                <div>- 本次处理：{executeResult.selectedRows}</div>
                <div>- 受影响行：{executeResult.affectedRows}</div>
                <div>- 字段变更次数：{executeResult.cellChanges}</div>
                <div>- 批次数：{executeResult.batchCount}</div>
                {executeResult.r2Deleted > 0 || executeResult.r2DeleteFailed > 0 ? (
                  <div>- R2 删除：成功 {executeResult.r2Deleted}，失败 {executeResult.r2DeleteFailed}</div>
                ) : null}
                {executeResult.warnings?.map((warning, index) => (
                  <div key={index}>- 提示：{warning}</div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
