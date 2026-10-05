import { z } from 'zod';

// 浏览器生产 CSP 不允许 unsafe-eval；在任何客户端 schema 构造前禁用 Zod JIT。
z.config({ jitless: true });
