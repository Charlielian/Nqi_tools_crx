/**
 * 大数据平台数据导出工具 - Sidebar Script (简约版)
 */

(function() {
    'use strict';

    let isExporting = false;

    function init() {
        bindEvents();
        checkCurrentPage();
        
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.action === 'dataDetected') {
                showDataView(message.data);
            }
        });
    }

    function bindEvents() {
        document.getElementById('export-excel-btn')?.addEventListener('click', () => startExport('xlsx'));
        document.getElementById('export-csv-btn')?.addEventListener('click', () => startExport('csv'));
        document.getElementById('refresh-btn')?.addEventListener('click', checkCurrentPage);
    }

    async function checkCurrentPage() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (!tab?.url?.includes('nqi.gmcc.net') || 
                (!tab.url.includes('/adhocquery') && !tab.url.includes('adhoc'))) {
                showWaiting();
                return;
            }

            // 尝试从 storage 获取缓存
            const storage = await chrome.storage.local.get(['tableInfo']);
            if (storage.tableInfo?.rowCount > 0) {
                showDataView(storage.tableInfo);
                return;
            }

            // 尝试获取实时数据
            try {
                const results = await chrome.tabs.sendMessage(tab.id, { action: 'getTableInfo' });
                if (results?.success && results.data?.rowCount > 0) {
                    showDataView(results.data);
                    return;
                }
            } catch (e) {}

            showWaiting();
        } catch (e) {
            showWaiting();
        }
    }

    function showWaiting() {
        document.getElementById('no-data-view')?.classList.remove('hidden');
        document.getElementById('data-view')?.classList.add('hidden');
    }

    function showDataView(info) {
        document.getElementById('no-data-view')?.classList.add('hidden');
        document.getElementById('data-view')?.classList.remove('hidden');
        
        document.getElementById('stat-total').textContent = formatNum(info.rowCount);
    }

    function formatNum(n) {
        if (!n) return '-';
        if (n >= 10000) return (n / 10000).toFixed(1) + '万';
        return n.toString();
    }

    async function startExport(format) {
        if (isExporting) return;
        isExporting = true;
        updateUI(true);

        const prog = document.getElementById('progress-container');
        prog?.classList.add('active');

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            await chrome.tabs.sendMessage(tab.id, { action: 'startExport', format });
            listenProgress();
        } catch (e) {
            resetUI();
        }
    }

    function listenProgress() {
        const check = async () => {
            if (!isExporting) return;
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                const res = await chrome.tabs.sendMessage(tab.id, { action: 'getExportProgress' });
                if (res?.success) {
                    const { fetched, total, status } = res.data;
                    if (total > 0) {
                        const pct = Math.round((fetched / total) * 100);
                        document.getElementById('progress-percent').textContent = pct + '%';
                        document.getElementById('progress-fill').style.width = pct + '%';
                        document.getElementById('progress-fetched').textContent = formatNum(fetched);
                        document.getElementById('progress-status').textContent = status === 'complete' ? '完成' : '获取中';
                    }
                    if (status === 'complete' || status === 'error') {
                        isExporting = false;
                        resetUI();
                        setTimeout(() => {
                            document.getElementById('progress-container')?.classList.remove('active');
                        }, 1500);
                        return;
                    }
                }
            } catch (e) {}
            setTimeout(check, 500);
        };
        check();
    }

    function updateUI(loading) {
        const btn1 = document.getElementById('export-excel-btn');
        const btn2 = document.getElementById('export-csv-btn');
        if (btn1) btn1.disabled = loading;
        if (btn2) btn2.disabled = loading;
    }

    function resetUI() {
        isExporting = false;
        updateUI(false);
        document.getElementById('progress-percent').textContent = '0%';
        document.getElementById('progress-fill').style.width = '0%';
    }

    document.addEventListener('DOMContentLoaded', init);
})();
