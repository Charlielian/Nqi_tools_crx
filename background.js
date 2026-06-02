/**
 * 大数据平台数据导出工具 - Background Script
 */

// 导出进度状态
let exportProgress = {
    isExporting: false,
    fetched: 0,
    total: 0,
    status: 'idle'
};

// 监听来自 sidebar 和 content script 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Background] Message:', message.action);
    
    if (message.action === 'ping') {
        sendResponse({ success: true, message: 'pong' });
        return true;
    }
    
    if (message.action === 'getTableInfoDirect') {
        const tabId = message.tabId;
        if (tabId) {
            chrome.tabs.sendMessage(tabId, { action: 'getTableInfo' })
                .then(sendResponse)
                .catch(error => {
                    sendResponse({ success: false, error: error.message });
                });
            return true;
        }
        sendResponse({ success: false, error: 'No tabId provided' });
        return true;
    }
    
    if (message.action === 'dataDetected') {
        // 转发给 sidebar
        chrome.runtime.sendMessage({
            action: 'dataDetected',
            data: message.data
        }).catch(() => {});
        sendResponse({ success: true });
        return true;
    }
    
    if (message.action === 'updateExportProgress') {
        exportProgress = {
            isExporting: message.isExporting ?? exportProgress.isExporting,
            fetched: message.fetched ?? exportProgress.fetched,
            total: message.total ?? exportProgress.total,
            status: message.status ?? exportProgress.status
        };
        sendResponse({ success: true });
        return true;
    }
    
    if (message.action === 'getExportProgress') {
        sendResponse({
            success: true,
            data: exportProgress
        });
        return true;
    }

    // 通过 background script 中转加载 xlsx 库，绕过 CSP
    if (message.action === 'loadXlsxLib') {
        const url = chrome.runtime.getURL('lib/xlsx.full.min.js');
        fetch(url)
            .then(r => r.text())
            .then(code => sendResponse({ success: true, code }))
            .catch(e => sendResponse({ success: false, error: e.message }));
        return true; // 异步响应
    }
});

// 插件安装或更新时触发
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('[NQI Export] Extension installed');
    } else if (details.reason === 'update') {
        console.log('[NQI Export] Extension updated');
    }
});
