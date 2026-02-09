import Head from 'next/head';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { History, Play, RefreshCw, Search, Trash2 } from 'lucide-react';

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
  jobId: string | null;
  precheckWarnings?: string[];
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

type JobListRow = {
  id: string;
  target: CleanupTarget;
  status: 'running' | 'completed' | 'failed';
  riskLevel: RiskLevel | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  totalMatchedRows: number;
  selectedRows: number;
  affectedRows: number;
  cellChanges: number;
  r2Deleted: number;
  r2DeleteFailed: number;
  warningCount: number;
  errorText: string | null;
};

type JobDetail = JobListRow & {
  planHash: string;
  scope: Record<string, unknown>;
  actions: unknown[];
  preview: Record<string, unknown> | null;
  warnings: string[];
  logs: Array<{
    id: number;
    batchNo: number;
    affectedRows: number;
    cellChanges: number;
    note: string | null;
    createdAt: string;
  }>;
};

type JobDetailResponse =
  | { success: true; detail: JobDetail }
  | { success: false; error?: string };

type JobStatusFilter = 'all' | 'running' | 'completed' | 'failed';

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

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const toPositiveInt = (value: unknown, fallback: number): number => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
};

const defaultScope: ScopeState = {
  dateFrom: '',
  dateTo: '',
  statusInText: '',
  queue: '',
  kind: '',
  pvpOnly: false,
};

type PresetApplyValue = {
  target: CleanupTarget;
  scope: ScopeState;
  actions: ActionDraft[];
  maxRows: number;
  batchSize: number;
};

type CleanupPreset = {
  id: string;
  label: string;
  description: string;
  build: () => PresetApplyValue;
};

const dateDaysAgo = (days: number): string => {
  const now = new Date();
  const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const cleanupPresets: CleanupPreset[] = [
  {
    id: 'battle_report_slim_90d',
    label: '战报 90 天瘦身',
    description: '清理老战报大文本字段，优先释放 D1 空间。',
    build: () => ({
      target: 'battle_report_generations',
      scope: {
        ...defaultScope,
        dateTo: dateDaysAgo(90),
        statusInText: 'completed,aborted,failed',
        pvpOnly: false,
      },
      actions: [
        { type: 'field', field: 'output_preview', op: 'set_null_or_default', maxChars: 800, setMode: 'null' },
        { type: 'field', field: 'extra_json', op: 'truncate', maxChars: 1000, setMode: 'null' },
        { type: 'field', field: 'user_guidance_preview', op: 'truncate', maxChars: 400, setMode: 'null' },
        { type: 'field', field: 'adjudication_events_preview', op: 'truncate', maxChars: 400, setMode: 'null' },
      ],
      maxRows: 10000,
      batchSize: 300,
    }),
  },
  {
    id: 'arena_events_slim_120d',
    label: '排位事件 120 天瘦身',
    description: '保留行结构，仅清空详情 JSON。',
    build: () => ({
      target: 'arena_rating_events',
      scope: {
        ...defaultScope,
        dateTo: dateDaysAgo(120),
        statusInText: 'applied,skipped,failed',
      },
      actions: [
        { type: 'field', field: 'details_json', op: 'set_null_or_default', maxChars: 800, setMode: 'null' },
      ],
      maxRows: 50000,
      batchSize: 500,
    }),
  },
  {
    id: 'pvp_rounds_slim_180d',
    label: 'PVP 回合 180 天瘦身',
    description: '清理历史回合快照和结果大字段。',
    build: () => ({
      target: 'pvp_rounds',
      scope: {
        ...defaultScope,
        dateTo: dateDaysAgo(180),
        statusInText: 'completed,aborted',
      },
      actions: [
        { type: 'field', field: 'public_snapshot_json', op: 'set_null_or_default', maxChars: 800, setMode: 'null' },
        { type: 'field', field: 'result_json', op: 'truncate', maxChars: 1600, setMode: 'null' },
      ],
      maxRows: 10000,
      batchSize: 300,
    }),
  },
  {
    id: 'large_objects_delete_180d',
    label: '大对象 180 天删除',
    description: '删除 `battle_report_generation_output` 索引并联动删除 R2。',
    build: () => ({
      target: 'large_objects',
      scope: {
        ...defaultScope,
        dateTo: dateDaysAgo(180),
        kind: 'battle_report_generation_output',
      },
      actions: [{ type: 'delete_rows', deleteR2: true }],
      maxRows: 3000,
      batchSize: 200,
    }),
  },
];

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

const buildScopePayload = (
  rawScope: ScopeState,
  targetSchema: TargetSchema | null,
): Record<string, unknown> => {
  const payload: Record<string, unknown> = {};
  if (rawScope.dateFrom) payload.dateFrom = rawScope.dateFrom;
  if (rawScope.dateTo) payload.dateTo = rawScope.dateTo;

  const statuses = parseStatusIn(rawScope.statusInText);
  if (statuses.length > 0) payload.statusIn = statuses;

  if (rawScope.queue) payload.queue = rawScope.queue;
  if (rawScope.kind.trim()) payload.kind = rawScope.kind.trim();
  if (targetSchema?.supportsPvpOnly) payload.pvpOnly = rawScope.pvpOnly;
  return payload;
};

const buildActionsPayload = (actionList: ActionDraft[]) => {
  return actionList.map((action) => {
    if (action.type === 'delete_rows') {
      return { type: 'delete_rows' as const, deleteR2: action.deleteR2 };
    }
    return fieldActionToRequest(action);
  });
};

const normalizeScopeForCompare = (rawScope: ScopeState): ScopeState => {
  return {
    dateFrom: rawScope.dateFrom.trim(),
    dateTo: rawScope.dateTo.trim(),
    statusInText: parseStatusIn(rawScope.statusInText).sort().join(','),
    queue: rawScope.queue,
    kind: rawScope.kind.trim(),
    pvpOnly: rawScope.pvpOnly,
  };
};

const actionToSignature = (action: ActionDraft): string => {
  if (action.type === 'delete_rows') {
    return `delete_rows(deleteR2=${action.deleteR2 ? 'true' : 'false'})`;
  }
  if (action.op === 'truncate') {
    return `${action.field}:truncate:${Math.max(1, Math.floor(action.maxChars || 1))}`;
  }
  return `${action.field}:set_null_or_default:${action.setMode}`;
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
  const [executePrecheckWarnings, setExecutePrecheckWarnings] = useState<string[]>([]);
  const [lastJobId, setLastJobId] = useState<string | null>(null);

  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobListRow[]>([]);
  const [jobStatusFilter, setJobStatusFilter] = useState<JobStatusFilter>('all');
  const [jobDetailLoading, setJobDetailLoading] = useState(false);
  const [jobDetailError, setJobDetailError] = useState<string | null>(null);
  const [selectedJobDetail, setSelectedJobDetail] = useState<JobDetail | null>(null);

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
    setExecutePrecheckWarnings([]);
  };

  const createDefaultActionForTarget = useCallback((nextTarget: CleanupTarget, schemaList: TargetSchema[]): ActionDraft[] => {
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
  }, []);

  const normalizeScopeFromDetail = useCallback((
    rawScope: Record<string, unknown>,
    targetSchema: TargetSchema | null,
  ): ScopeState => {
    const statusList = Array.isArray(rawScope.statusIn)
      ? rawScope.statusIn
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      : [];
    const queueRaw = typeof rawScope.queue === 'string' ? rawScope.queue.trim() : '';
    const queueAllowed = targetSchema?.queueValues ?? [];
    const queue =
      (queueRaw === 'strict' || queueRaw === 'free') && queueAllowed.includes(queueRaw)
        ? queueRaw
        : '';
    return {
      dateFrom: typeof rawScope.dateFrom === 'string' ? rawScope.dateFrom.trim() : '',
      dateTo: typeof rawScope.dateTo === 'string' ? rawScope.dateTo.trim() : '',
      statusInText: statusList.join(','),
      queue,
      kind: typeof rawScope.kind === 'string' ? rawScope.kind.trim() : '',
      pvpOnly: rawScope.pvpOnly === true,
    };
  }, []);

  const normalizeActionsFromDetail = useCallback((
    rawActions: unknown[],
    targetSchema: TargetSchema | null,
    targetValue: CleanupTarget,
    options?: {
      fallbackToDefault?: boolean;
    },
  ): ActionDraft[] => {
    const fieldSet = new Set((targetSchema?.fieldDefinitions ?? []).map((item) => item.field));
    const nextActions: ActionDraft[] = [];
    for (const rawAction of rawActions) {
      const action = toRecord(rawAction);
      if (!action) continue;
      if (action.type === 'delete_rows') {
        nextActions.push({
          type: 'delete_rows',
          deleteR2: action.deleteR2 === true,
        });
        continue;
      }
      if (action.type !== 'field') continue;
      const field = typeof action.field === 'string' ? action.field.trim() : '';
      if (!field || (fieldSet.size > 0 && !fieldSet.has(field))) continue;
      const op = action.op === 'set_null_or_default' ? 'set_null_or_default' : 'truncate';
      if (op === 'truncate') {
        const rawMaxChars = toRecord(action.truncate)?.maxChars ?? action.maxChars;
        const maxChars = Math.max(1, Math.min(200000, toPositiveInt(rawMaxChars, 800)));
        nextActions.push({
          type: 'field',
          field,
          op: 'truncate',
          maxChars,
          setMode: 'null',
        });
      } else {
        const setMode = action.setMode === 'empty' || action.setMode === 'default' ? action.setMode : 'null';
        nextActions.push({
          type: 'field',
          field,
          op: 'set_null_or_default',
          maxChars: 800,
          setMode,
        });
      }
    }

    if (nextActions.length > 0) {
      return nextActions;
    }
    if (options?.fallbackToDefault === false) {
      return [];
    }
    return createDefaultActionForTarget(targetValue, schemas);
  }, [createDefaultActionForTarget, schemas]);

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
  }, [createDefaultActionForTarget]);

  const loadJobs = useCallback(async (statusFilter: JobStatusFilter = jobStatusFilter) => {
    setJobsLoading(true);
    setJobsError(null);
    try {
      const query = new URLSearchParams({ limit: '30' });
      if (statusFilter !== 'all') query.set('status', statusFilter);
      const response = await fetch(`/api/admin/data-maintenance/jobs?${query.toString()}`);
      const json = await response.json().catch(() => ({})) as {
        success?: boolean;
        rows?: JobListRow[];
        error?: string;
      };
      if (!response.ok || json.success !== true || !Array.isArray(json.rows)) {
        throw new Error(json.error || '加载任务历史失败');
      }
      setJobs(json.rows);
    } catch (error) {
      setJobsError(error instanceof Error ? error.message : '未知错误');
    } finally {
      setJobsLoading(false);
    }
  }, [jobStatusFilter]);

  useEffect(() => {
    void loadJobs(jobStatusFilter);
  }, [jobStatusFilter, loadJobs]);

  const scopePayload = useMemo(() => {
    return buildScopePayload(scope, selectedSchema);
  }, [scope, selectedSchema]);

  const actionsPayload = useMemo(() => {
    return buildActionsPayload(actions);
  }, [actions]);

  const requestPreview = useCallback(async (input: {
    nextTarget: CleanupTarget;
    nextScopePayload: Record<string, unknown>;
    nextActionsPayload: ReturnType<typeof buildActionsPayload>;
  }) => {
    setPreviewLoading(true);
    setPreviewError(null);
    setExecuteError(null);
    setExecuteResult(null);
    try {
      const response = await fetch('/api/admin/data-maintenance/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: input.nextTarget,
          scope: input.nextScopePayload,
          actions: input.nextActionsPayload,
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
  }, []);

  const doPreview = async () => {
    await requestPreview({
      nextTarget: target,
      nextScopePayload: scopePayload,
      nextActionsPayload: actionsPayload,
    });
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
      setExecutePrecheckWarnings(Array.isArray(json.precheckWarnings) ? json.precheckWarnings : []);
      setLastJobId(typeof json.jobId === 'string' ? json.jobId : null);
      setExecuteResult(json.result);
      await loadJobs();
    } catch (error) {
      setExecuteError(error instanceof Error ? error.message : '未知错误');
    } finally {
      setExecuteLoading(false);
    }
  };

  const openJobDetail = async (jobId: string) => {
    setJobDetailLoading(true);
    setJobDetailError(null);
    setSelectedJobDetail(null);
    try {
      const response = await fetch(`/api/admin/data-maintenance/jobs/${encodeURIComponent(jobId)}`);
      const json = await response.json().catch(() => ({})) as JobDetailResponse;
      if (!response.ok || json.success !== true) {
        throw new Error((json as { error?: string }).error || '读取详情失败');
      }
      setSelectedJobDetail(json.detail);
    } catch (error) {
      setJobDetailError(error instanceof Error ? error.message : '未知错误');
    } finally {
      setJobDetailLoading(false);
    }
  };

  const applyJobDetailToForm = (
    detail: JobDetail,
    options?: {
      autoPreview?: boolean;
    },
  ) => {
    const targetSchema = schemas.find((item) => item.target === detail.target) ?? null;
    const nextScope = normalizeScopeFromDetail(detail.scope, targetSchema);
    const nextActions = normalizeActionsFromDetail(detail.actions, targetSchema, detail.target);

    setTarget(detail.target);
    setScope(nextScope);
    setActions(nextActions);

    const suggestedMaxRows = detail.selectedRows > 0 ? detail.selectedRows : detail.totalMatchedRows;
    if (suggestedMaxRows > 0) {
      setMaxRows(Math.max(1, Math.min(100000, suggestedMaxRows)));
    }
    const suggestedBatchSize = detail.selectedRows > 0 ? Math.min(500, detail.selectedRows) : 200;
    setBatchSize(Math.max(1, Math.min(5000, suggestedBatchSize)));
    setConfirmText('');
    if (options?.autoPreview) {
      const nextScopePayload = buildScopePayload(nextScope, targetSchema);
      const nextActionsPayload = buildActionsPayload(nextActions);
      void requestPreview({
        nextTarget: detail.target,
        nextScopePayload,
        nextActionsPayload,
      });
      return;
    }
    invalidateRunState();
  };

  const selectedJobDiffMessages = useMemo(() => {
    if (!selectedJobDetail) return [] as string[];
    const detailSchema = schemas.find((item) => item.target === selectedJobDetail.target) ?? null;
    const detailScope = normalizeScopeForCompare(normalizeScopeFromDetail(selectedJobDetail.scope, detailSchema));
    const currentScope = normalizeScopeForCompare(scope);
    const detailActions = normalizeActionsFromDetail(
      selectedJobDetail.actions,
      detailSchema,
      selectedJobDetail.target,
      { fallbackToDefault: false },
    );

    const messages: string[] = [];
    if (target !== selectedJobDetail.target) {
      messages.push(`目标不同：当前=${target}，历史=${selectedJobDetail.target}`);
    }

    const scopeDiffMap: Array<{ label: string; currentValue: string; detailValue: string }> = [
      { label: 'dateFrom', currentValue: currentScope.dateFrom, detailValue: detailScope.dateFrom },
      { label: 'dateTo', currentValue: currentScope.dateTo, detailValue: detailScope.dateTo },
      { label: 'statusIn', currentValue: currentScope.statusInText, detailValue: detailScope.statusInText },
      { label: 'queue', currentValue: currentScope.queue, detailValue: detailScope.queue },
      { label: 'kind', currentValue: currentScope.kind, detailValue: detailScope.kind },
      {
        label: 'pvpOnly',
        currentValue: currentScope.pvpOnly ? 'true' : 'false',
        detailValue: detailScope.pvpOnly ? 'true' : 'false',
      },
    ];
    scopeDiffMap.forEach((item) => {
      if (item.currentValue !== item.detailValue) {
        messages.push(`范围差异 ${item.label}：当前=${item.currentValue || '(空)'}，历史=${item.detailValue || '(空)'}`);
      }
    });

    const currentActionSignatures = actions.map(actionToSignature);
    const detailActionSignatures = detailActions.map(actionToSignature);
    if (currentActionSignatures.length !== detailActionSignatures.length) {
      messages.push(`动作数量不同：当前=${currentActionSignatures.length}，历史=${detailActionSignatures.length}`);
    }

    const maxActionRows = Math.max(currentActionSignatures.length, detailActionSignatures.length);
    for (let i = 0; i < maxActionRows; i += 1) {
      const currentSig = currentActionSignatures[i] ?? '(无)';
      const detailSig = detailActionSignatures[i] ?? '(无)';
      if (currentSig !== detailSig) {
        messages.push(`动作 #${i + 1} 不同：当前=${currentSig}，历史=${detailSig}`);
      }
    }
    return messages;
  }, [selectedJobDetail, schemas, target, scope, actions, normalizeActionsFromDetail, normalizeScopeFromDetail]);

  const applyPreset = (preset: CleanupPreset) => {
    const next = preset.build();
    setTarget(next.target);
    setScope(next.scope);
    setActions(next.actions);
    setMaxRows(next.maxRows);
    setBatchSize(next.batchSize);
    setConfirmText('');
    invalidateRunState();
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
            <div className="mb-3 text-sm font-semibold text-gray-800">0) 快速预设</div>
            <div className="grid gap-3 md:grid-cols-2">
              {cleanupPresets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="rounded-lg border border-gray-200 p-3 text-left hover:border-violet-300 hover:bg-violet-50"
                  onClick={() => applyPreset(preset)}
                >
                  <div className="text-sm font-semibold text-gray-800">{preset.label}</div>
                  <div className="mt-1 text-xs text-gray-500">{preset.description}</div>
                </button>
              ))}
            </div>
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
                {lastJobId ? <div>- 任务 ID：{lastJobId}</div> : null}
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

            {executePrecheckWarnings.length > 0 ? (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                {executePrecheckWarnings.map((warning, index) => (
                  <div key={index}>- 预检提示：{warning}</div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
            <div className="mb-3 flex items-center justify-between">
              <div className="inline-flex items-center gap-2 text-sm font-semibold text-gray-800">
                <History className="h-4 w-4" />
                5) 执行历史
              </div>
              <div className="flex items-center gap-2">
                <select
                  className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700"
                  value={jobStatusFilter}
                  onChange={(e) => {
                    setJobStatusFilter(e.target.value as JobStatusFilter);
                    setSelectedJobDetail(null);
                    setJobDetailError(null);
                  }}
                >
                  <option value="all">全部状态</option>
                  <option value="running">running</option>
                  <option value="completed">completed</option>
                  <option value="failed">failed</option>
                </select>
                <button
                  className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  onClick={() => void loadJobs(jobStatusFilter)}
                  disabled={jobsLoading}
                >
                  <RefreshCw className={`h-4 w-4 ${jobsLoading ? 'animate-spin' : ''}`} />
                  刷新
                </button>
              </div>
            </div>

            {jobsError ? <div className="text-sm text-red-600">{jobsError}</div> : null}
            {!jobsError && jobs.length <= 0 ? <div className="text-sm text-gray-500">暂无执行记录。</div> : null}

            {jobs.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-gray-700">任务</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-700">状态</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-700">目标</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-700">影响</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-700">时间</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-700">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {jobs.map((job) => (
                      <tr key={job.id}>
                        <td className="px-3 py-2">
                          <div className="font-mono text-xs text-gray-700">{job.id}</div>
                          {job.riskLevel ? (
                            <div className={`mt-1 inline-flex rounded px-1.5 py-0.5 text-xs ${
                              job.riskLevel === 'high'
                                ? 'bg-red-100 text-red-700'
                                : job.riskLevel === 'medium'
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-emerald-100 text-emerald-700'
                            }`}>
                              {job.riskLevel}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex rounded px-2 py-0.5 text-xs ${
                            job.status === 'completed'
                              ? 'bg-emerald-100 text-emerald-700'
                              : job.status === 'failed'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-indigo-100 text-indigo-700'
                          }`}>
                            {job.status}
                          </span>
                          {job.errorText ? <div className="mt-1 text-xs text-red-600">{job.errorText}</div> : null}
                        </td>
                        <td className="px-3 py-2 text-gray-700">{job.target}</td>
                        <td className="px-3 py-2 text-gray-700">
                          <div>matched: {job.totalMatchedRows}</div>
                          <div>selected: {job.selectedRows}</div>
                          <div>affected: {job.affectedRows}</div>
                          <div>cells: {job.cellChanges}</div>
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600">
                          <div>创建：{job.createdAt}</div>
                          {job.finishedAt ? <div>结束：{job.finishedAt}</div> : null}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                            onClick={() => void openJobDetail(job.id)}
                          >
                            查看详情
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="mt-3">
              {jobDetailLoading ? <div className="text-sm text-gray-500">详情加载中...</div> : null}
              {jobDetailError ? <div className="text-sm text-red-600">{jobDetailError}</div> : null}
              {selectedJobDetail ? (
                <details open className="rounded-md border border-gray-200 p-3">
                  <summary className="cursor-pointer text-sm font-medium text-gray-800">
                    任务详情：{selectedJobDetail.id}
                  </summary>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-700">
                    <button
                      type="button"
                      className="rounded-md border border-violet-300 bg-violet-50 px-2 py-1 font-medium text-violet-700 hover:bg-violet-100"
                      onClick={() => applyJobDetailToForm(selectedJobDetail)}
                    >
                      复用此任务配置
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-indigo-300 bg-indigo-50 px-2 py-1 font-medium text-indigo-700 hover:bg-indigo-100"
                      onClick={() => applyJobDetailToForm(selectedJobDetail, { autoPreview: true })}
                    >
                      复用并立即预览
                    </button>
                    <span className="rounded bg-gray-100 px-2 py-1">target: {selectedJobDetail.target}</span>
                    <span className="rounded bg-gray-100 px-2 py-1">status: {selectedJobDetail.status}</span>
                    <span className="rounded bg-gray-100 px-2 py-1">risk: {selectedJobDetail.riskLevel ?? '-'}</span>
                    <span className="rounded bg-gray-100 px-2 py-1">planHash: {selectedJobDetail.planHash.slice(0, 24)}...</span>
                  </div>

                  <div className="mt-2 grid gap-2 md:grid-cols-4">
                    <div className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700">
                      matched: {selectedJobDetail.totalMatchedRows}
                    </div>
                    <div className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700">
                      selected: {selectedJobDetail.selectedRows}
                    </div>
                    <div className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700">
                      affected: {selectedJobDetail.affectedRows}
                    </div>
                    <div className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700">
                      cells: {selectedJobDetail.cellChanges}
                    </div>
                  </div>

                  {selectedJobDetail.warnings.length > 0 ? (
                    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
                      {selectedJobDetail.warnings.map((warning, idx) => (
                        <div key={idx}>- {warning}</div>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-2 text-xs text-gray-700">
                    <div className="mb-1 font-semibold text-gray-800">与当前表单的差异</div>
                    {selectedJobDiffMessages.length > 0 ? (
                      selectedJobDiffMessages.map((item, idx) => (
                        <div key={idx}>- {item}</div>
                      ))
                    ) : (
                      <div className="text-emerald-700">当前表单与该历史任务配置一致。</div>
                    )}
                  </div>

                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    <div>
                      <div className="mb-1 text-xs font-semibold text-gray-700">Scope / Actions</div>
                      <pre className="overflow-x-auto rounded bg-gray-50 p-2 text-xs">
{JSON.stringify({ scope: selectedJobDetail.scope, actions: selectedJobDetail.actions }, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <div className="mb-1 text-xs font-semibold text-gray-700">Preview / Warnings</div>
                      <pre className="overflow-x-auto rounded bg-gray-50 p-2 text-xs">
{JSON.stringify({ warnings: selectedJobDetail.warnings, preview: selectedJobDetail.preview }, null, 2)}
                      </pre>
                    </div>
                  </div>
                  {selectedJobDetail.logs?.length ? (
                    <div className="mt-2">
                      <div className="mb-1 text-xs font-semibold text-gray-700">批次日志</div>
                      <div className="space-y-1 text-xs text-gray-700">
                        {selectedJobDetail.logs.map((log) => (
                          <div key={log.id}>
                            #{log.batchNo} affected={log.affectedRows} cells={log.cellChanges} note={log.note ?? '-'} at {log.createdAt}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </details>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
