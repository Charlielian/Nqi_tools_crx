#!/usr/bin/env python3
"""
Playwright 浏览器扩展加载器
用于在 Playwright 中加载 NqiTool 扩展插件

使用方法:
    from nqi_playwright import create_browser_with_extension
    browser, context, page = await create_browser_with_extension(url='https://nqi.gmcc.net')

    # 或者直接运行
    python nqi_playwright.py
"""

import asyncio
import os
from pathlib import Path
from playwright.async_api import async_playwright


# 扩展插件目录
EXTENSION_PATH = Path(__file__).parent.resolve()

# 默认测试 URL
DEFAULT_URL = 'https://nqi.gmcc.net/pro-adhoc/adhocquery'


async def create_browser_with_extension(
    extension_path: str = None,
    url: str = None,
    headless: bool = False,  # 插件不支持无头模式
    timeout: int = 60000,
    user_data_dir: str = None,
    **kwargs
):
    """
    创建带扩展插件的浏览器上下文
    
    关键点:
    - 使用 launchPersistentContext，不是普通 launch
    - headless 必须为 False
    - args 需要加 --disable-extensions-except 和 --load-extension
    
    Args:
        extension_path: 扩展插件目录路径，默认使用当前目录
        url: 初始打开的 URL
        headless: 必须为 False，扩展不支持无头模式
        timeout: 超时时间(毫秒)
        user_data_dir: 用户数据目录
        **kwargs: 传递给 launch_persistent_context 的其他参数
    
    Returns:
        (context, page) 元组
    """
    if extension_path is None:
        extension_path = str(EXTENSION_PATH)
    
    if user_data_dir is None:
        user_data_dir = f'./temp-user-data-{id(asyncio.current_task())}'
    
    if not headless:
        print(f"[NQI Playwright] 加载扩展: {extension_path}")
    
    async with async_playwright() as p:
        # 使用 launch_persistent_context 加载扩展
        # 关键点：必须用 launchPersistentContext，不能用 launch
        context = await p.chromium.launch_persistent_context(
            user_data_dir=user_data_dir,
            headless=headless,  # 必须 False，插件不支持无头
            args=[
                '--disable-extensions-except=' + extension_path,  # 只启用指定扩展
                '--load-extension=' + extension_path,  # 加载扩展
                '--no-sandbox',  # 容器环境需要
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
            ],
            timeout=timeout,
            **kwargs
        )
        
        page = context.pages[0] if context.pages else await context.new_page()
        
        if url and page:
            await page.goto(url, wait_until='domcontentloaded', timeout=timeout)
        
        return context, page


async def main():
    """主函数 - 直接运行脚本时执行"""
    print("=" * 60)
    print("NQI Playwright 扩展加载器")
    print("=" * 60)
    
    # 创建带扩展的浏览器
    context, page = await create_browser_with_extension(
        url=DEFAULT_URL,
        headless=False
    )
    
    print(f"[NQI Playwright] 浏览器已启动")
    print(f"[NQI Playwright] 页面数: {len(context.pages)}")
    
    if page:
        print(f"[NQI Playwright] 当前页面 URL: {page.url}")
    
    print("\n按 Ctrl+C 退出...")
    print("=" * 60)
    
    try:
        # 保持浏览器打开
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        print("\n[NQI Playwright] 正在关闭浏览器...")
        await context.close()
        print("[NQI Playwright] 浏览器已关闭")


# ========== 使用示例 ==========

EXAMPLE_CODE = '''
# ========================================
# 快速使用示例
# ========================================

# 方式1: 直接运行脚本
# python nqi_playwright.py

# 方式2: 作为模块导入
# from nqi_playwright import create_browser_with_extension
# 
# async def main():
#     context, page = await create_browser_with_extension(
#         url='https://nqi.gmcc.net/pro-adhoc/adhocquery'
#     )
#     # ... 你的操作 ...
#     await context.close()
#
# asyncio.run(main())

# ========================================
# 核心参数说明
# ========================================

# 1. extension_path: 扩展目录
#    - 默认使用 nqi_playwright.py 所在目录
#    - 可以手动指定其他目录

# 2. headless: 必须为 False
#    - 浏览器扩展不支持无头模式
#    - 设置为 True 会报错

# 3. user_data_dir: 用户数据目录
#    - 默认为 ./temp-user-data-{task_id}
#    - 建议使用固定目录避免重复创建

# 4. timeout: 超时时间
#    - 默认 60000ms (60秒)

# ========================================
# 完整示例代码
# ========================================

async def example():
    from nqi_playwright import create_browser_with_extension
    
    # 创建浏览器
    context, page = await create_browser_with_extension(
        url='https://nqi.gmcc.net/pro-adhoc/adhocquery',
        user_data_dir='./nqi-browser-data'  # 固定目录
    )
    
    try:
        # 等待页面加载
        await page.wait_for_load_state('networkidle')
        
        # 获取页面标题
        title = await page.title()
        print(f"页面标题: {title}")
        
        # 等待用户输入
        input("\\n按回车键关闭浏览器...")
        
    finally:
        await context.close()

asyncio.run(example())
'''


if __name__ == '__main__':
    print("=" * 60)
    print("NQI Playwright 扩展加载器")
    print("=" * 60)
    print(EXAMPLE_CODE)
    
    # 检查 playwright 是否安装
    try:
        import playwright
        print(f"Playwright 版本: {playwright.__version__}")
    except ImportError:
        print("错误: 请先安装 playwright")
        print("  pip install playwright")
        print("  playwright install chromium")
        sys.exit(1)
    
    print("\n" + "=" * 60)
    print("正在启动浏览器...")
    print("=" * 60)
    
    asyncio.run(main())
