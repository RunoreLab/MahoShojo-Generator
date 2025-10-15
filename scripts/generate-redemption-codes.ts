/**
 * 生成随机兑换码的工具脚本
 *
 * 使用方法：
 * bun run scripts/generate-redemption-codes.ts <数量> <槽位数>
 *
 * 例如：
 * bun run scripts/generate-redemption-codes.ts 10 64
 * 生成 10 个兑换码，每个增加 5 个槽位
 */

import { insertRedemptionCodes } from '../lib/database/redemption-codes';

// 生成随机兑换码（12位，包含大写字母和数字）
function generateRandomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 12; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  // 格式化为 XXXX-XXXX-XXXX 便于阅读
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
}

async function main() {
  // 从命令行参数获取数量和槽位数
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('❌ 使用方法: bun run scripts/generate-redemption-codes.ts <数量> <槽位数>');
    console.error('例如: bun run scripts/generate-redemption-codes.ts 10 5');
    process.exit(1);
  }

  const count = parseInt(args[0]);
  const slotCount = parseInt(args[1]);

  if (isNaN(count) || count <= 0) {
    console.error('❌ 数量必须是大于 0 的整数');
    process.exit(1);
  }

  if (isNaN(slotCount) || slotCount <= 0) {
    console.error('❌ 槽位数必须是大于 0 的整数');
    process.exit(1);
  }

  console.log(`🎫 开始生成 ${count} 个兑换码，每个增加 ${slotCount} 个槽位...\n`);

  // 生成兑换码
  const codes = [];
  const codeSet = new Set<string>();

  while (codes.length < count) {
    const code = generateRandomCode();
    // 确保不重复
    if (!codeSet.has(code)) {
      codeSet.add(code);
      codes.push({ code, slotCount });
    }
  }

  // 插入数据库
  console.log('💾 正在写入数据库...\n');
  const success = await insertRedemptionCodes(codes);
  if (success) {
    console.log('✅ 兑换码生成成功！\n');
    console.log('生成的兑换码：');
    console.log('━'.repeat(50));
    codes.forEach((item, index) => {
      console.log(`谢谢金主大人支持！！以下是 ${item.slotCount} 个槽位的兑换码：【${item.code}】请在 魔事院档案馆 中登录账号后，点击兑换来使用~ 如果出现问题，可以在 QQ 群里联系 @Colanns 或者在这里直接私信哦~ 另外就是，赞助不少于 24 元的老板们可以留下自己的收货地址，之后说不定会有神秘小礼物包邮到家（？！`);
    });
    console.log('━'.repeat(50));
    console.log(`\n📊 总计: ${count} 个兑换码`);
  } else {
    console.error('❌ 写入数据库失败');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('❌ 发生错误:', error);
  process.exit(1);
});
