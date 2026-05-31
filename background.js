/**
 * 大数据平台数据导出工具 - Background Script
 */

// 当前检测到的数据状态
let currentDataState = {
    hasData: false,
    rowCount: 0
};

// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getTableInfo') {
        handleGetTableInfo(message, sender).then(sendResponse);
        return true;
    }

    if (message.action === 'startExport') {
        handleStartExport(message, sender).then(sendResponse);
        return true;
    }

    if (message.action === 'downloadFile') {
        handleDownloadFile(message).then(sendResponse);
        return true;
    }

    if (message.action === 'dataDetected') {
        handleDataDetected(message, sender);
        sendResponse({ success: true });
        return true;
    }
});

/**
 * 处理数据检测消息
 */
function handleDataDetected(message, sender) {
    currentDataState.hasData = true;
    currentDataState.rowCount = message.rowCount || 0;

    // 更新图标状态 - 显示有数据
    updateBadge(true, currentDataState.rowCount);
}

/**
 * 更新扩展图标徽章
 */
function updateBadge(hasData, count = 0) {
    if (hasData) {
        // 显示数据计数
        const text = count > 999 ? '999+' : String(count);
        chrome.action.setBadgeText({ text: text });
        chrome.action.setBadgeBackgroundColor({ color: '#67C23A' });
    } else {
        chrome.action.setBadgeText({ text: '' });
    }
}

async function handleGetTableInfo(message, sender) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab) {
            return { success: false, error: 'No active tab' };
        }

        const results = await chrome.tabs.sendMessage(tab.id, { action: 'getTableInfo' });
        return results;
    } catch (error) {
        console.error('[Background] getTableInfo error:', error);
        return { success: false, error: error.message };
    }
}

async function handleStartExport(message, sender) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab) {
            return { success: false, error: 'No active tab' };
        }

        await chrome.tabs.sendMessage(tab.id, { action: 'startExport' });
        return { success: true };
    } catch (error) {
        console.error('[Background] startExport error:', error);
        return { success: false, error: error.message };
    }
}

async function handleDownloadFile(message) {
    try {
        const { filename, data } = message;

        const blob = base64ToBlob(data, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        const url = URL.createObjectURL(blob);

        await chrome.downloads.download({
            url: url,
            filename: filename,
            saveAs: true
        });

        return { success: true };
    } catch (error) {
        console.error('[Background] downloadFile error:', error);
        return { success: false, error: error.message };
    }
}

function base64ToBlob(base64, mimeType) {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);

    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }

    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
}

// 插件安装或更新时触发
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('[NQI Export] Extension installed');
    } else if (details.reason === 'update') {
        console.log('[NQI Export] Extension updated');
    }
});

// 插件图标点击时触发
chrome.action.onClicked.addListener((tab) => {
    console.log('[NQI Export] Icon clicked on tab:', tab.url);
});
