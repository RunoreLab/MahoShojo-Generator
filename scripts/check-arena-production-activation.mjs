import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeSync } from 'node:fs';
import path from 'node:path';

const repositoryRoot = process.cwd();
const manifestRelativePath = 'config/arena-production-activation-gate.json';
const args = process.argv.slice(2);

let requireApproved = false;
let printSourceDigest = false;
let commit;

const exitWithError = (message, status = 2) => {
  writeSync(2, `[arena-production-activation] ${message}\n`);
  process.exit(status);
};

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--require-approved') {
    requireApproved = true;
    continue;
  }
  if (arg === '--print-source-digest') {
    printSourceDigest = true;
    continue;
  }
  if (arg === '--commit') {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      exitWithError('--commit 缺少 commit 参数');
    }
    if (commit !== undefined) {
      exitWithError('--commit 不得重复');
    }
    commit = value;
    index += 1;
    continue;
  }
  exitWithError(`未知参数：${arg}`);
}

if (requireApproved && printSourceDigest) {
  exitWithError('--require-approved 与 --print-source-digest 不得同时使用');
}

const runGit = (gitArgs) => spawnSync('git', gitArgs, {
  cwd: repositoryRoot,
  encoding: 'buffer',
  maxBuffer: 32 * 1024 * 1024,
});

const resolveCommit = (reference) => {
  const result = runGit(['rev-parse', '--verify', `${reference}^{commit}`]);
  if (result.status !== 0) {
    throw new Error(`无法解析 commit：${reference}`);
  }
  const resolved = result.stdout.toString('utf8').trim();
  if (!/^[0-9a-f]{40}$/u.test(resolved)) {
    throw new Error(`commit 不是 40 位 Git object id：${reference}`);
  }
  return resolved;
};

const readCommitFile = (resolvedCommit, filePath) => {
  const result = runGit(['show', `${resolvedCommit}:${filePath}`]);
  if (result.status !== 0) {
    throw new Error(`commit 文件无法读取：${resolvedCommit}:${filePath}`);
  }
  return result.stdout.toString('utf8');
};

const readCommitFileMode = (resolvedCommit, filePath) => {
  const result = runGit(['ls-tree', resolvedCommit, '--', filePath]);
  if (result.status !== 0) {
    throw new Error(`commit 文件 mode 无法读取：${resolvedCommit}:${filePath}`);
  }
  const record = result.stdout.toString('utf8').trim();
  const mode = record.split(' ', 1)[0];
  if (!mode) throw new Error(`commit 文件不存在：${resolvedCommit}:${filePath}`);
  return mode;
};

const calculateSourceDigest = (resolvedCommit) => {
  const result = runGit(['ls-tree', '-r', '-z', '--full-tree', resolvedCommit]);
  if (result.status !== 0) {
    throw new Error(`无法读取 commit 源码树：${resolvedCommit}`);
  }

  const hash = createHash('sha256');
  hash.update('arena-production-activation-source-v1\0');
  for (const record of result.stdout.subarray(0, -1).toString('utf8').split('\0')) {
    const tabIndex = record.indexOf('\t');
    if (tabIndex < 0) continue;
    const filePath = record.slice(tabIndex + 1);
    if (filePath === manifestRelativePath) continue;
    hash.update(record);
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
};

if (printSourceDigest) {
  try {
    const resolvedCommit = resolveCommit(commit ?? 'HEAD');
    writeSync(1, `${calculateSourceDigest(resolvedCommit)}\n`);
    process.exit(0);
  } catch (error) {
    exitWithError(error instanceof Error ? error.message : String(error), 1);
  }
}

let currentCommit;
try {
  currentCommit = resolveCommit('HEAD');
} catch (error) {
  exitWithError(error instanceof Error ? error.message : String(error), 1);
}

let manifest;
try {
  manifest = JSON.parse(readCommitFile(currentCommit, manifestRelativePath));
} catch (error) {
  exitWithError(`HEAD manifest 无法读取：${error instanceof Error ? error.message : String(error)}`, 1);
}

const failures = [];
if (manifest?.schemaVersion !== 1) failures.push('schemaVersion 必须为 1');
if (manifest?.goal !== 'GMR-11') failures.push('goal 必须为 GMR-11');
if (!['READY', 'APPROVED'].includes(manifest?.reviewStatus)) {
  failures.push('reviewStatus 必须为 READY 或 APPROVED');
}

const approved = manifest?.reviewStatus === 'APPROVED';
let reviewedCommit;

if (approved) {
  if (typeof manifest.reviewedCommit !== 'string' || !/^[0-9a-f]{40}$/u.test(manifest.reviewedCommit)) {
    failures.push('APPROVED 必须绑定 40 位 reviewedCommit');
  } else {
    try {
      reviewedCommit = resolveCommit(manifest.reviewedCommit);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (
    typeof manifest.reviewedSourceDigest !== 'string'
    || !/^sha256:[0-9a-f]{64}$/u.test(manifest.reviewedSourceDigest)
  ) {
    failures.push('APPROVED 必须绑定 reviewedSourceDigest');
  }
  if (
    typeof manifest.approvedAt !== 'string'
    || Number.isNaN(Date.parse(manifest.approvedAt))
    || new Date(manifest.approvedAt).toISOString() !== manifest.approvedAt
  ) {
    failures.push('APPROVED 必须记录 approvedAt');
  }

  const evidence = manifest.approvalEvidence;
  if (
    typeof evidence !== 'string'
    || path.posix.normalize(evidence) !== evidence
    || !evidence.startsWith('docs/reviews/')
    || evidence.length <= 'docs/reviews/'.length
  ) {
    failures.push('APPROVED 必须绑定 docs/reviews/ 下的独立审查证据');
  } else if (reviewedCommit) {
    try {
      const reviewedMode = readCommitFileMode(reviewedCommit, evidence);
      const currentMode = readCommitFileMode(currentCommit, evidence);
      if (!['100644', '100755'].includes(reviewedMode) || reviewedMode !== currentMode) {
        failures.push('approvalEvidence 必须在 reviewed/current commit 中保持同一普通文件 mode');
      }

      const evidenceContent = readCommitFile(reviewedCommit, evidence);
      const currentEvidenceContent = readCommitFile(currentCommit, evidence);
      if (evidenceContent !== currentEvidenceContent) {
        failures.push('approvalEvidence 在 reviewed/current commit 之间发生漂移');
      }

      const frontMatter = evidenceContent.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
      if (!frontMatter) {
        failures.push('approvalEvidence 必须包含结构化审查 front matter');
      } else {
        const fields = new Map();
        for (const line of frontMatter[1].split(/\r?\n/u)) {
          const separator = line.indexOf(':');
          if (separator < 0) continue;
          fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
        }
        if (fields.get('review') !== 'GMR-11-PRODUCTION-ACTIVATION') {
          failures.push('approvalEvidence review 字段不匹配 GMR-11 production activation');
        }
        if (fields.get('decision') !== 'APPROVED') {
          failures.push('approvalEvidence decision 必须为 APPROVED');
        }
        const reviewer = fields.get('reviewer');
        if (
          typeof reviewer !== 'string'
          || reviewer.length < 2
          || /^(?:todo|tbd|unknown|example)$/iu.test(reviewer)
        ) {
          failures.push('approvalEvidence 必须记录非占位 reviewer');
        }
        if (fields.get('approvedAt') !== manifest.approvedAt) {
          failures.push('approvalEvidence approvedAt 必须与 manifest 完全一致');
        }

        const body = evidenceContent.slice(frontMatter[0].length);
        const firstBodyLine = body.split(/\r?\n/u).find((line) => line.length > 0);
        if (firstBodyLine !== 'GMR-11-PRODUCTION-ACTIVATION: APPROVED') {
          failures.push('approvalEvidence 必须以单行独立批准标记开始正文');
        }
      }
    } catch (error) {
      failures.push(`approvalEvidence 无法读取：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (reviewedCommit) {
    const ancestry = runGit(['merge-base', '--is-ancestor', reviewedCommit, currentCommit]);
    if (ancestry.status !== 0) failures.push('reviewedCommit 必须是当前 release commit 的祖先');

    try {
      const reviewedDigest = calculateSourceDigest(reviewedCommit);
      const currentDigest = calculateSourceDigest(currentCommit);
      if (manifest.reviewedSourceDigest !== reviewedDigest) {
        failures.push('reviewedSourceDigest 与 reviewedCommit 源码树摘要不一致');
      }
      if (manifest.reviewedSourceDigest !== currentDigest) {
        failures.push('当前 release commit 源码树摘要与独立审查结果不一致');
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
} else if (
  manifest?.reviewedCommit !== null
  || manifest?.reviewedSourceDigest !== null
  || manifest?.approvedAt !== null
  || manifest?.approvalEvidence !== null
) {
  failures.push('READY 不得携带伪批准信息');
}

if (requireApproved) {
  const trackedWorktree = runGit(['diff', '--quiet', 'HEAD', '--']);
  if (trackedWorktree.status !== 0) {
    failures.push('release 校验要求 tracked 工作区无未提交变更');
  }
  if (!approved) failures.push('GMR-11 独立审查未批准，禁止启用 production Arena multiplayer');
  if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/u.test(commit)) {
    failures.push('--require-approved 必须提供 40 位 --commit');
  } else {
    try {
      const releaseCommit = resolveCommit(commit);
      if (releaseCommit !== currentCommit) failures.push('--commit 必须精确绑定当前 checkout HEAD');
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
}

if (failures.length > 0) {
  writeSync(2, failures.map((failure) => `[arena-production-activation] ${failure}\n`).join(''));
  process.exitCode = 1;
} else {
  writeSync(1, `${JSON.stringify({
    gate: 'ARENA_PRODUCTION_ACTIVATION_GATE',
    goal: manifest.goal,
    reviewStatus: manifest.reviewStatus,
    mode: requireApproved ? 'require-approved' : 'validate',
    status: 'PASS',
  })}\n`);
}
