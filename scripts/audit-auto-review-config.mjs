import { pathToFileURL } from 'node:url';

const PROVIDERS_BINDING = 'AI_REVIEW_PROVIDERS_CONFIG';
const REVIEW_BINDINGS = [PROVIDERS_BINDING, 'AI_REVIEW_ROUTING', 'AI_REVIEW_POLICY'];
const BINDING_TYPES = new Set(['plain_text', 'json', 'secret_text', 'secret_key', 'secrets_store_secret']);
const KNOWN_OPENROUTER_MODELS = [
  'respan/span-01-lite',
  'respan/span-01-lite:free',
  'inception/mercury-decide',
  'inception/mercury-decide:free',
  'perplexity/pplx-decider-v1.3:free',
  'perplexity/pplx-decider-flash-v1.3:free',
];
const OPENROUTER_DECISIONS_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
const REQUEST_TIMEOUT_MS = 15_000;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasText = (value) => typeof value === 'string' && value.trim().length > 0;

function findBinding(bindings, name) {
  return bindings?.find((binding) => isRecord(binding) && binding.name === name);
}

function readProviders(binding) {
  let value;
  if (binding?.type === 'plain_text' && typeof binding.text === 'string') {
    value = binding.text;
  } else if (binding?.type === 'json' && Object.hasOwn(binding, 'json')) {
    value = binding.json;
  } else {
    return { readable: false, entries: null, error: null };
  }

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return { readable: true, entries: null, error: 'INVALID_PROVIDERS_JSON' };
    }
  }
  if (!Array.isArray(value)) {
    return { readable: true, entries: null, error: 'PROVIDERS_NOT_ARRAY' };
  }
  return { readable: true, entries: value.filter(isRecord), error: null };
}

/** 请求不可用时以 null 表示无法确认的绑定，只检查 settings 中可读的配置。 */
export function summarizeAutoReviewConfig(settingsBindings, secretBindings) {
  const bindings = Object.fromEntries(REVIEW_BINDINGS.map((name) => {
    const binding = findBinding(settingsBindings, name) ?? findBinding(secretBindings, name);
    if (!binding) return [name, settingsBindings === null ? null : { present: false, type: 'missing' }];
    return [name, { present: true, type: BINDING_TYPES.has(binding.type) ? binding.type : 'other' }];
  }));

  const { readable, entries, error } = readProviders(findBinding(settingsBindings, PROVIDERS_BINDING));
  const decisions = entries?.filter((entry) =>
    entry.kind === 'jev-decisions' && entry.endpoint === OPENROUTER_DECISIONS_ENDPOINT,
  );
  return {
    bindings,
    providers: {
      readable,
      validArray: entries !== null,
      error,
      configuredOpenRouterModels: Object.fromEntries(KNOWN_OPENROUTER_MODELS.map((model) => [
        model, decisions?.some((entry) => entry.model === model) ?? null,
      ])),
      openRouterDecisions: {
        present: decisions ? decisions.length > 0 : null,
        hasCredentialReference: decisions?.some((entry) => hasText(entry.apiKeyEnv)) ?? null,
        hasDirectCredential: decisions?.some((entry) => hasText(entry.apiKey)) ?? null,
      },
    },
  };
}

async function getBindings(url, token, fetchImpl, selectBindings) {
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      redirect: 'manual',
      signal,
    });
  } catch {
    return { status: null, error: signal.aborted ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR', bindings: null };
  }

  const status = response.status;
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return { status, error: 'HTTP_ERROR', bindings: null };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return { status, error: signal.aborted ? 'REQUEST_TIMEOUT' : 'INVALID_RESPONSE_JSON', bindings: null };
  }
  if (payload?.success === false) return { status, error: 'API_ERROR', bindings: null };

  const bindings = selectBindings(payload?.result);
  if (payload?.success !== true || !Array.isArray(bindings)) {
    return { status, error: 'INVALID_RESPONSE_SHAPE', bindings: null };
  }
  return { status, error: null, bindings };
}

function selectSettingsBindings(result) {
  if (!isRecord(result)) return null;
  // Cloudflare 将 settings 的 bindings 声明为可选字段。
  return Object.hasOwn(result, 'bindings') ? result.bindings : [];
}

export async function auditAutoReviewConfig(fetchImpl = globalThis.fetch) {
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!token) return { error: 'MISSING_API_TOKEN' };
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!accountId || !/^[a-f0-9]{32}$/i.test(accountId)) return { error: 'INVALID_ACCOUNT_ID' };

  const worker = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/mahoshojo-next`;
  const [settings, secrets] = await Promise.all([
    getBindings(`${worker}/settings`, token, fetchImpl, selectSettingsBindings),
    getBindings(`${worker}/secrets`, token, fetchImpl, (result) => result),
  ]);

  return {
    requests: {
      settings: { status: settings.status, error: settings.error },
      secrets: { status: secrets.status, error: secrets.error },
    },
    ...summarizeAutoReviewConfig(settings.bindings, secrets.bindings),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const summary = await auditAutoReviewConfig();
    console.log(JSON.stringify(summary, null, 2));
    if (summary.error || summary.requests.settings.error || summary.requests.secrets.error || summary.providers.error) {
      process.exitCode = 1;
    }
  } catch {
    console.log(JSON.stringify({ error: 'AUDIT_ERROR' }));
    process.exitCode = 1;
  }
}
