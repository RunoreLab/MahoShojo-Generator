// app/api/resign-data/handler.ts
import { NextRequest } from 'next/server';
import { generateSignature } from '@/lib/signature'; // 导入我们的签名生成工具
import { quickCheck } from '@/lib/sensitive-word-filter'; // 导入安全检查工具
import { getLogger } from '@/lib/logger';

const log = getLogger('api-resign-data');

/**
 * 这是一个专门用于重新签名角色数据的API端点。
 * 流程：
 * 1. 接收来自客户端的角色数据。
 * 2. 对数据进行基础的安全检查。
 * 3. 调用服务端的 generateSignature 函数，使用保密密钥生成一个新的签名。
 * 4. 将新签名附加到角色数据上。
 * 5. 返回包含有效新签名的完整角色数据。
 *
 * @param req NextRequest 请求对象，包含待签名的角色数据。
 * @returns 返回带有新签名的角色数据，或在发生错误时返回错误信息。
 */
async function handler(req: NextRequest) {
  // 确保请求方法是 POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const characterData = await req.json();

    // 安全第一：在签名之前，对传入的数据进行敏感词检查
    // 这是一个必要的安全措施，防止用户通过编辑功能注入不当内容并获得“原生”签名。
    const textToCheck = JSON.stringify(characterData);
    const checkResult = await quickCheck(textToCheck);
    if (checkResult.hasSensitiveWords) {
      log.warn('检测到敏感词，拒绝为该数据签名', { detected: checkResult.detectedWords });
      // 返回一个特定的错误结构，前端可以据此进行跳转
      return new Response(JSON.stringify({
        error: '输入内容不合规，无法签名',
        shouldRedirect: true,
        reason: '编辑后的角色档案包含危险符文'
      }), { status: 400 });
    }
    
    // 调用核心签名函数，为数据生成一个新的、有效的签名
    const signature = await generateSignature(characterData);
    
    // 将新签名附加到数据中
    const signedData = { ...characterData, signature };
    
    // 返回带有新签名的完整数据
    return new Response(JSON.stringify(signedData), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    // 捕获并记录任何潜在的错误，例如JSON解析失败
    log.error('为数据重新签名时发生错误', { error });
    const errorMessage = error instanceof Error ? error.message : '无效的请求数据';
    return new Response(JSON.stringify({ error: '签名服务出错', message: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export const appRouteHandler = handler;
export default appRouteHandler;
