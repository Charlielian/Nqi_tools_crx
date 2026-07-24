# NqiTool - 查询数据导出工具

一款 Chrome 扩展（Manifest V3），为查询平台即席查询模块提供**一键导出全部数据**为 Excel / CSV 的能力，突破平台自带分页限制，实现全量数据抓取。

## 功能特性

- **全量数据导出** — 自动分页抓取所有数据，不受平台分页条数限制
- **双格式输出** — 支持 Excel（.xlsx）和 CSV 格式导出
- **实时进度追踪** — 侧边栏和弹窗中实时显示导出进度
- **智能请求拦截** — 通过拦截 jQuery AJAX / Fetch / XHR 请求自动捕获查询参数
- **数据去重** — 导出过程中自动对数据进行去重处理
- **诊断工具** — 内置页面诊断功能，可在控制台运行 `NQIExport_Diagnose()` 获取分析报告
- **导出日志** — 支持导出详细日志，方便排查问题
- **Playwright 自动化集成** — 可配合 Playwright 在自动化流程中使用

## 系统架构

### 整体架构

```
┌─────────────────────────────────────────────────────┐
│                   浏览器扩展                          │
│                                                     │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Popup/    │  │ Side Panel   │  │ Content Script│  │
│  │ Popup.html│  │ sidebar.html │  │  content.js   │  │
│  │ popup.js  │  │ sidebar.js   │  │               │  │
│  └─────┬─────┘  └──────┬───────┘  └───────┬───────┘  │
│        │               │                  │          │
│        └───────┬───────┘                  │          │
│                │   Chrome Message API     │          │
│                │                          │          │
│  ┌─────────────▼──────────────────────────▼───────┐  │
│  │          Background Service Worker               │  │
│  │              background.js                        │  │
│  │  · XLSX 库加载与 Excel 生成                       │  │
│  │  · 文件下载管理                                    │  │
│  │  · 进度状态管理                                    │  │
│  │  · 消息路由中转                                    │  │
│  └─────────────────────────────────────────────────┘  │
│                        │                              │
│  ┌─────────────────────▼──────────────────────────┐  │
│  │              SheetJS (xlsx.full.min.js)           │  │
│  │         Excel 文件生成引擎（本地库）                │  │
│  └─────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────┐
│   目标大数据平台           │
│  (通过 Host Permissions   │
│   注入 Content Script)    │
└──────────────────────────┘
```

### 核心组件说明

| 组件 | 文件 | 职责 |
|------|------|------|
| **Content Script** | `content.js` | 注入目标页面，拦截网络请求，提取表格数据，执行分页抓取 |
| **Background** | `background.js` | Service Worker，负责 XLSX 库加载、Excel 文件生成和下载 |
| **Popup** | `popup.html` + `popup.js` | 点击扩展图标弹出的小窗口，显示数据概览和导出按钮 |
| **Side Panel** | `sidebar.html` + `sidebar.js` | 侧边栏面板，提供更宽敞的操作界面和进度展示 |
| **Excel Generator** | `utils/xlsx-generator.js` | Excel 生成工具模块，封装 SheetJS 操作 |
| **样式** | `styles/export-button.css` | 注入页面的导出按钮和通知样式 |
| **XLSX 库** | `lib/xlsx.full.min.js` | SheetJS 库的本地副本，用于生成 .xlsx 文件 |

## 工作原理

### 数据抓取流程

```
1. 用户在目标平台执行即席查询
       │
       ▼
2. Content Script 拦截平台发出的 AJAX/Fetch/XHR 请求
   (installJQueryInterceptor + fetch/XHR 拦截器)
       │
       ▼
3. 从请求中提取查询参数:
   · result  — 查询字段配置
   · where   — 查询过滤条件
   · 其他分页参数 (draw, start, length 等)
       │
       ▼
4. 用户点击"导出"按钮
       │
       ▼
5. 使用捕获的参数，自动分页请求所有数据
   · 每页请求 PAGE_SIZE(200) 条
   · 支持失败重试 (MAX_RETRIES: 3)
   · 实时更新进度
       │
       ▼
6. 数据汇总与去重
       │
       ▼
7. 发送到 Background 生成 Excel/CSV 文件
       │
       ▼
8. 通过 Chrome Downloads API 触发文件下载
```

### 请求拦截机制

Content Script 采用**三层拦截**策略，确保捕获所有 API 请求：

1. **jQuery AJAX 拦截** — 覆写 `jQuery.ajax` 方法，拦截 jQuery 发出的请求
2. **Fetch API 拦截** — 覆写 `window.fetch`，拦截原生 Fetch 请求
3. **XMLHttpRequest 拦截** — 覆写 `XMLHttpRequest.prototype.open/send`，拦截 XHR 请求

所有拦截器仅在匹配目标平台 API 路径时生效，不影响其他网络请求。

### 消息通信机制

```
Content Script ◄──► Background ◄──► Popup / Side Panel
     │                    │                    │
     │  chrome.tabs       │  chrome.runtime    │
     │  .sendMessage       │  .onMessage       │
     │                    │                    │
     │  主要消息类型:       │                    │
     │  · getTableInfo     │                    │
     │  · startExport      │                    │
     │  · getExportProgress│                    │
     │  · generateXlsx     │                    │
     │  · dataDetected     │                    │
```

## 文件结构

```
NqiTool/
├── manifest.json            # Chrome 扩展清单 (Manifest V3)
├── background.js           # Background Service Worker
├── content.js               # Content Script (注入目标页面)
├── popup.html / popup.js    # Popup 弹窗界面
├── sidebar.html / sidebar.js # 侧边栏面板界面
├── styles/
│   └── export-button.css    # 注入页面的 UI 样式
├── utils/
│   └── xlsx-generator.js   # Excel 生成工具模块
├── lib/
│   └── xlsx.full.min.js     # SheetJS 库 (本地)
├── icons/                   # 扩展图标
├── pack_crx.py              # CRX 打包脚本 (开发用)
├── playwright-extension-args.js # Playwright 集成示例
└── .gitignore
```

## 安装方法

### 方式一：Chrome 开发者模式加载

1. 打开 Chrome，进入 `chrome://extensions/`
2. 开启**开发者模式**
3. 点击**加载已解压的扩展程序**
4. 选择 `NqiTool` 文件夹
5. 扩展即安装完成

### 方式二：Playwright 自动化集成

在 Playwright 脚本中加载此扩展：

```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=False,  # 扩展不支持无头模式
        args=[
            "--disable-extensions-except=/path/to/NqiTool",
            "--load-extension=/path/to/NqiTool",
            "--no-sandbox",
            "--disable-setuid-sandbox",
        ]
    )
    page = browser.new_page()
    page.goto("<TARGET_PLATFORM_URL>")
    # ... 自动化操作 ...
    browser.close()
```

> **注意**: Chrome 扩展不支持无头模式，需使用 `headless=False`。

## 使用方法

1. 安装扩展后，导航至目标大数据平台的即席查询页面
2. 执行一次查询操作（扩展会自动拦截并捕获查询参数）
3. 点击浏览器工具栏中的扩展图标，或打开侧边栏
4. 扩展会自动检测当前页面的数据表格
5. 检测到数据后，点击 **导出 Excel** 或 **导出 CSV** 按钮
6. 等待进度完成，文件将自动下载

## 诊断与调试

在目标页面打开浏览器开发者工具控制台，运行：

```javascript
NQIExport_Diagnose()
```

此命令会输出页面结构诊断报告，包括：
- DataTables 分析
- 分页控件状态
- 表格数据信息
- 插件捕获的请求参数
- 导出建议

## 依赖

| 依赖 | 用途 | 来源 |
|------|------|------|
| [SheetJS (xlsx)] | Excel 文件生成 | 本地打包 (`lib/xlsx.full.min.js`) |

无其他外部运行时依赖。所有功能均在浏览器本地完成。

## 技术栈

- **扩展规范**: Chrome Extensions Manifest V3
- **前端**: 原生 HTML / CSS / JavaScript（无框架依赖）
- **Excel 生成**: SheetJS (xlsx)
- **UI 风格**: Catppuccin Mocha 配色方案

## 版本

当前版本: `v1.4.1`

## 许可证

本项目仅供学习和内部使用。
