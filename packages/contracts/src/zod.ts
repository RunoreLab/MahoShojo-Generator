import { z } from 'zod';

// Zod v4 默认探测 Function constructor 以启用 object-schema JIT。生产浏览器
// CSP 明确禁止 unsafe-eval，因此所有共享 wire schema 在构造前统一关闭 JIT。
z.config({ jitless: true });

export { z };
