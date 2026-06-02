#!/usr/bin/env python3
"""
NQI Playwright 自动化脚本
用于录制 HAR 文件和导出 NQI 数据

使用方法:
    python nqi_playwright_recorder.py --url "https://nqi.gmcc.net/pro-adhoc/adhocquery" --output ./log
"""

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime
from pathlib import Path

# 添加当前目录到路径
sys.path.insert(0, str(Path(__file__).parent))

from playwright.async_api import async_playwright


class HARRecorder:
    """HAR 录制器"""
    
    def __init__(self):
        self.entries = []
        self.start_time = None
        
    def start(self):
        self.start_time = datetime.now()
        self.entries = []
        
    def add_entry(self, request, response, timing=None):
        """添加 HAR 条目"""
        entry = {
            "startedDateTime": self.start_time.isoformat(),
            "time": 0,
            "request": {
                "method": request.method,
                "url": str(request.url),
                "httpVersion": "HTTP/1.1",
                "cookies": [],
                "headers": [],
                "queryString": [],
                "headersSize": -1,
                "bodySize": len(request.post_data or ''),
                "postData": {
                    "mimeType": request.headers.get('content-type', ''),
                    "text": request.post_data or ''
                } if request.post_data else {}
            },
            "response": {
                "status": response.status,
                "statusText": response.status_text,
                "httpVersion": "HTTP/1.1",
                "cookies": [],
                "headers": [],
                "redirectURL": "",
                "headersSize": -1,
                "bodySize": len(response.body or ''),
                "content": {
                    "size": len(response.body or ''),
                    "compression": 0,
                    "mimeType": response.headers.get('content-type', ''),
                    "text": response.body.decode('utf-8', errors='replace') if response.body else ''
                }
            },
            "cache": {},
            "timings": {
                "send": 0,
                "wait": timing or 0,
                "receive": 0
            }
        }
        self.entries.append(entry)
        
    def save(self, filepath):
        """保存 HAR 文件"""
        har = {
            "log": {
                "version": "1.2",
                "creator": {
                    "name": "NQI Playwright Recorder",
                    "version": "1.0"
                },
                "entries": self.entries
            }
        }
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(har, f, ensure_ascii=False, indent=2)
        print(f"[HAR] 已保存到: {filepath}")


async def create_browser_with_extension(extension_path: str, user_data_dir: str = None, headless: bool = False):
    """
    创建带扩展插件的浏览器上下文
    
    关键点:
    - 使用 launchPersistentContext，不是普通 launch
    - headless 必须为 False
    - args 需要加 --disable-extensions-except 和 --load-extension
    """
    if user_data_dir is None:
        user_data_dir = f'./temp-user-data-{datetime.now().strftime("%Y%m%d%H%M%S")}'
    
    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(
            user_data_dir=user_data_dir,
            headless=headless,
            args=[
                '--disable-extensions-except=' + extension_path,
                '--load-extension=' + extension_path,
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
            ],
            timeout=60000
        )
        
        return context


async def intercept_and_record(context, recorder: HARRecorder, target_domains: list = None):
    """
    拦截请求并录制 HAR
    
    Args:
        context: Playwright 浏览器上下文
        recorder: HAR 录制器
        target_domains: 目标域名列表，如 ['nqi.gmcc.net']
    """
    if target_domains is None:
        target_domains = ['nqi.gmcc.net']
    
    recorder.start()
    
    def should_record(url):
        """判断是否应该录制"""
        for domain in target_domains:
            if domain in url:
                return True
        return False
    
    async def handle_request(request):
        """处理请求"""
        try:
            response = await request.response()
            if response and should_record(str(request.url)):
                recorder.add_entry(request, response)
        except Exception as e:
            pass
    
    context.on('request', handle_request)


async def main():
    parser = argparse.ArgumentParser(description='NQI Playwright 自动化工具')
    parser.add_argument('--url', '-u', default='https://nqi.gmcc.net/pro-adhoc/adhocquery',
                        help='目标 URL')
    parser.add_argument('--output', '-o', default='./log',
                        help='输出目录')
    parser.add_argument('--extension', '-e', default=None,
                        help='扩展插件目录')
    parser.add_argument('--headless', action='store_true',
                        help='使用无头模式 (注意: 扩展不支持无头)')
    parser.add_argument('--user-data', '-d', default=None,
                        help='用户数据目录')
    parser.add_argument('--domain', default='nqi.gmcc.net',
                        help='录制的目标域名')
    parser.add_argument('--no-extension', action='store_true',
                        help='不加载扩展插件')
    
    args = parser.parse_args()
    
    # 扩展路径
    if args.no_extension:
        extension_path = None
    elif args.extension:
        extension_path = args.extension
    else:
        extension_path = str(Path(__file__).parent.resolve())
    
    # 创建输出目录
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    print("=" * 60)
    print("NQI Playwright 自动化工具")
    print("=" * 60)
    print(f"目标 URL: {args.url}")
    print(f"扩展插件: {extension_path or '未加载'}")
    print(f"输出目录: {output_dir}")
    print("=" * 60)
    
    # 创建 HAR 录制器
    recorder = HARRecorder()
    
    # 创建浏览器
    if extension_path:
        context = await create_browser_with_extension(
            extension_path=extension_path,
            user_data_dir=args.user_data,
            headless=args.headless
        )
    else:
        async with async_playwright() as p:
            context = await p.chromium.launch_persistent_context(
                user_data_dir=args.user_data or './temp-user-data',
                headless=args.headless,
                timeout=60000
            )
    
    # 开始录制
    await intercept_and_record(context, recorder, [args.domain])
    
    # 获取页面
    page = context.pages[0] if context.pages else await context.new_page()
    
    # 打开 URL
    print(f"\n正在打开: {args.url}")
    await page.goto(args.url, wait_until='domcontentloaded', timeout=60000)
    print("页面已加载")
    
    # 生成文件名
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    domain_name = args.domain.replace('.', '_')
    har_path = output_dir / f'{domain_name}.{timestamp}.har'
    
    # 等待一段时间让请求完成
    print("\n等待请求完成...")
    print("(按 Ctrl+C 停止录制并保存)")
    
    try:
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        print("\n正在保存 HAR 文件...")
    
    # 保存 HAR
    recorder.save(str(har_path))
    
    # 关闭
    print("\n正在关闭浏览器...")
    await context.close()
    print("完成!")


# ========== Python 示例代码 ==========

PYTHON_EXAMPLE = '''
# Python 示例 - 直接复制使用

from playwright.async_api import async_playwright
from pathlib import Path

async def main():
    # 扩展插件目录
    EXTENSION_PATH = '/path/to/NqiTool'
    
    async with async_playwright() as p:
        # 关键点：使用 launchPersistentContext
        context = await p.chromium.launch_persistent_context(
            user_data_dir='./temp-user-data',
            headless=False,  # 必须 False，插件不支持无头
            args=[
                '--disable-extensions-except=' + EXTENSION_PATH,
                '--load-extension=' + EXTENSION_PATH,
                '--no-sandbox',
                '--disable-setuid-sandbox',
            ],
            timeout=60000
        )
        
        # 获取页面
        page = context.pages[0] if context.pages else await context.new_page()
        
        # 打开 NQI 网站
        await page.goto('https://nqi.gmcc.net/pro-adhoc/adhocquery')
        
        # 等待加载
        await page.wait_for_load_state('networkidle')
        
        print(f"当前 URL: {page.url}")
        
        # 保持打开状态
        input("按回车键关闭...")
        
        await context.close()

# 运行
asyncio.run(main())
'''


# ========== Node.js 示例代码 ==========

NODEJS_EXAMPLE = '''
// Node.js 示例 - 直接复制使用

const { chromium } = require('playwright');

async function main() {
    // 扩展插件目录
    const EXTENSION_PATH = '/path/to/NqiTool';
    
    // 关键点：使用 launchPersistentContext
    const context = await chromium.launchPersistentContext(
        './temp-user-data',
        {
            headless: false,  // 必须 false，插件不支持无头
            args: [
                '--disable-extensions-except=' + EXTENSION_PATH,
                '--load-extension=' + EXTENSION_PATH,
                '--no-sandbox',
                '--disable-setuid-sandbox',
            ],
            timeout: 60000
        }
    );
    
    // 获取页面
    const page = context.pages()[0] || await context.newPage();
    
    // 打开 NQI 网站
    await page.goto('https://nqi.gmcc.net/pro-adhoc/adhocquery');
    
    // 等待加载
    await page.waitForLoadState('networkidle');
    
    console.log('当前 URL:', page.url());
    
    // 保持打开状态
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('按回车键关闭...', () => {
        rl.close();
        context.close();
    });
}

main().catch(console.error);
'''


if __name__ == '__main__':
    # 检查是否有命令行参数
    if len(sys.argv) > 1:
        asyncio.run(main())
    else:
        # 显示帮助信息
        print(__doc__)
        print("\n" + "=" * 60)
        print("使用示例:")
        print("=" * 60)
        print("\n1. 录制 HAR 文件:")
        print("   python nqi_playwright_recorder.py --url 'https://nqi.gmcc.net/pro-adhoc/adhocquery'")
        print("\n2. 指定输出目录:")
        print("   python nqi_playwright_recorder.py -o ./my-log")
        print("\n3. 指定扩展目录:")
        print("   python nqi_playwright_recorder.py -e /path/to/NqiTool")
        print("\n4. 不加载扩展:")
        print("   python nqi_playwright_recorder.py --no-extension")
        print("\n" + "=" * 60)
        print("\nPython 代码示例:")
        print("=" * 60)
        print(PYTHON_EXAMPLE)
