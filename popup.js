/**
 * 大数据平台数据导出工具 - Popup 脚本
 */

document.addEventListener('DOMContentLoaded', function() {
    const statusIcon = document.getElementById('status-icon');
    const pageStatus = document.getElementById('page-status');
    const tableInfo = document.getElementById('table-info');
    const exportBtn = document.getElementById('export-btn');
    const exportBtnText = document.getElementById('export-btn-text');
    const refreshBtn = document.getElementById('refresh-btn');

    let isExporting = false;

    function updateStatus(status, message, info) {
        statusIcon.textContent = status.icon;
        pageStatus.textContent = message;
        tableInfo.textContent = info || '';

        if (status.type === 'success') {
            statusIcon.className = 'success-icon';
        } else if (status.type === 'error') {
            statusIcon.className = 'error-icon';
        } else {
            statusIcon.className = '';
        }
    }

    function setExportButtonState(state) {
        switch (state) {
            case 'loading':
                exportBtn.disabled = true;
                exportBtnText.innerHTML = '<span class="spinner"></span> 导出中...';
                isExporting = true;
                break;
            case 'idle':
                exportBtn.disabled = false;
                exportBtnText.textContent = '导出全部数据';
                isExporting = false;
                break;
        }
    }

    async function checkCurrentPage() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (!tab || !tab.url) {
                updateStatus({ icon: '❌', type: 'error' }, '无法获取页面信息', '');
                return;
            }

            if (!tab.url.includes('nqi.gmcc.net')) {
                updateStatus({ icon: '❌', type: 'error' }, '不在大数据平台页面', '请打开 nqi.gmcc.net 网站');
                return;
            }

            if (!tab.url.includes('/adhocquery')) {
                updateStatus({ icon: '❌', type: 'error' }, '不在即席查询页面', '请打开即席查询模块');
                return;
            }

            updateStatus({ icon: '⏳', type: 'loading' }, '检测中...', '');

            const results = await chrome.tabs.sendMessage(tab.id, { action: 'getTableInfo' });

            if (results && results.success) {
                const info = results.data;
                if (info.rowCount > 0) {
                    updateStatus(
                        { icon: '✅', type: 'success' },
                        `已检测到数据表格`,
                        `共 ${info.rowCount} 条记录`
                    );
                    exportBtn.disabled = false;
                } else {
                    updateStatus({ icon: '📭', type: 'warning' }, '未检测到数据', '请先执行查询');
                }
            } else {
                updateStatus({ icon: '📭', type: 'warning' }, '未检测到表格', '请先执行查询');
            }
        } catch (error) {
            console.error('[Popup] Error:', error);
            updateStatus({ icon: '❌', type: 'error' }, '检测失败', error.message);
        }
    }

    async function triggerExport() {
        if (isExporting) return;

        setExportButtonState('loading');

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (!tab || !tab.url || !tab.url.includes('nqi.gmcc.net')) {
                throw new Error('请在数据平台页面使用');
            }

            await chrome.tabs.sendMessage(tab.id, { action: 'startExport' });

            setTimeout(() => {
                setExportButtonState('idle');
            }, 1000);
        } catch (error) {
            console.error('[Popup] Export error:', error);
            setExportButtonState('idle');
            alert('导出失败: ' + error.message);
        }
    }

    exportBtn.addEventListener('click', triggerExport);
    refreshBtn.addEventListener('click', checkCurrentPage);

    checkCurrentPage();
});
