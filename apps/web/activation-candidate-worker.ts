import { createHostedDrActivationCandidateWorker } from './lib/hosted-dr/activation-candidate-worker';

// OpenNext 在 build:cf 阶段生成此入口；候选 Worker 必须在它之前执行 fail-closed guard。
// @ts-expect-error generated OpenNext worker is absent before build:cf
import openNextWorker from './.open-next/worker.js';

export default createHostedDrActivationCandidateWorker(openNextWorker);
