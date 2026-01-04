import * as dotenv from 'dotenv';
import { generatePresignedUrl, putObject, listObjects } from '@/lib/r2';

// 加载环境变量
dotenv.config({ path: '.env.local' });

// 配置信息
const CONFIG = {
    // 你的 Next.js 本地服务地址(没用了)
    API_BASE_URL: 'http://localhost:3000',
    // 测试用的文件名
    TEST_KEY: 'test/test-connectivity.txt',
    // 测试文件内容
    TEST_CONTENT: 'Hello R2 from Local Script at ' + new Date().toISOString(),

    // R2 配置 (从环境变量读取)
    R2: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
        bucket: process.env.R2_BUCKET_NAME!,
        accountId: process.env.CF_ACCOUNT_ID!,
    }
};

if (!CONFIG.R2.accessKeyId || !CONFIG.R2.bucket) {
    console.error('❌ 错误: 环境变量未加载。请确保 .env.local 存在且包含 R2 配置。');
    process.exit(1);
}

async function runTest() {
    console.log('🚀 开始 R2 预签名 URL 流程测试...\n');

    // --- 步骤 1: 直接上传文件到 R2 (为了确保测试文件存在) ---
    console.log(`[1/5] 正在上传测试文件 "${CONFIG.TEST_KEY}" 到 R2...`);

    try {
        const uploadRes = await putObject(CONFIG.TEST_KEY, CONFIG.TEST_CONTENT, {
            contentType: 'text/plain',
        });

        if (!uploadRes.data?.etag) throw new Error('上传失败，未返回 etag');
        console.log(`✅ 上传成功，etag: ${uploadRes.data.etag}`);
    } catch (e) {
        console.error('❌ 上传失败:', e);
        return;
    }

    // --- 步骤 2: 调用 headObject 校验元信息 ---
    console.log(`\n[2/5] 跳过 headObject 检查对象元信息`);


    // --- 步骤 3: 调用 listObjects 校验列表 ---
    console.log(`\n[3/5] 正在调用 listObjects 列出 test/ 前缀对象...`);
    try {
        const listRes = await listObjects('test/');
        if (!listRes.success || !listRes.data) {
            throw new Error(listRes.error || '未知原因导致 listObjects 调用失败');
        }
        const found = listRes.data.find(item => item.key === CONFIG.TEST_KEY);
        if (!found) {
            throw new Error('listObjects 返回结果中未找到测试文件');
        }
        console.log(`当前 listObjects 返回结果:`, listRes.data);
        console.log(`✅ listObjects 成功，当前 test/ 下共有 ${listRes.data.length} 个对象，已确认包含 ${CONFIG.TEST_KEY}`);
    } catch (e) {
        console.error('❌ listObjects 执行失败:', e);
        return;
    }

    // --- 步骤 4: 请求你的 Next.js API 获取预签名 URL ---
    console.log(`\n[4/5] 正在请求 API 获取预签名 URL...`);
    const apiUrl = await generatePresignedUrl(CONFIG.TEST_KEY);
    console.log(`   🔗 ${apiUrl}`);
    try {
        // 模拟普通 fetch 请求
        const res = await fetch(apiUrl);

        if (!res.ok) {
            console.error(`❌ API 请求失败: ${res.status} ${res.statusText}`);
            console.error(await res.text());
            return;
        }
        console.log('✅ API 请求成功，文件内容为:');
        console.log(await res.text());
    } catch (e) {
        console.error('❌ 连接失败', e);
        return;
    }
}

runTest();
