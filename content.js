/**
 * 大数据平台数据导出工具 - Content Script
 * 借鉴 scrape-similar 的专业 UI 设计
 * 自动检测页面数据表格，注入导出面板，支持导出全部分页数据
 */

(function() {
    'use strict';

    const CONFIG = {
        API_BASE: 'https://nqi.gmcc.net:20443/pro-adhoc/adhocquery',
        PAGE_SIZE: 200,
        MAX_RETRIES: 3,
        AUTO_DETECT_INTERVAL: 2000,
        DEFAULT_COLUMNS: [
            'starttime', 'cgi', 'cell_name', 'city', 'branch', 'network_type',
            'state', 'cover_type', 'succconnestab', 'attconnestab',
            'nbrsuccestab', 'nbrattestab', 'succexecinc', 'ho_succ_out',
            'ho_att__out', 'hofail', 'nbrreqrelenb_normal', 'nbrreqrelenb',
            'nbrleft', 'nbrhoinc'
        ]
    };

    let tableMeta = null;
    let exportButton = null;
    let isExporting = false;
    let currentTableData = null;
    let hasDetectedData = false;
    let exportPanel = null;

    // ========== 核心初始化 ==========

    function init() {
        if (window.location.pathname.includes('/adhocquery')) {
            injectStyles();
            startAutoDetection();
        }
    }

    // ========== 样式注入 ==========

    function injectStyles() {
        const style = document.createElement('style');
        style.id = 'nqi-export-styles';
        style.textContent = `
            /* NQI Export Tool - Professional Panel Styles */
            .nqi-panel {
                position: fixed;
                bottom: 24px;
                right: 24px;
                width: 360px;
                background: #1a1a2e;
                border-radius: 16px;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
                z-index: 999999;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                overflow: hidden;
                animation: nqiSlideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            }

            @keyframes nqiSlideUp {
                from { opacity: 0; transform: translateY(40px) scale(0.95); }
                to { opacity: 1; transform: translateY(0) scale(1); }
            }

            @keyframes nqiPulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.05); }
            }

            @keyframes nqiSpin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }

            @keyframes nqiShimmer {
                0% { background-position: -200% 0; }
                100% { background-position: 200% 0; }
            }

            .nqi-panel-header {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                padding: 16px 20px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                cursor: move;
            }

            .nqi-panel-title {
                display: flex;
                align-items: center;
                gap: 10px;
            }

            .nqi-panel-title svg {
                width: 24px;
                height: 24px;
                fill: white;
            }

            .nqi-panel-title span {
                color: white;
                font-size: 16px;
                font-weight: 600;
            }

            .nqi-panel-badge {
                background: rgba(255, 255, 255, 0.2);
                color: white;
                padding: 4px 10px;
                border-radius: 20px;
                font-size: 12px;
                font-weight: 500;
            }

            .nqi-panel-close {
                width: 28px;
                height: 28px;
                border: none;
                background: rgba(255, 255, 255, 0.15);
                border-radius: 8px;
                color: white;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s;
            }

            .nqi-panel-close:hover {
                background: rgba(255, 255, 255, 0.3);
                transform: scale(1.1);
            }

            .nqi-panel-body {
                padding: 20px;
            }

            .nqi-stats-grid {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 12px;
                margin-bottom: 20px;
            }

            .nqi-stat-card {
                background: #16213e;
                border-radius: 12px;
                padding: 14px;
                text-align: center;
            }

            .nqi-stat-value {
                font-size: 24px;
                font-weight: 700;
                color: #667eea;
                margin-bottom: 4px;
            }

            .nqi-stat-label {
                font-size: 11px;
                color: #8892b0;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .nqi-info-row {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 12px 14px;
                background: #16213e;
                border-radius: 10px;
                margin-bottom: 12px;
            }

            .nqi-info-icon {
                width: 36px;
                height: 36px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                border-radius: 10px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 16px;
            }

            .nqi-info-content {
                flex: 1;
            }

            .nqi-info-title {
                font-size: 13px;
                color: #ccd6f6;
                font-weight: 500;
            }

            .nqi-info-value {
                font-size: 11px;
                color: #8892b0;
                margin-top: 2px;
            }

            .nqi-export-options {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px;
                margin-bottom: 16px;
            }

            .nqi-export-btn {
                padding: 14px 16px;
                border: none;
                border-radius: 12px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            }

            .nqi-export-btn:hover:not(:disabled) {
                transform: translateY(-2px);
            }

            .nqi-export-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            .nqi-btn-primary {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
            }

            .nqi-btn-primary:hover:not(:disabled) {
                box-shadow: 0 8px 20px rgba(102, 126, 234, 0.4);
            }

            .nqi-btn-secondary {
                background: #16213e;
                color: #ccd6f6;
                border: 1px solid #2a3f5f;
            }

            .nqi-btn-secondary:hover:not(:disabled) {
                background: #1a2a4a;
                border-color: #667eea;
            }

            .nqi-btn-full {
                grid-column: span 2;
            }

            .nqi-progress-container {
                background: #16213e;
                border-radius: 12px;
                padding: 16px;
                margin-bottom: 16px;
                display: none;
            }

            .nqi-progress-container.active {
                display: block;
            }

            .nqi-progress-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 12px;
            }

            .nqi-progress-title {
                font-size: 13px;
                color: #ccd6f6;
                font-weight: 500;
            }

            .nqi-progress-percent {
                font-size: 13px;
                color: #667eea;
                font-weight: 600;
            }

            .nqi-progress-bar {
                height: 8px;
                background: #0f172a;
                border-radius: 4px;
                overflow: hidden;
            }

            .nqi-progress-fill {
                height: 100%;
                background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
                border-radius: 4px;
                transition: width 0.3s ease;
                position: relative;
                overflow: hidden;
            }

            .nqi-progress-fill::after {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
                animation: nqiShimmer 1.5s infinite;
                background-size: 200% 100%;
            }

            .nqi-progress-detail {
                margin-top: 10px;
                font-size: 11px;
                color: #8892b0;
                display: flex;
                justify-content: space-between;
            }

            .nqi-preview-toggle {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 12px 14px;
                background: #16213e;
                border-radius: 10px;
                cursor: pointer;
                margin-bottom: 12px;
            }

            .nqi-preview-toggle:hover {
                background: #1a2a4a;
            }

            .nqi-preview-toggle span {
                font-size: 13px;
                color: #ccd6f6;
            }

            .nqi-preview-toggle .nqi-toggle-icon {
                color: #667eea;
                font-size: 12px;
                transition: transform 0.2s;
            }

            .nqi-preview-container {
                max-height: 0;
                overflow: hidden;
                transition: max-height 0.3s ease;
            }

            .nqi-preview-container.expanded {
                max-height: 300px;
                margin-bottom: 12px;
            }

            .nqi-preview-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 11px;
                background: #16213e;
                border-radius: 10px;
                overflow: hidden;
            }

            .nqi-preview-table th {
                background: #0f172a;
                color: #8892b0;
                padding: 8px 10px;
                text-align: left;
                font-weight: 500;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 100px;
            }

            .nqi-preview-table td {
                padding: 8px 10px;
                color: #ccd6f6;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 100px;
                border-top: 1px solid #1a2a4a;
            }

            .nqi-preview-table tr:hover td {
                background: #1a2a4a;
            }

            .nqi-panel-footer {
                padding: 12px 20px;
                background: #0f172a;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .nqi-footer-hint {
                font-size: 11px;
                color: #5a6a8a;
            }

            .nqi-footer-version {
                font-size: 10px;
                color: #4a5a7a;
            }

            /* Loading spinner */
            .nqi-spinner {
                width: 18px;
                height: 18px;
                border: 2px solid rgba(255,255,255,0.3);
                border-top-color: white;
                border-radius: 50%;
                animation: nqiSpin 0.8s linear infinite;
            }

            /* Toast notifications */
            .nqi-toast {
                position: fixed;
                top: 24px;
                right: 24px;
                padding: 14px 20px;
                background: #1a1a2e;
                border-radius: 12px;
                color: white;
                font-size: 14px;
                box-shadow: 0 10px 40px rgba(0,0,0,0.3);
                z-index: 1000000;
                display: flex;
                align-items: center;
                gap: 12px;
                animation: nqiSlideUp 0.3s ease;
            }

            .nqi-toast.success {
                border-left: 4px solid #10b981;
            }

            .nqi-toast.error {
                border-left: 4px solid #ef4444;
            }

            .nqi-toast.info {
                border-left: 4px solid #667eea;
            }

            /* Mini badge on page button */
            .nqi-btn-with-badge {
                position: relative;
            }

            .nqi-btn-badge {
                position: absolute;
                top: -6px;
                right: -6px;
                background: #ef4444;
                color: white;
                font-size: 10px;
                padding: 2px 6px;
                border-radius: 10px;
                font-weight: 600;
                animation: nqiPulse 2s infinite;
            }
        `;
        document.head.appendChild(style);
    }

    // ========== 自动检测 ==========

    function startAutoDetection() {
        const observer = new MutationObserver(() => {
            checkAndShowExportPanel();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        setInterval(() => {
            checkAndShowExportPanel();
        }, CONFIG.AUTO_DETECT_INTERVAL);
    }

    function checkAndShowExportPanel() {
        const tableWrapper = document.querySelector('.dataTables_wrapper');
        const tableInfo = document.querySelector('.dataTables_info');
        const tableBody = document.querySelector('.dataTables_wrapper tbody');

        if (!tableWrapper || !tableInfo || !tableBody) {
            return;
        }

        const rows = tableBody.querySelectorAll('tr');
        if (rows.length === 0) {
            return;
        }

        const infoText = tableInfo.textContent;
        const match = infoText.match(/共\s*(\d+)/);
        if (!match) {
            return;
        }

        const totalRows = parseInt(match[1]);
        if (totalRows === 0) {
            return;
        }

        if (!hasDetectedData) {
            hasDetectedData = true;
            showExportPanel(totalRows);
            injectPageExportButton();
        } else {
            updatePanelStats(totalRows);
        }
    }

    // ========== 导出面板 ==========

    function showExportPanel(totalRows) {
        if (exportPanel) {
            exportPanel.style.display = 'block';
            updatePanelStats(totalRows);
            return;
        }

        exportPanel = document.createElement('div');
        exportPanel.className = 'nqi-panel';
        exportPanel.innerHTML = createPanelHTML(totalRows);
        document.body.appendChild(exportPanel);

        bindPanelEvents();
    }

    function createPanelHTML(totalRows) {
        const tableName = extractTableName();
        const columns = getColumnNames();

        return `
            <div class="nqi-panel-header">
                <div class="nqi-panel-title">
                    <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                    <span>数据导出工具</span>
                </div>
                <div class="nqi-panel-badge">${totalRows} 条</div>
                <button class="nqi-panel-close" id="nqi-close-panel">✕</button>
            </div>

            <div class="nqi-panel-body">
                <div class="nqi-stats-grid">
                    <div class="nqi-stat-card">
                        <div class="nqi-stat-value" id="nqi-stat-total">${totalRows}</div>
                        <div class="nqi-stat-label">总记录</div>
                    </div>
                    <div class="nqi-stat-card">
                        <div class="nqi-stat-value" id="nqi-stat-fetched">0</div>
                        <div class="nqi-stat-label">已获取</div>
                    </div>
                    <div class="nqi-stat-card">
                        <div class="nqi-stat-value" id="nqi-stat-cols">${columns.length}</div>
                        <div class="nqi-stat-label">字段数</div>
                    </div>
                </div>

                <div class="nqi-info-row">
                    <div class="nqi-info-icon">📊</div>
                    <div class="nqi-info-content">
                        <div class="nqi-info-title">${tableName}</div>
                        <div class="nqi-info-value">${columns.slice(0, 3).join(', ')}${columns.length > 3 ? '...' : ''}</div>
                    </div>
                </div>

                <div class="nqi-progress-container" id="nqi-progress">
                    <div class="nqi-progress-header">
                        <span class="nqi-progress-title">导出进度</span>
                        <span class="nqi-progress-percent" id="nqi-progress-percent">0%</span>
                    </div>
                    <div class="nqi-progress-bar">
                        <div class="nqi-progress-fill" id="nqi-progress-fill" style="width: 0%"></div>
                    </div>
                    <div class="nqi-progress-detail">
                        <span id="nqi-progress-fetched">0 条</span>
                        <span id="nqi-progress-status">准备中...</span>
                    </div>
                </div>

                <div class="nqi-export-options">
                    <button class="nqi-export-btn nqi-btn-primary" id="nqi-export-excel">
                        <span>📈</span> 导出 Excel
                    </button>
                    <button class="nqi-export-btn nqi-btn-secondary" id="nqi-export-csv">
                        <span>📄</span> 导出 CSV
                    </button>
                    <button class="nqi-export-btn nqi-btn-secondary nqi-btn-full" id="nqi-preview-toggle">
                        <span>👁️</span> 预览数据 (前5条)
                    </button>
                </div>

                <div class="nqi-preview-container" id="nqi-preview-container">
                    <table class="nqi-preview-table">
                        <thead id="nqi-preview-header"></thead>
                        <tbody id="nqi-preview-body"></tbody>
                    </table>
                </div>
            </div>

            <div class="nqi-panel-footer">
                <span class="nqi-footer-hint">支持自动分页导出全量数据</span>
                <span class="nqi-footer-version">v1.1</span>
            </div>
        `;
    }

    function bindPanelEvents() {
        document.getElementById('nqi-close-panel').addEventListener('click', () => {
            if (exportPanel) {
                exportPanel.style.display = 'none';
            }
        });

        document.getElementById('nqi-export-excel').addEventListener('click', () => {
            startExport('xlsx');
        });

        document.getElementById('nqi-export-csv').addEventListener('click', () => {
            startExport('csv');
        });

        document.getElementById('nqi-preview-toggle').addEventListener('click', () => {
            togglePreview();
        });
    }

    function updatePanelStats(totalRows) {
        if (!exportPanel) return;

        const statTotal = document.getElementById('nqi-stat-total');
        const badge = exportPanel.querySelector('.nqi-panel-badge');

        if (statTotal) statTotal.textContent = totalRows;
        if (badge) badge.textContent = totalRows + ' 条';
    }

    // ========== 页面按钮 ==========

    function injectPageExportButton() {
        if (exportButton) return;

        const container = document.querySelector('.panel-heading') ||
                        document.querySelector('.box-header') ||
                        document.querySelector('.dataTables_wrapper');

        if (!container) return;

        exportButton = document.createElement('button');
        exportButton.className = 'nqi-btn-with-badge';
        exportButton.id = 'nqi-page-export-btn';
        exportButton.innerHTML = `
            <span style="font-size:14px;margin-right:6px;">📊</span>
            <span>导出全部</span>
        `;
        exportButton.style.cssText = `
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 8px;
            padding: 8px 16px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            margin-left: 10px;
            transition: all 0.3s ease;
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
        `;

        exportButton.addEventListener('click', () => {
            if (exportPanel) {
                exportPanel.style.display = 'block';
                exportPanel.scrollIntoView({ behavior: 'smooth' });
            }
        });

        exportButton.addEventListener('mouseenter', () => {
            exportButton.style.transform = 'translateY(-2px)';
            exportButton.style.boxShadow = '0 6px 20px rgba(102, 126, 234, 0.4)';
        });

        exportButton.addEventListener('mouseleave', () => {
            exportButton.style.transform = 'translateY(0)';
        });

        if (container.tagName === 'DIV') {
            container.style.display = 'flex';
            container.style.alignItems = 'center';
            container.style.justifyContent = 'space-between';
        }

        container.appendChild(exportButton);
    }

    // ========== 数据预览 ==========

    function togglePreview() {
        const container = document.getElementById('nqi-preview-container');
        const btn = document.getElementById('nqi-preview-toggle');

        if (container.classList.contains('expanded')) {
            container.classList.remove('expanded');
            btn.innerHTML = '<span>👁️</span> 预览数据 (前5条)';
        } else {
            container.classList.add('expanded');
            btn.innerHTML = '<span>👁️</span> 收起预览';
            loadPreviewData();
        }
    }

    async function loadPreviewData() {
        const headerEl = document.getElementById('nqi-preview-header');
        const bodyEl = document.getElementById('nqi-preview-body');

        try {
            const firstPageData = await fetchPageData(1, 1);

            if (firstPageData.length > 0) {
                const columns = Object.keys(firstPageData[0]);

                headerEl.innerHTML = `<tr>${columns.map(col =>
                    `<th title="${col}">${col}</th>`
                ).join('')}</tr>`;

                const previewRows = firstPageData.slice(0, 5);
                bodyEl.innerHTML = previewRows.map(row => `
                    <tr>${columns.map(col => {
                        const val = row[col] ?? '';
                        return `<td title="${val}">${val}</td>`;
                    }).join('')}</tr>
                `).join('');
            }
        } catch (e) {
            console.error('[NQI Export] Load preview error:', e);
        }
    }

    // ========== 导出核心逻辑 ==========

    function extractTableName() {
        const urlParams = new URLSearchParams(window.location.search);
        const key = urlParams.get('key');
        if (key) return decodeURIComponent(key);

        const pageTitle = document.querySelector('.panel-title, .box-title, h1, h2, h3');
        if (pageTitle) return pageTitle.textContent.trim();

        return document.title.split('-')[0].trim() || '导出数据';
    }

    function getColumnNames() {
        const columns = [];
        const thElements = document.querySelectorAll('.dataTables_wrapper thead th');

        thElements.forEach(th => {
            const dataField = th.getAttribute('data-column') || th.getAttribute('data-name');
            if (dataField) {
                columns.push(dataField);
            } else {
                const text = th.textContent.trim();
                if (text) columns.push(text);
            }
        });

        return columns.length > 0 ? columns : CONFIG.DEFAULT_COLUMNS;
    }

    async function startExport(format = 'xlsx') {
        if (isExporting) {
            showToast('正在导出中，请稍候...', 'info');
            return;
        }

        isExporting = true;
        updateExportUI('loading');

        const progressEl = document.getElementById('nqi-progress');
        if (progressEl) progressEl.classList.add('active');

        try {
            showToast('正在获取数据...', 'info');

            const allRows = await extractTableData();

            if (!allRows || allRows.length === 0) {
                throw new Error('未获取到数据');
            }

            showToast(`已获取 ${allRows.length} 条数据，正在生成文件...`, 'info');

            if (format === 'csv') {
                await generateCSV(allRows);
            } else {
                await generateExcel(allRows);
            }

            showToast('导出成功！', 'success');
        } catch (error) {
            console.error('[NQI Export] Export error:', error);
            showToast('导出失败: ' + error.message, 'error');
        } finally {
            isExporting = false;
            updateExportUI('idle');
            setTimeout(() => {
                const progressEl = document.getElementById('nqi-progress');
                if (progressEl) progressEl.classList.remove('active');
            }, 2000);
        }
    }

    function updateExportUI(state) {
        const btnExcel = document.getElementById('nqi-export-excel');
        const btnCSV = document.getElementById('nqi-export-csv');

        if (!btnExcel || !btnCSV) return;

        switch (state) {
            case 'loading':
                btnExcel.disabled = true;
                btnCSV.disabled = true;
                btnExcel.innerHTML = '<span class="nqi-spinner"></span> 导出中...';
                btnCSV.innerHTML = '<span class="nqi-spinner"></span> 导出中...';
                break;
            case 'idle':
            default:
                btnExcel.disabled = false;
                btnCSV.disabled = false;
                btnExcel.innerHTML = '<span>📈</span> 导出 Excel';
                btnCSV.innerHTML = '<span>📄</span> 导出 CSV';
                break;
        }
    }

    function updateProgress(fetched, total, status) {
        const percent = total > 0 ? Math.round((fetched / total) * 100) : 0;

        const percentEl = document.getElementById('nqi-progress-percent');
        const fillEl = document.getElementById('nqi-progress-fill');
        const fetchedEl = document.getElementById('nqi-progress-fetched');
        const statusEl = document.getElementById('nqi-progress-status');
        const statFetchedEl = document.getElementById('nqi-stat-fetched');

        if (percentEl) percentEl.textContent = percent + '%';
        if (fillEl) fillEl.style.width = percent + '%';
        if (fetchedEl) fetchedEl.textContent = `${fetched} 条`;
        if (statusEl) statusEl.textContent = status;
        if (statFetchedEl) statFetchedEl.textContent = fetched;
    }

    // ========== API 调用 ==========

    async function extractTableData() {
        const allRows = [];
        let page = 1;
        let draw = 1;
        let total = await getTotalCount();
        let hasMore = true;
        let retries = 0;

        updateProgress(0, total, '获取总数...');

        while (hasMore) {
            try {
                updateProgress(allRows.length, total, `获取第 ${page} 页...`);

                const pageData = await fetchPageData(page, draw);

                if (!pageData || pageData.length === 0) {
                    retries++;
                    if (retries >= CONFIG.MAX_RETRIES) {
                        hasMore = false;
                    }
                    continue;
                }

                allRows.push(...pageData);
                updateProgress(allRows.length, total, `已获取 ${allRows.length} 条`);

                if (pageData.length < CONFIG.PAGE_SIZE) {
                    hasMore = false;
                } else if (total > 0 && allRows.length >= total) {
                    hasMore = false;
                } else {
                    page++;
                    draw++;
                    await sleep(300);
                }

                retries = 0;
            } catch (error) {
                console.error(`[NQI Export] Page ${page} error:`, error);
                retries++;
                if (retries >= CONFIG.MAX_RETRIES) {
                    throw new Error(`获取第 ${page} 页数据失败: ${error.message}`);
                }
                await sleep(1000);
            }
        }

        return allRows;
    }

    async function fetchPageData(page, draw = 1) {
        const requestBody = buildDataTablesRequest(page, draw);

        const response = await fetch(`${CONFIG.API_BASE}/getTable`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': window.location.href
            },
            credentials: 'include',
            body: requestBody
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();
        return parseDataTablesResponse(result);
    }

    function buildDataTablesRequest(page, draw) {
        const columns = getColumnNames();
        const result = extractTableResult();
        const where = extractWhereConditions();

        const params = [];
        params.push(`draw=${draw}`);
        params.push(`start=${(page - 1) * CONFIG.PAGE_SIZE}`);
        params.push(`length=${CONFIG.PAGE_SIZE}`);
        params.push(`total=0`);
        params.push(`search[value]=`);
        params.push(`search[regex]=false`);

        columns.forEach((col, index) => {
            params.push(`columns[${index}][data]=${encodeURIComponent(col)}`);
            params.push(`columns[${index}][name]=`);
            params.push(`columns[${index}][searchable]=true`);
            params.push(`columns[${index}][orderable]=true`);
            params.push(`columns[${index}][search][value]=`);
            params.push(`columns[${index}][search][regex]=false`);
        });

        params.push(`order[0][column]=0`);
        params.push(`order[0][dir]=desc`);

        params.push(`geographicdimension=${encodeURIComponent('小区，网格，市场，分公司')}`);
        params.push(`timedimension=${encodeURIComponent('小 时,天,年.月,忙时,15分钟')}`);
        params.push(`enodebField=enodeb_id`);
        params.push(`cgiField=cgi`);
        params.push(`timeField=starttime`);
        params.push(`cellField=cell`);
        params.push(`cityField=city`);

        if (result) {
            params.push(`result=${encodeURIComponent(JSON.stringify(result))}`);
        }

        if (where && where.length > 0) {
            params.push(`where=${encodeURIComponent(JSON.stringify(where))}`);
        }

        params.push(`indexcount=0`);
        return params.join('&');
    }

    function extractTableResult() {
        if (tableMeta && tableMeta.result) return tableMeta;

        const urlParams = new URLSearchParams(window.location.search);
        const resultStr = urlParams.get('result');

        if (resultStr) {
            try {
                return JSON.parse(decodeURIComponent(resultStr));
            } catch (e) {
                console.error('[NQI Export] Parse result error:', e);
            }
        }
        return null;
    }

    function extractWhereConditions() {
        const urlParams = new URLSearchParams(window.location.search);
        const whereStr = urlParams.get('where');

        if (whereStr) {
            try {
                return JSON.parse(decodeURIComponent(whereStr));
            } catch (e) {
                console.error('[NQI Export] Parse where error:', e);
            }
        }

        const conditions = [];
        const datesub = urlParams.get('datesub');

        if (datesub) {
            const dateParts = datesub.split('~');
            if (dateParts.length === 2) {
                const startDate = dateParts[0].trim();
                const endDate = dateParts[1].trim();

                conditions.push({
                    datatype: 'timestamp', feild: 'starttime', feildName: '',
                    symbol: '>=', val: startDate + ' 00:00:00', whereCon: 'and', query: true
                });
                conditions.push({
                    datatype: 'timestamp', feild: 'starttime', feildName: '',
                    symbol: '<', val: endDate + ' 23:59:59', whereCon: 'and', query: true
                });
            }
        }

        const city = urlParams.get('city');
        if (city && city !== 'undefined') {
            conditions.push({
                datatype: 'character', feild: 'city', feildName: '',
                symbol: 'in', val: decodeURIComponent(city), whereCon: 'and', query: true
            });
        }

        return conditions.length > 0 ? conditions : null;
    }

    function parseDataTablesResponse(result) {
        if (!result) return [];
        if (result.data && Array.isArray(result.data)) return result.data;
        if (result.row && Array.isArray(result.row)) return result.row;
        if (result.rows && Array.isArray(result.rows)) return result.rows;
        if (Array.isArray(result)) return result;

        if (typeof result === 'object') {
            const key = Object.keys(result).find(k => Array.isArray(result[k]));
            if (key) return result[key];
        }
        return [];
    }

    async function getTotalCount() {
        try {
            const result = extractTableResult();
            const where = extractWhereConditions();

            const params = [];
            params.push(`geographicdimension=${encodeURIComponent('小区，网格，市场，分公司')}`);
            params.push(`timedimension=${encodeURIComponent('小 时,天,年.月,忙时,15分钟')}`);
            params.push(`enodebField=enodeb_id`);
            params.push(`cgiField=cgi`);
            params.push(`timeField=starttime`);
            params.push(`cellField=cell`);
            params.push(`cityField=city`);

            if (result) {
                params.push(`result=${encodeURIComponent(JSON.stringify(result))}`);
            }
            if (where && where.length > 0) {
                params.push(`where=${encodeURIComponent(JSON.stringify(where))}`);
            }
            params.push(`indexcount=0`);

            const response = await fetch(`${CONFIG.API_BASE}/getTableCount`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': window.location.href
                },
                credentials: 'include',
                body: params.join('&')
            });

            if (!response.ok) return 0;

            const data = await response.json();
            return data.count || data.recordsTotal || data.total || data.data || 0;
        } catch (e) {
            console.error('[NQI Export] getTotalCount error:', e);
            return 0;
        }
    }

    // ========== 文件生成 ==========

    async function generateExcel(data) {
        if (typeof XLSX === 'undefined') {
            await loadXlsxLib();
        }

        const tableName = extractTableName();
        const columns = getColumnNames();

        const ws = XLSX.utils.json_to_sheet(data, {
            header: columns,
            skipHeader: true
        });

        const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
        const wscols = [];
        for (let i = range.s.c; i <= range.e.c; i++) {
            wscols.push({ wch: 18 });
        }
        ws['!cols'] = wscols;

        const wb = XLSX.utils.book_new();
        const sheetName = tableName.substring(0, 31).replace(/[\\\/\?\*\[\]]/g, '_');
        XLSX.utils.book_append_sheet(wb, ws, sheetName);

        const fileName = `${tableName}_${formatDate(new Date())}.xlsx`;
        XLSX.writeFile(wb, fileName);
    }

    async function generateCSV(data) {
        if (data.length === 0) return;

        const columns = getColumnNames();
        const headers = columns.join(',');
        const rows = data.map(row => {
            return columns.map(col => {
                const val = (row[col] ?? '').toString();
                if (val.includes(',') || val.includes('"') || val.includes('\n')) {
                    return '"' + val.replace(/"/g, '""') + '"';
                }
                return val;
            }).join(',');
        });

        const csv = '\ufeff' + [headers, ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        const tableName = extractTableName();
        const fileName = `${tableName}_${formatDate(new Date())}.csv`;

        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
    }

    async function loadXlsxLib() {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js';
            script.onload = resolve;
            script.onerror = () => reject(new Error('Failed to load SheetJS'));
            document.head.appendChild(script);
        });
    }

    // ========== 工具函数 ==========

    function formatDate(date) {
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const HH = String(date.getHours()).padStart(2, '0');
        const MM = String(date.getMinutes()).padStart(2, '0');
        return `${yyyy}${mm}${dd}_${HH}${MM}`;
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function showToast(message, type = 'info') {
        const existing = document.querySelector('.nqi-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `nqi-toast ${type}`;

        const icons = { success: '✓', error: '✕', info: 'ℹ' };
        toast.innerHTML = `
            <span style="font-size:18px;">${icons[type] || icons.info}</span>
            <span>${message}</span>
        `;

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'nqiSlideUp 0.3s ease reverse';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    // ========== 消息监听 ==========

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'getTableInfo') {
            try {
                const info = {
                    tableName: extractTableName(),
                    columns: getColumnNames(),
                    totalRows: hasDetectedData ? parseInt(document.getElementById('nqi-stat-total')?.textContent || '0') : 0
                };
                sendResponse({ success: true, data: info });
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
            return true;
        }

        if (message.action === 'startExport') {
            startExport(message.format || 'xlsx');
            sendResponse({ success: true });
            return true;
        }
    });

    window.NQIExportTool = {
        startExport,
        extractTableData,
        generateExcel,
        generateCSV,
        extractTableName,
        getColumnNames
    };

    // ========== 启动 ==========

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
