import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const reportDirectory = mkdtempSync(path.join(os.tmpdir(), 'hosted-dr-evidence-'));
const separateIntegrationCaseIds = new Set(['G25E2-REDIS-EMPTY']);

const suites = [
  {
    name: 'hosted-api',
    packageName: '@mahoshojo/hosted-api',
    tests: [
      'tests/hosted-dr.test.ts',
      'tests/hosted-dr-fault-matrix.test.ts',
      'tests/hosted-dr-version-gate.test.ts',
      'tests/arena-generation-service.test.ts',
    ],
  },
  {
    name: 'api',
    packageName: '@mahoshojo/api',
    tests: [
      'tests/hosted-dr-fault-matrix.test.ts',
      'tests/redis-runtime.test.ts',
    ],
  },
  {
    name: 'web',
    packageName: '@mahoshojo/web',
    tests: [
      'tests/hosted-dr-fault-matrix.test.ts',
      'tests/hosted-dr-database-provider.test.ts',
      'tests/arena-generation-fault-injection.test.ts',
      'tests/arena-generation-finalization-internal-route.test.ts',
    ],
  },
];

const run = (args, options = {}) => {
  const result = spawnSync(pnpmCommand, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    ...options,
  });
  if (result.error) throw result.error;
  return result;
};

const failCommand = (label, result) => {
  process.stderr.write(`${label} failed\n`);
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
};

try {
  const contract = run(['run', 'check:hosted-dr']);
  if (contract.status !== 0) failCommand('Hosted DR contract preflight', contract);
  process.stdout.write(contract.stdout);
  process.stderr.write(contract.stderr);

  const executedAssertions = [];
  for (const suite of suites) {
    const outputFile = path.join(reportDirectory, `${suite.name}.json`);
    const result = run([
      '--filter',
      suite.packageName,
      'exec',
      'vitest',
      'run',
      '--config',
      'vitest.config.ts',
      ...suite.tests,
      '--reporter=json',
      `--outputFile=${outputFile}`,
    ]);
    if (result.status !== 0) failCommand(`Hosted DR ${suite.name} evidence suite`, result);
    const report = JSON.parse(readFileSync(outputFile, 'utf8'));
    for (const testResult of report.testResults ?? []) {
      const relativePath = path.relative(repositoryRoot, testResult.name).split(path.sep).join('/');
      for (const assertion of testResult.assertionResults ?? []) {
        executedAssertions.push({
          file: relativePath,
          status: assertion.status,
          title: assertion.title,
        });
      }
    }
  }

  const drills = JSON.parse(readFileSync(
    path.join(repositoryRoot, 'config/hosted-dr-drills.json'),
    'utf8',
  ));
  let executableCaseCount = 0;
  let separateIntegrationCaseCount = 0;
  for (const drillCase of drills.cases ?? []) {
    let evidence;
    for (const evidenceFile of drillCase.evidenceTests ?? []) {
      evidence = executedAssertions.find((assertion) => (
        assertion.file === evidenceFile
        && assertion.status === 'passed'
        && assertion.title.startsWith(`${drillCase.id}：`)
      ));
      if (evidence) break;
    }
    if (!evidence) {
      throw new Error(`${drillCase.id}: 没有在声明的 evidenceTests 中观察到实际 passed case`);
    }
    if (separateIntegrationCaseIds.has(drillCase.id)) {
      separateIntegrationCaseCount += 1;
      console.log(JSON.stringify({
        event: 'hosted.dr.evidence.integration.required',
        caseId: drillCase.id,
        evidenceCommand: drillCase.evidenceCommand,
        seamEvidenceTest: evidence.file,
      }));
      continue;
    }
    executableCaseCount += 1;
    console.log(JSON.stringify({
      event: 'hosted.dr.evidence.passed',
      caseId: drillCase.id,
      evidenceTest: evidence.file,
    }));
  }
  console.log(
    `Hosted DR executable evidence OK: ${executableCaseCount} cases; `
      + `separate integration gate required: ${separateIntegrationCaseCount}.`,
  );
} finally {
  rmSync(reportDirectory, { recursive: true, force: true });
}
