/**
 * Playwright 加载 NqiTool 扩展插件的核心代码
 * 
 * 使用方法：
 * 只需要在 launch() 或 launchPersistentContext() 时加上 args 参数即可
 */

const EXTENSION_PATH = '/Users/charlie/Documents/python/浏览器插件/NqiTool';

// ============================================================
// 关键点：在启动浏览器时添加这两个参数
// ============================================================

const BROWSER_ARGS = [
    `--disable-extensions-except=${EXTENSION_PATH}`,  // 只加载指定扩展
    `--load-extension=${EXTENSION_PATH}`,              // 加载扩展路径
    '--no-sandbox',
    '--disable-setuid-sandbox',
];

// ============================================================
// Python 示例 (修改你的现有脚本)
// ============================================================

PYTHON_TEMPLATE = `\
# 在你的 playwright 启动代码中添加 args 参数

from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    # 启动浏览器时添加 args
    browser = p.chromium.launch(
        headless=False,
        args=[
            "--disable-extensions-except=/Users/charlie/Documents/python/浏览器插件/NqiTool",
            "--load-extension=/Users/charlie/Documents/python/浏览器插件/NqiTool",
            "--no-sandbox",
            "--disable-setuid-sandbox",
        ]
    )
    
    page = browser.new_page()
    page.goto("https://nqi.gmcc.net")
    
    # ... 你的其他代码 ...
    
    browser.close()
`

// ============================================================
// Node.js 示例 (修改你的现有脚本)
// ============================================================

NODEJS_TEMPLATE = `\
// 在你的 playwright 启动代码中添加 args 参数

const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({
        headless: false,  // 注意：扩展不支持无头模式
        args: [
            "--disable-extensions-except=/Users/charlie/Documents/python/浏览器插件/NqiTool",
            "--load-extension=/Users/charlie/Documents/python/浏览器插件/NqiTool",
            "--no-sandbox",
            "--disable-setuid-sandbox",
        ]
    });
    
    const page = await browser.newPage();
    await page.goto("https://nqi.gmcc.net");
    
    // ... 你的其他代码 ...
    
    await browser.close();
})();
`

console.log('='.repeat(60));
console.log('Playwright 加载扩展插件的核心参数');
console.log('='.repeat(60));
console.log('');
console.log('只需要在你的 launch() 或 launchPersistentContext() 中添加:');
console.log('');
console.log('args: [');
console.log('    "--disable-extensions-except=/path/to/NqiTool",');
console.log('    "--load-extension=/path/to/NqiTool",');
console.log('    "--no-sandbox",');
console.log(']');
console.log('');
console.log('='.repeat(60));
console.log('');
console.log(PYTHON_TEMPLATE);
console.log('');
console.log('='.repeat(60));
console.log('');
console.log(NODEJS_TEMPLATE);
