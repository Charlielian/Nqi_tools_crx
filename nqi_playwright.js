#!/usr/bin/env node
/**
 * NQI Playwright 启动脚本
 * 用于在 Playwright 中加载 NqiTool 扩展插件
 * 
 * 使用方法:
 *   node nqi_playwright.js
 *   或
 *   node nqi_playwright.js --url "https://nqi.gmcc.net/pro-adhoc/adhocquery"
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// 扩展插件目录 (当前脚本所在目录)
const EXTENSION_PATH = __dirname;

// 默认 URL
const DEFAULT_URL = 'https://nqi.gmcc.net/pro-adhoc/adhocquery';

// 解析命令行参数
const args = process.argv.slice(2);
let targetUrl = DEFAULT_URL;
let headless = false;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' || args[i] === '-u') {
        targetUrl = args[i + 1] || DEFAULT_URL;
        i++;
    }
    if (args[i] === '--headless') {
        headless = true;
    }
}

/**
 * 创建带扩展插件的浏览器上下文
 * 
 * 关键点:
 * - 使用 launchPersistentContext，不是普通 launch
 * - headless 必须为 false
 * - args 需要加 --disable-extensions-except 和 --load-extension
 */
async function createBrowserWithExtension() {
    console.log('='.repeat(60));
    console.log('NQI Playwright 扩展加载器');
    console.log('='.repeat(60));
    console.log(`扩展路径: ${EXTENSION_PATH}`);
    console.log(`目标 URL: ${targetUrl}`);
    console.log(`无头模式: ${headless}`);
    console.log('='.repeat(60));
    
    // 检查扩展目录是否存在
    const manifestPath = path.join(EXTENSION_PATH, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        console.error('错误: manifest.json 不存在');
        process.exit(1);
    }
    
    // 创建临时用户数据目录
    const userDataDir = path.join(__dirname, 'temp-user-data');
    if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
    }
    
    // 关键点: 使用 launchPersistentContext
    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: headless,  // 必须为 false，扩展不支持无头
        args: [
            '--disable-extensions-except=' + EXTENSION_PATH,  // 只启用指定扩展
            '--load-extension=' + EXTENSION_PATH,  // 加载扩展
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
        ],
        timeout: 60000
    });
    
    return context;
}

async function main() {
    let context;
    
    try {
        context = await createBrowserWithExtension();
        
        // 获取页面
        let page = context.pages()[0];
        if (!page) {
            page = await context.newPage();
        }
        
        // 打开 URL
        console.log(`\n正在打开: ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log('页面已加载');
        
        // 等待用户按 Ctrl+C 退出
        console.log('\n按 Ctrl+C 退出...\n');
        
        // 保持进程运行
        await new Promise(() => {});
        
    } catch (error) {
        console.error('错误:', error.message);
        process.exit(1);
    } finally {
        if (context) {
            await context.close();
        }
    }
}

// 运行
main();


// ========== 核心代码模板 ==========
const TEMPLATE_CODE = `
// ========================================
// 核心模板代码
// ========================================

const { chromium } = require('playwright');
const path = require('path');

const EXTENSION_PATH = '/path/to/NqiTool';

async function main() {
    // 关键点: 使用 launchPersistentContext
    const context = await chromium.launchPersistentContext(
        './temp-user-data',
        {
            headless: false,  // 必须为 false
            args: [
                '--disable-extensions-except=' + EXTENSION_PATH,
                '--load-extension=' + EXTENSION_PATH,
                '--no-sandbox',
                '--disable-setuid-sandbox',
            ],
            timeout: 60000
        }
    );
    
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://nqi.gmcc.net/pro-adhoc/adhocquery');
    
    console.log('URL:', page.url());
    
    // ... 你的操作 ...
    
    // 关闭
    await context.close();
}

main().catch(console.error);
`;

// 打印模板代码
console.log('\n' + '='.repeat(60));
console.log('核心模板代码 (可复制到其他项目使用)');
console.log('='.repeat(60));
console.log(TEMPLATE_CODE);
