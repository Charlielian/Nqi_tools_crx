/**
 * 大数据平台数据导出工具 - Background Script
 */

let xlsxLib = null;

async function getXlsxLib() {
    if (xlsxLib) return xlsxLib;
    try {
        const url = chrome.runtime.getURL('lib/xlsx.full.min.js');
        const resp = await fetch(url);
        const code = await resp.text();
        const fn = new Function(code + '\nreturn typeof XLSX !== "undefined" ? XLSX : null;');
        xlsxLib = fn();
        if (!xlsxLib) {
            eval(code);
            xlsxLib = globalThis.XLSX;
        }
        console.log('[Background] XLSX loaded');
        return xlsxLib;
    } catch (e) {
        console.error('[Background] XLSX load failed:', e);
        return null;
    }
}

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
        sendResponse({ success: true, data: exportProgress });
        return true;
    }

    if (message.action === 'generateXlsx') {
        (async () => {
            try {
                const XLSX = await getXlsxLib();
                if (!XLSX) throw new Error('XLSX 库加载失败');

                const { filteredData, header, filename } = message;
                const ws = XLSX.utils.json_to_sheet(filteredData, {
                    header: header,
                    skipHeader: false
                });
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, '数据');

                const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
                const bytes = new Uint8Array(wbout);
                let binary = '';
                for (let i = 0; i < bytes.byteLength; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }
                const base64 = btoa(binary);

                const binArr = atob(base64);
                const binBytes = new Uint8Array(binArr.length);
                for (let i = 0; i < binArr.length; i++) {
                    binBytes[i] = binArr.charCodeAt(i);
                }
                const blob = new Blob([binBytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const url = URL.createObjectURL(blob);

                chrome.downloads.download({
                    url: url,
                    filename: filename,
                    saveAs: false
                }, (downloadId) => {
                    setTimeout(() => URL.revokeObjectURL(url), 5000);
                    if (chrome.runtime.lastError) {
                        sendResponse({ success: false, error: chrome.runtime.lastError.message });
                    } else {
                        sendResponse({ success: true, downloadId: downloadId });
                    }
                });
            } catch (e) {
                console.error('[Background] generateXlsx failed:', e);
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    if (message.action === 'loadXlsxLib') {
        (async () => {
            try {
                const url = chrome.runtime.getURL('lib/xlsx.full.min.js');
                const code = await (await fetch(url)).text();
                sendResponse({ success: true, code });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    if (message.action === 'downloadFile') {
        try {
            const binary = atob(message.data);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: message.mime });
            const url = URL.createObjectURL(blob);

            chrome.downloads.download({
                url: url,
                filename: message.filename,
                saveAs: false
            }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    sendResponse({ success: false, error: chrome.runtime.lastError.message });
                } else {
                    sendResponse({ success: true, downloadId: downloadId });
                }
                setTimeout(() => URL.revokeObjectURL(url), 5000);
            });
        } catch (e) {
            sendResponse({ success: false, error: e.message });
        }
        return true;
    }
});

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('[NQI Export] Extension installed');
    } else if (details.reason === 'update') {
        console.log('[NQI Export] Extension updated');
    }
});
