/** Explicit opt-in live evaluation. Credentials and raw production samples stay outside Git. */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  if (!process.argv[i].startsWith('--') || !process.argv[i + 1]) throw new Error('Use --name value arguments');
  args.set(process.argv[i].slice(2), process.argv[i + 1]);
}
const out = resolve(root, args.get('out') ?? '.tmp/narrative-eval/candidate-prompts.json');
const compiled = resolve(root, '.tmp/narrative-eval', `core-${process.pid}.mjs`);
await mkdir(dirname(compiled), { recursive: true });
await build({ stdin: { contents: "export { assembleArenaGenerationPrompt, createArenaStreamProjector } from '@mahoshojo/ai-core/arena-generation';", resolveDir: resolve(root, 'packages/ai-core'), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', outfile: compiled, logLevel: 'silent',
  plugins: args.get('source-ref') ? [{ name: 'frozen-arena-source', setup(builder) {
    const revision = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${args.get('source-ref')}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
    builder.onLoad({ filter: /arena-generation[/\\](prompt|prompt-assembly|structured-report)\.ts$/ }, ({ path }) => ({
      contents: execFileSync('git', ['show', `${revision}:packages/ai-core/src/arena-generation/${path.split(/[/\\]/u).at(-1)}`], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }), loader: 'ts', resolveDir: dirname(path),
    }));
  } }] : [],
});
const core = await import(pathToFileURL(compiled).href);
const samples = JSON.parse(await readFile(resolve(root, args.get('samples') ?? 'packages/ai-core/fixtures/narrative-fidelity-cases.json'), 'utf8'));
const cases = samples.map(sample => {
  const payload = sample.payload ?? { mode: sample.mode, language: 'zh-CN',
    combatants: sample.characters.map(data => ({ type: 'general-character', data: { templateId: '通用角色', ...data } })),
    scenario: sample.scenario ? { templateId: '通用情景', ...sample.scenario } : null,
    userGuidance: sample.guidance ?? '', readArenaHistory: false, readCurrentState: false,
    writeArenaHistory: true, writeCurrentState: true, storyLength: 'short' };
  return { id: sample.id, checks: sample.checks ?? [], payload, ...core.assembleArenaGenerationPrompt({ payload,
    outputContract: 'stream-markdown', adjudicationResults: null, reporterInfo: { name: '验收记者', publication: '本地验收' } }) };
});
const snapshot = { capturedAt: new Date().toISOString(), sourceRef: args.get('source-ref') ?? 'working-tree', cases };
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(snapshot, null, 2), { flag: args.get('overwrite') === 'true' ? 'w' : 'wx' });
console.log(JSON.stringify({ captured: cases.length, output: out }));
if (args.get('run') !== 'true') process.exit(0);
if (!args.get('key-file') || !args.get('models') || !args.get('baseline')) throw new Error('Live runs need --key-file, --models and --baseline');
const endpoint = new URL(args.get('endpoint') ?? 'https://apihub.agnes-ai.com/v1/chat/completions');
if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new Error('Use a credential-free HTTPS endpoint');
const key = (await readFile(resolve(root, args.get('key-file')), 'utf8')).trim();
if (!key || /[\r\n]/u.test(key)) throw new Error('Key file must contain one token');
const baseline = JSON.parse(await readFile(resolve(root, args.get('baseline')), 'utf8'));
const previous = new Map(baseline.cases.map(item => [item.id, item]));
const resultPath = resolve(root, args.get('results') ?? '.tmp/narrative-eval/results.jsonl');
await mkdir(dirname(resultPath), { recursive: true });
let done = [];
try { done = (await readFile(resultPath, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line)); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const repeat = args.get('repeat') ?? '1';
const only = args.get('only')?.split(',');
let stop = false;
const variants = (args.get('variants') ?? 'baseline,candidate').split(',');
if (variants.some(value => !['baseline', 'candidate'].includes(value))) throw new Error('Invalid variant');
let lastStarted = 0;
const intervalMs = Math.max(0, Number(args.get('interval-ms') ?? 10000));
if (!Number.isFinite(intervalMs)) throw new Error('Invalid interval');
for (const model of args.get('models').split(',')) {
  for (const sample of cases.filter(item => !only || only.includes(item.id))) {
    for (const variant of variants) {
      const entry = variant === 'baseline' ? previous.get(sample.id) : sample;
      if (!entry) throw new Error(`Baseline missing case ${sample.id}`);
      const messages = [...(entry.systemPrompt ? [{ role: 'system', content: entry.systemPrompt }] : []), { role: 'user', content: entry.prompt }];
      const digest = createHash('sha256').update(JSON.stringify(messages)).digest('hex');
      if (done.some(item => item.id === sample.id && item.model === model && item.variant === variant && item.repeat === repeat && item.promptDigest === digest && (item.ok || args.get('retry-failed') !== 'true'))) continue;
      const delay = Math.max(0, intervalMs - (Date.now() - lastStarted));
      if (delay) await new Promise(resolveDelay => setTimeout(resolveDelay, delay));
      const started = Date.now();
      lastStarted = started;
      let record;
      try {
        const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 8192, stream: false }), signal: AbortSignal.timeout(120000) });
        const value = await response.json();
        const choice = value.choices?.[0];
        const text = choice?.message?.content ?? '';
        const projector = core.createArenaStreamProjector({ expectsMeta: true, strictTrailer: true });
        if (typeof text === 'string') projector.push(text);
        projector.finish();
        const metaEvent = projector.result().metaEvent;
        record = { id: sample.id, model, variant, repeat, promptDigest: digest, at: new Date().toISOString(),
          ok: response.ok && Boolean(text) && choice?.finish_reason === 'stop', status: response.status,
          finishReason: choice?.finish_reason, durationMs: Date.now() - started, usage: value.usage,
          output: text, metaEvent,
          errorCode: value.error?.code ?? value.error?.type, retryAfter: response.headers.get('retry-after'),
          errorMessage: typeof value.error?.message === 'string' ? value.error.message.slice(0, 300) : undefined };
        if ([401, 402, 403, 429].includes(response.status)) stop = true;
      } catch (error) {
        record = { id: sample.id, model, variant, repeat, promptDigest: digest, at: new Date().toISOString(),
          ok: false, durationMs: Date.now() - started, errorCode: error.name };
      }
      await appendFile(resultPath, `${JSON.stringify(record)}\n`);
      console.log(JSON.stringify({ id: sample.id, model, variant, ok: record.ok, status: record.status, finishReason: record.finishReason, durationMs: record.durationMs, errorCode: record.errorCode }));
      if (stop) break;
    }
    if (stop) break;
  }
  if (stop) break;
}
