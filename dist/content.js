/**
 * 大数据平台数据导出工具 - Content Script
 * 完全动态获取请求参数
 */

(function() {
    'use strict';

    const CONFIG = {
        API_BASE: 'https://nqi.gmcc.net:20443/pro-adhoc/adhocquery',
        PAGE_SIZE: 200,
        MAX_RETRIES: 3
    };

    // 全局状态
    let exportPanel = null;
    let isExporting = false;
    let hasDetectedData = false;
    let currentTableData = null;
    let tableMeta = null;

    // 缓存捕获的数据
    let capturedData = {
        result: null,           // 从 getTableCount/getTable 响应中捕获
        where: null,            // 查询条件（从请求中捕获）
        tableConfig: null,      // 从 getSelectTable 响应中捕获
        columns: [],            // 列名
        lastRequestBody: null,  // 上一个请求的 body
        // 新增：捕获完整请求上下文
        requestContext: null,   // 完整的请求上下文（result、where 等）
        originalRequestParams: null, // 原始页面的请求参数
        drawValue: 1,           // DataTables 的 draw 值
        // 新增：追踪已捕获的 where 条件的唯一标识
        capturedWhereKey: null,  // 用于避免重复捕获相同的 where 条件
        // 新增：保存成功返回数据的请求（最可靠）
        successfulRequestBody: null,  // 上一个成功返回数据的请求 body
        // 新增：保存最后一次 getTable 请求的参数（备用）
        lastGetTableParams: null
    };

    console.log('[NQI Export] Script initializing...');

    // ========== 诊断功能 ==========

    // 在全局暴露诊断函数
    window.NQIExport_Diagnose = async function() {
        console.clear();
        console.log('%c[NQI Export] 页面结构诊断报告', 'color: #667eea; font-size: 16px; font-weight: bold;');
        console.log('═'.repeat(80));

        const report = {
            timestamp: new Date().toISOString(),
            tables: [],
            pagination: null,
            dataInfo: null,
            capturedData: null,
            suggestions: []
        };

        // 1. 分析 DataTables
        console.log('\n%c[1] DataTables 分析', 'color: #10b981; font-weight: bold;');
        
        const tables = document.querySelectorAll('.dataTable, table.dataTable, [id^="DataTables"]');
        report.tables = tables.length;
        console.log('   表格数量:', tables.length);

        if (typeof $ !== 'undefined') {
            tables.forEach((t, i) => {
                try {
                    const api = $(t).DataTable();
                    const info = api.page.info();
                    console.log(`\n   表格 ${i + 1}:`);
                    console.log('   ├─ 总页数:', info.pages);
                    console.log('   ├─ 每页条数:', info.length);
                    console.log('   ├─ 总记录数:', info.recordsTotal);
                    console.log('   ├─ 当前页:', info.page + 1);
                    console.log('   ├─ 当前页数据:', info.end - info.start + 1, '条');
                    
                    // 检查是否有 API 方法可以调用
                    console.log('   └─ 可用方法: page(), draw(), ajax(), data()');
                    
                    report.dataInfo = {
                        totalPages: info.pages,
                        pageLength: info.length,
                        recordsTotal: info.recordsTotal,
                        currentPage: info.page + 1
                    };
                } catch(e) {
                    console.log(`   表格 ${i + 1}: 获取失败 -`, e.message);
                }
            });
        } else {
            console.log('   ⚠️ jQuery 未加载');
            report.suggestions.push('jQuery 未加载，DataTables API 不可用');
        }

        // 2. 分析分页控件
        console.log('\n%c[2] 分页控件分析', 'color: #10b981; font-weight: bold;');
        
        const paginate = document.querySelector('.dataTables_paginate');
        if (paginate) {
            const buttons = paginate.querySelectorAll('.paginate_button');
            console.log('   分页按钮数量:', buttons.length);
            
            const paginationInfo = [];
            buttons.forEach((b, i) => {
                paginationInfo.push({
                    index: i,
                    class: b.className,
                    text: b.textContent.trim(),
                    disabled: b.classList.contains('disabled'),
                    hasOnClick: !!b.onclick
                });
                
                const isCurrent = b.classList.contains('current') || b.classList.contains('active');
                const marker = isCurrent ? '→' : ' ';
                const status = b.classList.contains('disabled') ? ' [禁用]' : '';
                console.log(`   ${marker} 按钮 ${i}: "${b.textContent.trim()}"${status}`);
            });
            
            // 查找下一页按钮
            const nextBtn = paginate.querySelector('.paginate_button.next');
            const prevBtn = paginate.querySelector('.paginate_button.previous, .paginate_button.prev');
            
            report.pagination = {
                buttonCount: buttons.length,
                buttons: paginationInfo,
                hasNext: !!nextBtn && !nextBtn.classList.contains('disabled'),
                hasPrev: !!prevBtn && !prevBtn.classList.contains('disabled')
            };
            
            console.log('\n   分页状态:');
            console.log('   ├─ 上一页:', report.pagination.hasPrev ? '可用' : '禁用');
            console.log('   ├─ 下一页:', report.pagination.hasNext ? '可用' : '禁用');
            console.log('   └─ 点击方式: nextBtn.click() 或 nextBtn.dispatchEvent(new MouseEvent("click"))');
        } else {
            console.log('   ⚠️ 未找到分页控件');
            report.suggestions.push('未找到分页控件，可能不是 DataTables 分页');
        }

        // 3. 分析表格数据
        console.log('\n%c[3] 表格数据', 'color: #10b981; font-weight: bold;');
        
        const tableWrapper = document.querySelector('.dataTables_wrapper');
        if (tableWrapper) {
            const tbody = tableWrapper.querySelector('tbody');
            const thead = tableWrapper.querySelector('thead');
            
            if (tbody) {
                const rows = tbody.querySelectorAll('tr');
                const cells = rows[0]?.querySelectorAll('td');
                
                console.log('   ├─ 数据行数:', rows.length);
                console.log('   ├─ 列数:', cells?.length || 0);
                console.log('   └─ 数据提取方式: 从 DOM tbody tr td 获取');
            }
            
            if (thead) {
                const headers = thead.querySelectorAll('th');
                console.log('   ├─ 表头列数:', headers.length);
                console.log('   └─ 表头内容:', Array.from(headers).map(h => h.textContent.trim()).join(', '));
            }
        }

        // 4. 捕获的数据
        console.log('\n%c[4] 插件捕获的数据', 'color: #10b981; font-weight: bold;');
        console.log('   ├─ successfulRequestBody:', capturedData.successfulRequestBody ? '有 (长度:' + capturedData.successfulRequestBody.length + ')' : '无');
        console.log('   ├─ originalRequestParams:', capturedData.originalRequestParams ? '有' : '无');
        console.log('   ├─ capturedData.where:', capturedData.where ? capturedData.where.length + '个条件' : '无');
        console.log('   ├─ tableFields:', capturedData.tableFields ? capturedData.tableFields.length + '个字段' : '无');
        console.log('   └─ interceptedRequests:', capturedData.interceptedRequests?.length || 0, '个请求');

        report.capturedData = {
            hasSuccessfulRequest: !!capturedData.successfulRequestBody,
            hasOriginalParams: !!capturedData.originalRequestParams,
            whereCount: capturedData.where?.length || 0,
            tableFieldsCount: capturedData.tableFields?.length || 0,
            interceptedCount: capturedData.interceptedRequests?.length || 0
        };

        // 5. 建议
        console.log('\n%c[5] 导出建议', 'color: #e6a23c; font-weight: bold;');
        
        if (typeof $ !== 'undefined' && report.dataInfo && report.dataInfo.totalPages > 1) {
            console.log('   ✅ 检测到 DataTables API，可以尝试:');
            console.log('      1. $(table).DataTable().page(i).draw(false) - 翻页');
            console.log('      2. $(table).DataTable().rows().data() - 获取数据');
            report.suggestions.push('使用 DataTables API 翻页');
        } else if (report.pagination?.hasNext) {
            console.log('   ✅ 检测到分页按钮，可以尝试:');
            console.log('      1. 模拟点击下一页按钮');
            console.log('      2. 逐页收集 DOM 数据');
            report.suggestions.push('模拟点击分页按钮');
        } else {
            console.log('   ⚠️ 未检测到可用的翻页方式');
        }

        console.log('\n' + '═'.repeat(80));
        console.log('%c[NQI Export] 诊断完成！复制上面的报告内容发给我分析', 'color: #667eea;');
        
        return report;
    };

    // 自动提示用户
    console.log('%c[NQI Export] 💡 提示: 在控制台输入 NQIExport_Diagnose() 可获取页面结构诊断报告', 'color: #888; font-style: italic;');

    // ========== 立即设置拦截器（在脚本加载时就设置）==========

    // 立即设置 jQuery 拦截器（如果 jQuery 已加载）
    (function setupImmediateJQueryInterceptor() {
        if (typeof jQuery !== 'undefined' && jQuery.ajax) {
            installJQueryInterceptor();
        } else {
            // 等待 jQuery 加载
            const checkJQuery = setInterval(() => {
                if (typeof jQuery !== 'undefined' && jQuery.ajax) {
                    clearInterval(checkJQuery);
                    installJQueryInterceptor();
                }
            }, 50);
        }
    })();
    
    function installJQueryInterceptor() {
        const originalAjax = jQuery.ajax;
        
        jQuery.ajax = function(url, options) {
            // 处理两种调用方式
            let actualUrl = url;
            let actualOptions = options || {};
            
            if (typeof url === 'object') {
                actualOptions = url;
                actualUrl = actualOptions.url;
            }
            
            const urlStr = actualUrl || '';
            
            // 捕获请求数据
            if (urlStr.includes('/adhocquery/')) {
                console.log('[NQI Export] jQuery AJAX intercepted:', urlStr.split('/').pop());
                
                let requestData = actualOptions.data;
                if (requestData) {
                    if (typeof requestData === 'object') {
                        requestData = jQuery.param(requestData);
                    }
                    console.log('[NQI Export] jQuery request data length:', requestData.length);
                    capturedData.lastRequestBody = requestData;
                    handleApiRequest(urlStr, requestData);
                } else {
                    console.log('[NQI Export] jQuery: no data in options');
                }
            }
            
            return originalAjax.apply(this, arguments);
        };
        
        console.log('[NQI Export] jQuery AJAX interceptor installed');
    }

    function setupRequestInterceptors() {
        console.log('[NQI Export] Setting up request interceptors...');
        
        const originalFetch = window.fetch;
        const originalXHROpen = XMLHttpRequest.prototype.open;
        const originalXHRSend = XMLHttpRequest.prototype.send;

        // 拦截 Fetch API
        window.fetch = async function(input, init = {}) {
            // 提取 URL
            let url = input;
            if (input instanceof Request) {
                url = input.url;
            } else if (input instanceof URL) {
                url = input.toString();
            }
            
            const urlStr = typeof url === 'string' ? url : String(url);
            
            // 检查是否是 adhocquery 请求 - 捕获请求数据
            if (urlStr.includes('/adhocquery/')) {
                const apiName = urlStr.split('/').pop();
                
                // 捕获请求数据
                let requestBody = '';
                let clonedRequest = null;
                
                try {
                    if (init && init.body) {
                        // 如果 init.body 是字符串，直接使用
                        if (typeof init.body === 'string') {
                            requestBody = init.body;
                        } else if (init.body instanceof URLSearchParams) {
                            requestBody = init.body.toString();
                        } else if (init.body instanceof FormData) {
                            // FormData 需要特殊处理
                            requestBody = 'FormData (cannot read directly)';
                        } else {
                            // 尝试转换为字符串
                            requestBody = String(init.body);
                        }
                    } else if (input instanceof Request) {
                        // 克隆 request 来读取 body
                        clonedRequest = input.clone();
                        requestBody = await clonedRequest.text();
                    }
                } catch (e) {
                    console.log('[NQI Export] Error reading fetch body:', e);
                }
                
                if (requestBody && requestBody !== 'FormData (cannot read directly)') {
                    capturedData.lastRequestBody = requestBody;
                    console.log('[NQI Export] Fetch captured request body for:', apiName, 'body length:', requestBody.length);
                    handleApiRequest(urlStr, requestBody);
                }
            }
            
            // 调用原始 fetch
            const response = await originalFetch.call(this, input, init);
            
            // 检查是否是 adhocquery 请求 - 处理响应
            if (urlStr.includes('/adhocquery/')) {
                const apiName = urlStr.split('/').pop();
                console.log('[NQI Export] Fetch intercepted:', apiName);
                
                try {
                    const clonedResponse = response.clone();
                    const text = await clonedResponse.text();
                    const data = JSON.parse(text);
                    console.log('[NQI Export] API response:', apiName, 'keys:', Object.keys(data));
                    // 传递请求体给 handleApiResponse，避免被后续请求覆盖
                    handleApiResponse(urlStr, data, capturedData.lastRequestBody);
                } catch (e) {
                    console.error('[NQI Export] Fetch parse error:', e);
                }
            }
            
            return response;
        };

        // 拦截 XMLHttpRequest
        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            this._url = url;
            this._method = method;
            return originalXHROpen.apply(this, [method, url, ...rest]);
        };

        XMLHttpRequest.prototype.send = function(data) {
            // 捕获请求数据
            if (this._url && this._url.includes('/adhocquery/')) {
                capturedData.lastRequestBody = data;
                console.log('[NQI Export] XHR captured request body for:', this._url.split('/').pop(), 'body length:', data ? data.length : 0);
                handleApiRequest(this._url, data);
            }
            
            // 保存请求体的引用（用于 XHR 响应回调）
            const requestBody = data;
            
            this.addEventListener('load', function() {
                try {
                    const url = this._url || '';
                    if (url.includes('/adhocquery/') && this.responseText) {
                        console.log('[NQI Export] XHR response for:', url.split('/').pop(), 'has body:', !!this.responseText);
                        const data = JSON.parse(this.responseText);
                        // 传递请求体给 handleApiResponse
                        handleApiResponse(url, data, requestBody);
                    }
                } catch (e) {
                    console.error('[NQI Export] XHR response parse error:', e);
                }
            });
            
            this.addEventListener('error', function() {
                console.error('[NQI Export] XHR request error for:', this._url);
            });
            
            return originalXHRSend.apply(this, arguments);
        };
        
        // 拦截 jQuery AJAX
        if (typeof jQuery !== 'undefined' && jQuery.ajax) {
            installJQueryInterceptor();
        }
        
        console.log('[NQI Export] Request interceptors installed');
    }

    /**
     * 处理 API 请求，捕获 where 参数
     */
    function handleApiRequest(url, data) {
        if (!data) return;
        
        // 解析请求参数
        try {
            const params = new URLSearchParams(data);
            const apiName = url.split('/').pop();
            
            console.log('[NQI Export] handleApiRequest:', apiName, 'params:', params.toString().substring(0, 200));
            
            // 捕获完整的原始请求参数 - 这是最可靠的方式！
            const rawResult = params.get('result');
            const rawWhere = params.get('where');
            
            // 生成 where 条件的唯一标识（用于避免重复捕获）
            let currentWhereKey = null;
            if (rawWhere) {
                try {
                    const whereObj = JSON.parse(decodeURIComponent(rawWhere));
                    currentWhereKey = JSON.stringify(whereObj);
                    console.log('[NQI Export] Captured where key:', currentWhereKey.substring(0, 100));
                } catch (e) {}
            }
            
            if (rawResult) {
                console.log('[NQI Export] Found result param, length:', rawResult.length);
                try {
                    const decoded = decodeURIComponent(rawResult);
                    const resultObj = JSON.parse(decoded);
                    console.log('[NQI Export] result param parsed, has result array:', !!resultObj.result, 'length:', resultObj.result?.length);
                    
                    if (resultObj.result && Array.isArray(resultObj.result) && resultObj.result.length > 0) {
                        // 解析 where 条件
                        const whereObj = rawWhere ? JSON.parse(decodeURIComponent(rawWhere)) : null;
                        
                        // 检查是否需要更新 capturedData.where
                        // 条件：当前没有 where，或者新 where 有更多条件
                        const shouldUpdateWhere = whereObj && (
                            !capturedData.where || 
                            capturedData.where.length === 0 ||
                            (whereObj.length > capturedData.where.length)
                        );
                        
                        if (shouldUpdateWhere) {
                            console.log('[NQI Export] Updating capturedData.where with', whereObj.length, 'conditions');
                            console.log('[NQI Export] Where full content:', JSON.stringify(whereObj));
                            capturedData.where = whereObj;
                            // 更新显示
                            updateWhereDisplay();
                        }
                        
                        // 优先使用有 where 条件的请求
                        if (rawWhere && (!capturedData.originalRequestParams?.where || capturedData.originalRequestParams?.where?.length === 0)) {
                            console.log('[NQI Export] Capturing request WITH where conditions (priority)');
                            
                            capturedData.originalRequestParams = {
                                result: resultObj,
                                where: whereObj,
                                draw: parseInt(params.get('draw')) || 1,
                                start: params.get('start'),
                                length: params.get('length'),
                                columns: params.get('columns'),
                                order: params.get('order'),
                                total: params.get('total'),
                                indexcount: params.get('indexcount'),
                                // 保存完整的原始请求体
                                rawBody: data,
                                capturedWhereKey: currentWhereKey
                            };
                            capturedData.capturedWhereKey = currentWhereKey;
                            console.log('[NQI Export] Captured original request params WITH where, count:', whereObj?.length || 0);
                            if (whereObj) {
                                console.log('[NQI Export] Where conditions full:', JSON.stringify(whereObj));
                            }
                        }
                        // 如果之前没有捕获到任何请求，先捕获第一个
                        else if (!capturedData.originalRequestParams) {
                            console.log('[NQI Export] First capture (no previous), capturing anyway');
                            capturedData.originalRequestParams = {
                                result: resultObj,
                                where: whereObj,
                                draw: parseInt(params.get('draw')) || 1,
                                start: params.get('start'),
                                length: params.get('length'),
                                columns: params.get('columns'),
                                order: params.get('order'),
                                total: params.get('total'),
                                indexcount: params.get('indexcount'),
                                rawBody: data,
                                capturedWhereKey: currentWhereKey
                            };
                            capturedData.capturedWhereKey = currentWhereKey;
                        }
                    }
                } catch (e) {
                    console.error('[NQI Export] Failed to parse result param:', e);
                }
            } else {
                console.log('[NQI Export] No result param in request');
            }
            
            // 单独捕获 where 条件
            if (rawWhere) {
                try {
                    const whereObj = JSON.parse(decodeURIComponent(rawWhere));
                    if (Array.isArray(whereObj) && whereObj.length > 0) {
                        console.log('[NQI Export] Raw where found with', whereObj.length, 'conditions');
                        console.log('[NQI Export] Raw where content:', JSON.stringify(whereObj));
                        
                        // 保存到 lastGetTableParams（作为备用）
                        if (apiName === 'getTable') {
                            capturedData.lastGetTableParams = {
                                where: whereObj,
                                draw: parseInt(params.get('draw')) || 1,
                                start: params.get('start'),
                                length: params.get('length'),
                                columns: params.get('columns'),
                                order: params.get('order'),
                                rawBody: data
                            };
                            console.log('[NQI Export] Saved lastGetTableParams');
                        }
                        
                        // 只有在新的 where 条件与已捕获的不同时才更新
                        const newWhereKey = JSON.stringify(whereObj);
                        
                        // 关键改进：如果新的 where 条件有更多条件，强制更新
                        const hasMoreConditions = whereObj.length > (capturedData.where?.length || 0);
                        
                        if (newWhereKey !== capturedData.capturedWhereKey || hasMoreConditions) {
                            const oldCount = capturedData.where?.length || 0;
                            capturedData.where = whereObj;
                            capturedData.capturedWhereKey = newWhereKey;
                            console.log('[NQI Export] Captured/Updated where from XHR:', whereObj.length, 'conditions (was', oldCount, ')');
                            console.log('[NQI Export] Where full content:', JSON.stringify(whereObj));
                            
                            // 更新显示
                            updateWhereDisplay();
                            
                            // 同时更新 originalRequestParams 中的 where
                            if (capturedData.originalRequestParams) {
                                capturedData.originalRequestParams.where = whereObj;
                                capturedData.originalRequestParams.capturedWhereKey = newWhereKey;
                                // 重建 rawBody
                                rebuildRawBody();
                            }
                        }
                    }
                } catch (e) {
                    console.error('[NQI Export] Failed to parse where param:', e);
                }
            }
            
        } catch (e) {
            console.error('[NQI Export] handleApiRequest error:', e);
        }
    }
    
    /**
     * 重建 rawBody（当 where 条件更新时）
     */
    function rebuildRawBody() {
        if (!capturedData.originalRequestParams) return;
        
        const params = capturedData.originalRequestParams;
        const bodyParts = [];
        
        if (params.result) {
            bodyParts.push(`result=${encodeURIComponent(JSON.stringify(params.result))}`);
        }
        if (params.where) {
            bodyParts.push(`where=${encodeURIComponent(JSON.stringify(params.where))}`);
        }
        if (params.columns) {
            bodyParts.push(`columns=${params.columns}`);
        }
        if (params.order) {
            bodyParts.push(`order=${params.order}`);
        }
        if (params.draw !== undefined) {
            bodyParts.push(`draw=${params.draw}`);
        }
        if (params.start !== undefined) {
            bodyParts.push(`start=${params.start}`);
        }
        if (params.length !== undefined) {
            bodyParts.push(`length=${params.length}`);
        }
        if (params.total !== undefined) {
            bodyParts.push(`total=${params.total}`);
        }
        if (params.indexcount !== undefined) {
            bodyParts.push(`indexcount=${params.indexcount}`);
        }
        
        params.rawBody = bodyParts.join('&');
        console.log('[NQI Export] Rebuilt rawBody, length:', params.rawBody.length);
    }

    /**
     * 处理 API 响应，捕获关键数据
     * @param {string} url - 请求 URL
     * @param {object} data - 响应数据
     * @param {string} [requestBody] - 请求体（可选，如果不传则使用 capturedData.lastRequestBody）
     */
    function handleApiResponse(url, data, requestBody) {
        // 使用传入的请求体，或者回退到 capturedData.lastRequestBody
        const body = requestBody || capturedData.lastRequestBody;
        
        const apiName = url.split('/').pop();
        console.log('[NQI Export] API response:', apiName, 'keys:', Object.keys(data));
        console.log('[NQI Export] Response data preview:', JSON.stringify(data).substring(0, 500));
        
        // 捕获成功响应的原始请求参数
        if (url.includes('getTable')) {
            console.log('[NQI Export] getTable response received');
            console.log('[NQI Export] Using requestBody:', body ? 'exists (length:' + body.length + ')' : 'null/undefined');
            
            // 如果有请求体，使用它
            if (body) {
                try {
                    const params = new URLSearchParams(body);
                    const rawResult = params.get('result');
                    
                    console.log('[NQI Export] getTable response - has data:', !!data.data, 'data length:', data.data?.length);
                    
                    // 只要有数据返回，就保存这个请求
                    if (data.data && Array.isArray(data.data) && data.data.length > 0) {
                        console.log('[NQI Export] getTable response SUCCESS, has', data.data.length, 'rows');
                        
                        // 保存成功的请求（最可靠！用于导出）
                        capturedData.successfulRequestBody = body;
                        console.log('[NQI Export] Saved successful request body, length:', body.length);
                        
                        // 同时保存 where 条件
                        const rawWhere = params.get('where');
                        if (rawWhere) {
                            try {
                                const whereObj = JSON.parse(decodeURIComponent(rawWhere));
                                if (Array.isArray(whereObj) && whereObj.length > 0) {
                                    capturedData.where = whereObj;
                                    capturedData.capturedWhereKey = JSON.stringify(whereObj);
                                    console.log('[NQI Export] Saved successful where conditions:', whereObj.length);
                                }
                            } catch (e) {}
                        }
                        
                        // 如果之前没捕获到 originalRequestParams，现在捕获
                        if (!capturedData.originalRequestParams) {
                            if (rawResult) {
                                try {
                                    const decoded = decodeURIComponent(rawResult);
                                    const resultObj = JSON.parse(decoded);

                                    if (resultObj.result && Array.isArray(resultObj.result) && resultObj.result.length > 0) {
                                        capturedData.originalRequestParams = {
                                            result: resultObj,
                                            where: params.get('where') ? JSON.parse(decodeURIComponent(params.get('where'))) : null,
                                            draw: parseInt(params.get('draw')) || 1,
                                            start: params.get('start'),
                                            length: params.get('length'),
                                            columns: params.get('columns'),
                                            order: params.get('order'),
                                            total: params.get('total'),
                                            indexcount: params.get('indexcount'),
                                            rawBody: body
                                        };
                                        console.log('[NQI Export] CAPTURED original request params from successful getTable response');
                                    }
                                } catch (e) {
                                    console.error('[NQI Export] Failed to parse result from lastRequestBody:', e);
                                }
                            } else {
                                // 即使没有 result 参数，也保存原始请求参数
                                console.log('[NQI Export] No result param, saving basic request params');
                                capturedData.originalRequestParams = {
                                    result: null,
                                    where: params.get('where') ? JSON.parse(decodeURIComponent(params.get('where'))) : null,
                                    draw: parseInt(params.get('draw')) || 1,
                                    start: params.get('start'),
                                    length: params.get('length'),
                                    columns: params.get('columns'),
                                    order: params.get('order'),
                                    total: params.get('total'),
                                    indexcount: params.get('indexcount'),
                                    rawBody: body
                                };
                                console.log('[NQI Export] CAPTURED basic original request params');
                            }
                        }
                    } else {
                        console.log('[NQI Export] getTable response has NO data');
                    }
                } catch (e) {
                    console.error('[NQI Export] Error processing getTable response:', e);
                }
            } else {
                // 没有请求体，尝试从其他地方获取
                console.log('[NQI Export] No requestBody, checking lastGetTableParams');
                if (capturedData.lastGetTableParams && data.data && Array.isArray(data.data) && data.data.length > 0) {
                    console.log('[NQI Export] Using lastGetTableParams to save successful request');
                    capturedData.successfulRequestBody = capturedData.lastGetTableParams.rawBody;
                    capturedData.originalRequestParams = capturedData.lastGetTableParams;
                    console.log('[NQI Export] Saved successful request from lastGetTableParams');
                } else if (data.data && Array.isArray(data.data) && data.data.length > 0) {
                    // 完全没有请求信息，但有数据返回
                    console.log('[NQI Export] WARNING: No request body captured, but API returned data');
                }
            }
        }
        
        // getSelectTable 响应 - 捕获表配置
        if (url.includes('getSelectTable')) {
            console.log('[NQI Export] Captured getSelectTable response');
            if (data.CFG_ADHOC_CONF_TABLE && data.CFG_ADHOC_CONF_TABLE.length > 0) {
                const conf = data.CFG_ADHOC_CONF_TABLE[0];
                capturedData.tableConfig = {
                    geographicdimension: conf.geographicdimension || '小区',
                    timedimension: conf.timedimension || '天',
                    enodebField: conf.enodeb_field || 'enodeb_id',
                    cgiField: conf.cgi_field || 'cgi',
                    timeField: conf.time_field || 'starttime',
                    cellField: conf.cell_field || 'cell',
                    cityField: conf.city_field || 'city'
                };
                console.log('[NQI Export] Table config captured:', capturedData.tableConfig);
            }
        }
        
        // getTableCount 响应 - 捕获 result 和 where
        if (url.includes('getTableCount') && data.result) {
            console.log('[NQI Export] Captured result from getTableCount');
            capturedData.result = data.result;
            
            // 同时获取 count
            if (data.count !== undefined) {
                capturedData.count = data.count;
                console.log('[NQI Export] Captured count from API:', data.count);
                // API 返回了总数，通知侧边栏更新
                notifySidebarWithApiCount(data.count);
            }
            
            // 从 getTableCount 请求中捕获 where 参数
            // 已经在请求拦截时获取
        }
        
        // getTable 响应 - 捕获 result、where 和列信息
        if (url.includes('getTable') && !url.includes('getTableBottomInfo') && data.result) {
            console.log('[NQI Export] Captured result from getTable');
            capturedData.result = data.result;
            
            // 捕获列名
            if (data.data && data.data.length > 0) {
                const firstRow = data.data[0];
                capturedData.columns = Object.keys(firstRow);
                console.log('[NQI Export] Columns captured:', capturedData.columns);
            }
        }
    }

    // ========== 初始化 ==========

    function init() {
        if (!window.location.pathname.includes('/adhocquery')) {
            console.log('[NQI Export] Not on adhoc page, skipping');
            return;
        }
        
        console.log('[NQI Export] Initializing on adhoc page...');
        
        injectStyles();
        setupRequestInterceptors();
        
        // 立即检测当前的查询条件（从 DOM 或全局变量）
        detectCurrentQueryConditions();
        
        startAutoDetection();
        
        console.log('[NQI Export] Initialization complete');
    }
    
    /**
     * 立即检测当前的查询条件
     * 在页面加载时调用，尝试从多个来源获取当前生效的 where 条件
     */
    function detectCurrentQueryConditions() {
        console.log('[NQI Export] Detecting current query conditions...');
        
        // 1. 尝试从全局变量获取
        const globalSources = [
            window.searchParam,
            window.searchWhere,
            window.queryParam,
            window.adhocParam,
            window.searchConfig,
            window.queryConfig,
            window.gridParam,
            window.cityParam
        ];
        
        for (const source of globalSources) {
            if (source && typeof source === 'object') {
                console.log('[NQI Export] Found global source:', Object.keys(source));
                // 检查是否有 where 属性
                if (source.where) {
                    console.log('[NQI Export] Found where in global source');
                    if (Array.isArray(source.where) && source.where.length > 0) {
                        capturedData.where = source.where;
                        console.log('[NQI Export] Captured where from global, count:', source.where.length);
                    }
                }
            }
        }
        
        // 2. 尝试从 URL 参数获取
        try {
            const urlParams = new URLSearchParams(window.location.search);
            for (const [key, value] of urlParams) {
                if (key.toLowerCase().includes('where') || key.toLowerCase().includes('param')) {
                    console.log('[NQI Export] Found param in URL:', key, 'length:', value.length);
                    try {
                        const decoded = decodeURIComponent(value);
                        const parsed = JSON.parse(decoded);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            capturedData.where = parsed;
                            console.log('[NQI Export] Captured where from URL param, count:', parsed.length);
                        }
                    } catch (e) {}
                }
            }
        } catch (e) {
            console.log('[NQI Export] URL parsing error:', e);
        }
        
        // 3. 尝试从表单元素获取当前的查询条件
        const domConditions = extractWhereFromDOM();
        if (domConditions && domConditions.length > 0) {
            console.log('[NQI Export] Found', domConditions.length, 'conditions from DOM');
            // 只有在没有从其他地方获取到 where 时才使用 DOM 条件
            if (!capturedData.where || capturedData.where.length === 0) {
                capturedData.where = domConditions;
                console.log('[NQI Export] Using DOM conditions as fallback');
            }
        }
        
        // 4. 尝试从 DataTables 的配置中获取
        try {
            const dtApi = window.$.fn.dataTable?.api?.();
            if ( dtApi && typeof dtApi === 'function') {
                const settings = dtApi.settings();
                if (settings && settings.ajax) {
                    console.log('[NQI Export] Found DataTables ajax settings');
                }
            }
        } catch (e) {}
        
        // 5. 尝试从 iframe 内部获取（如果有的话）
        try {
            const frames = document.querySelectorAll('iframe');
            for (const frame of frames) {
                try {
                    const frameDoc = frame.contentDocument || frame.contentWindow?.document;
                    if (frameDoc) {
                        // 检查框架内是否有相关数据
                        const frameWin = frame.contentWindow;
                        if (frameWin.searchParam || frameWin.searchWhere) {
                            console.log('[NQI Export] Found query data in frame');
                        }
                    }
                } catch (e) {
                    // 跨域访问失败是正常的
                }
            }
        } catch (e) {}
        
        console.log('[NQI Export] Current captured where:', capturedData.where?.length || 0, 'conditions');
    }

    // ========== 样式注入 ==========

    function injectStyles() {
        if (document.getElementById('nqi-export-styles')) return;
        
        const styles = document.createElement('style');
        styles.id = 'nqi-export-styles';
        styles.textContent = `
            .nqi-panel {
                position: fixed;
                top: 80px;
                left: auto;
                right: 20px;
                width: 320px;
                background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                border-radius: 16px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.5);
                z-index: 10000;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                color: #ccd6f6;
                overflow: hidden;
            }
            .nqi-panel-header {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                padding: 16px 20px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                cursor: move;
                user-select: none;
            }
            .nqi-panel-header:active {
                cursor: grabbing;
            }
            .nqi-panel-title {
                display: flex;
                align-items: center;
                gap: 10px;
                font-size: 16px;
                font-weight: 600;
                color: white;
            }
            .nqi-panel-title svg {
                width: 24px;
                height: 24px;
                fill: white;
            }
            .nqi-panel-badge {
                background: rgba(255,255,255,0.2);
                padding: 4px 10px;
                border-radius: 20px;
                font-size: 12px;
                color: white;
            }
            .nqi-panel-close {
                background: rgba(255,255,255,0.2);
                border: none;
                color: white;
                width: 28px;
                height: 28px;
                border-radius: 50%;
                cursor: pointer;
                font-size: 14px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .nqi-panel-close:hover {
                background: rgba(255,255,255,0.3);
            }
            .nqi-panel-body {
                padding: 16px;
            }
            .nqi-stats-grid {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 10px;
                margin-bottom: 16px;
            }
            .nqi-stat-card {
                background: #0f172a;
                padding: 12px;
                border-radius: 10px;
                text-align: center;
                border: 1px solid #2a3f5f;
            }
            .nqi-stat-value {
                font-size: 20px;
                font-weight: 700;
                color: #667eea;
            }
            .nqi-stat-label {
                font-size: 10px;
                color: #8892b0;
                margin-top: 4px;
            }
            .nqi-info-row {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px;
                background: #0f172a;
                border-radius: 10px;
                margin-bottom: 16px;
                border: 1px solid #2a3f5f;
            }
            .nqi-info-icon {
                width: 40px;
                height: 40px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                border-radius: 10px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 18px;
            }
            .nqi-info-content {
                flex: 1;
                min-width: 0;
            }
            .nqi-info-title {
                font-size: 13px;
                color: #ccd6f6;
                font-weight: 500;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .nqi-info-subtitle {
                font-size: 11px;
                color: #64ffda;
                margin-top: 2px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .nqi-info-dbname {
                font-size: 10px;
                color: #8892b0;
                margin-top: 2px;
                font-family: monospace;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                background: rgba(255,255,255,0.05);
                padding: 2px 4px;
                border-radius: 3px;
                display: inline-block;
                max-width: 100%;
            }
            .nqi-info-value {
                font-size: 11px;
                color: #8892b0;
                margin-top: 4px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .nqi-btn-row {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px;
                margin-bottom: 12px;
            }
            .nqi-btn {
                padding: 12px;
                border: none;
                border-radius: 10px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                transition: all 0.3s;
            }
            .nqi-btn-primary {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
            }
            .nqi-btn-primary:hover {
                transform: translateY(-2px);
                box-shadow: 0 8px 20px rgba(102, 126, 234, 0.4);
            }
            .nqi-btn-secondary {
                background: #0f172a;
                color: #ccd6f6;
                border: 1px solid #2a3f5f;
            }
            .nqi-btn-secondary:hover {
                background: #1a2a4a;
                border-color: #667eea;
            }
            .nqi-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
                transform: none !important;
            }
            .nqi-progress {
                background: #0f172a;
                border-radius: 10px;
                padding: 14px;
                margin-bottom: 12px;
                border: 1px solid #2a3f5f;
            }
            .nqi-progress-header {
                display: flex;
                justify-content: space-between;
                margin-bottom: 10px;
            }
            .nqi-progress-title {
                font-size: 12px;
                color: #ccd6f6;
            }
            .nqi-progress-percent {
                font-size: 12px;
                color: #667eea;
                font-weight: 600;
            }
            .nqi-progress-bar {
                height: 6px;
                background: #1a2a4a;
                border-radius: 3px;
                overflow: hidden;
            }
            .nqi-progress-fill {
                height: 100%;
                background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
                transition: width 0.3s;
            }
            .nqi-progress-detail {
                margin-top: 8px;
                font-size: 10px;
                color: #8892b0;
                display: flex;
                justify-content: space-between;
            }
            .nqi-toast {
                position: fixed;
                top: 100px;
                left: 50%;
                transform: translateX(-50%);
                padding: 12px 20px;
                background: #1a1a2e;
                border-radius: 10px;
                color: white;
                font-size: 13px;
                box-shadow: 0 10px 40px rgba(0,0,0,0.4);
                z-index: 10001;
                display: flex;
                align-items: center;
                gap: 10px;
                animation: nqiSlideDown 0.3s ease;
                border: 1px solid #2a3f5f;
            }
            .nqi-toast.success { border-left: 4px solid #10b981; }
            .nqi-toast.error { border-left: 4px solid #ef4444; }
            .nqi-toast.info { border-left: 4px solid #667eea; }
            .nqi-where-row {
                display: flex;
                align-items: flex-start;
                gap: 12px;
                padding: 12px;
                background: #0f172a;
                border-radius: 10px;
                margin-bottom: 16px;
                border: 1px solid #2a3f5f;
            }
            .nqi-where-icon {
                width: 32px;
                height: 32px;
                background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
                border-radius: 8px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 14px;
                flex-shrink: 0;
            }
            .nqi-where-content {
                flex: 1;
                min-width: 0;
            }
            .nqi-where-label {
                font-size: 10px;
                color: #8892b0;
                margin-bottom: 4px;
            }
            .nqi-where-value {
                font-size: 11px;
                color: #fbbf24;
                line-height: 1.4;
                word-break: break-all;
            }
            @keyframes nqiSlideDown {
                from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
                to { opacity: 1; transform: translateX(-50%) translateY(0); }
            }
        `;
        document.head.appendChild(styles);
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

        // 定期检查
        setInterval(checkAndShowExportPanel, 2000);
        
        // 定期检查查询条件的变化
        setInterval(checkQueryConditionsChanges, 3000);
        
        // 监听查询按钮点击事件
        setupQueryButtonListener();
        
        // 监听表单元素变化
        setupFormChangeListeners();
        
        // 立即检查一次
        setTimeout(checkAndShowExportPanel, 1000);
    }
    
    /**
     * 设置查询按钮监听器
     * 当用户点击查询按钮时，尝试捕获新的 where 条件
     */
    function setupQueryButtonListener() {
        // 监听常见的查询按钮
        const queryButtonSelectors = [
            'button[class*="query"]',
            'button[class*="search"]',
            'button[class*="btn-primary"]',
            'a[class*="query"]',
            'input[type="button"][value*="查询"]',
            'input[type="button"][value*="搜索"]',
            'button:contains("查询")',
            '.layui-btn',
            '[onclick*="query"]',
            '[onclick*="search"]',
            '[onclick*="Query"]',
            '[onclick*="Search"]'
        ];
        
        // 使用事件委托监听所有查询相关按钮
        document.addEventListener('click', (e) => {
            const target = e.target;
            if (!target) return;
            
            const text = target.textContent?.trim() || '';
            const className = target.className || '';
            const onclick = target.getAttribute('onclick') || '';
            
            // 判断是否是查询按钮
            const isQueryButton = 
                className.includes('query') || 
                className.includes('search') ||
                className.includes('btn-primary') ||
                text.includes('查询') ||
                text.includes('搜索') ||
                text.includes('刷新') ||
                onclick.includes('query') ||
                onclick.includes('search') ||
                onclick.includes('Query') ||
                onclick.includes('Search');
            
            if (isQueryButton) {
                console.log('[NQI Export] Detected query button click:', text, className);
                // 延迟捕获，因为查询可能需要一些时间
                setTimeout(() => {
                    checkAndCaptureNewConditions();
                }, 500);
            }
        });
        
        console.log('[NQI Export] Query button listener setup');
    }
    
    /**
     * 设置表单变化监听器
     * 监听日期选择器、下拉框等元素的变化
     */
    function setupFormChangeListeners() {
        // 监听常见的筛选控件变化
        const formElements = document.querySelectorAll(
            'input[class*="date"], ' +
            'input[class*="time"], ' +
            'input[name*="start"], ' +
            'input[name*="end"], ' +
            'select[name*="city"], ' +
            'select[name*="grid"], ' +
            'select[name*="area"], ' +
            '.laydate-input, ' +
            'input[lay-date], ' +
            '.layui-select, ' +
            'select'
        );
        
        formElements.forEach(el => {
            // 避免重复监听
            if (el._nqiChangeListener) return;
            el._nqiChangeListener = true;
            
            el.addEventListener('change', () => {
                console.log('[NQI Export] Form element changed:', el.name || el.id || el.className);
                // 延迟重新提取条件
                setTimeout(() => {
                    const domConditions = extractWhereFromDOM();
                    if (domConditions && domConditions.length > 0) {
                        console.log('[NQI Export] DOM conditions updated:', domConditions.length);
                        // 更新 capturedData.where
                        capturedData.where = domConditions;
                    }
                }, 100);
            });
            
            // 同时监听输入事件（对于输入框）
            if (el.tagName === 'INPUT') {
                el.addEventListener('input', () => {
                    setTimeout(() => {
                        const domConditions = extractWhereFromDOM();
                        if (domConditions && domConditions.length > 0) {
                            capturedData.where = domConditions;
                        }
                    }, 100);
                });
            }
        });
        
        // 使用 MutationObserver 监听新增的表单元素
        const formObserver = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) { // Element node
                        const newElements = node.querySelectorAll?.('select, input, .laydate-input, .layui-select');
                        if (newElements) {
                            newElements.forEach(el => {
                                if (!el._nqiChangeListener) {
                                    el._nqiChangeListener = true;
                                    el.addEventListener('change', () => {
                                        setTimeout(() => {
                                            const domConditions = extractWhereFromDOM();
                                            if (domConditions && domConditions.length > 0) {
                                                capturedData.where = domConditions;
                                            }
                                        }, 100);
                                    });
                                }
                            });
                        }
                    }
                });
            });
        });
        
        formObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        console.log('[NQI Export] Form change listeners setup, monitored', formElements.length, 'elements');
    }
    
    /**
     * 检查并捕获新的查询条件
     * 当检测到查询操作时调用
     */
    function checkAndCaptureNewConditions() {
        console.log('[NQI Export] Checking for new query conditions...');
        
        // 尝试从 lastRequestBody 获取最新的 where 条件
        if (capturedData.lastRequestBody) {
            try {
                const params = new URLSearchParams(capturedData.lastRequestBody);
                const rawWhere = params.get('where');
                
                if (rawWhere) {
                    const whereObj = JSON.parse(decodeURIComponent(rawWhere));
                    if (Array.isArray(whereObj) && whereObj.length > 0) {
                        const newKey = JSON.stringify(whereObj);
                        if (newKey !== capturedData.capturedWhereKey) {
                            console.log('[NQI Export] Captured NEW where conditions after query!');
                            capturedData.where = whereObj;
                            capturedData.capturedWhereKey = newKey;
                            
                            // 更新 originalRequestParams
                            if (capturedData.originalRequestParams) {
                                capturedData.originalRequestParams.where = whereObj;
                                capturedData.originalRequestParams.capturedWhereKey = newKey;
                                rebuildRawBody();
                            }
                            
                            showToast(`捕获到 ${whereObj.length} 个查询条件`, 'info');
                        }
                    }
                }
            } catch (e) {
                console.error('[NQI Export] Error capturing new conditions:', e);
            }
        }
        
        // 尝试从 DOM 重新提取
        const domConditions = extractWhereFromDOM();
        if (domConditions && domConditions.length > 0) {
            const domKey = JSON.stringify(domConditions);
            if (domKey !== capturedData.capturedWhereKey) {
                console.log('[NQI Export] Captured DOM conditions after query:', domConditions.length);
                capturedData.where = domConditions;
                capturedData.capturedWhereKey = domKey;
                showToast(`从DOM捕获到 ${domConditions.length} 个查询条件`, 'info');
            }
        }
    }
    
    /**
     * 定期检查查询条件是否变化
     */
    function checkQueryConditionsChanges() {
        // 从 lastRequestBody 检查
        if (capturedData.lastRequestBody) {
            try {
                const params = new URLSearchParams(capturedData.lastRequestBody);
                const rawWhere = params.get('where');
                
                if (rawWhere) {
                    const whereObj = JSON.parse(decodeURIComponent(rawWhere));
                    if (Array.isArray(whereObj)) {
                        const currentKey = JSON.stringify(whereObj);
                        
                        // 如果与已捕获的不同，且有实质性内容（包含地市等筛选条件）
                        if (currentKey !== capturedData.capturedWhereKey && whereObj.length > 0) {
                            // 检查是否包含 city 相关的条件（说明用户选择了地市）
                            const hasCityCondition = whereObj.some(c => 
                                (c.feild === 'city' || c.feild === 'grid' || c.feild === 'area') && 
                                c.val && c.val.trim() !== ''
                            );
                            
                            if (hasCityCondition || whereObj.length > 0) {
                                console.log('[NQI Export] Query conditions changed! New conditions detected:', whereObj.length);
                                
                                // 获取具体的变化信息
                                const cityConditions = whereObj.filter(c => c.feild === 'city');
                                if (cityConditions.length > 0) {
                                    console.log('[NQI Export] City conditions:', cityConditions.map(c => c.val).join(', '));
                                }
                                
                                capturedData.where = whereObj;
                                capturedData.capturedWhereKey = currentKey;
                                
                                if (capturedData.originalRequestParams) {
                                    capturedData.originalRequestParams.where = whereObj;
                                    rebuildRawBody();
                                }
                                
                                // 更新显示
                                updateWhereDisplay();
                                
                                showToast(`已捕获筛选条件: ${whereObj.length} 个`, 'info');
                            }
                        }
                    }
                }
            } catch (e) {}
        }
        
        // 同时更新 where 显示（定期检查是否有新的筛选条件）
        updateWhereDisplay();
    }

    function checkAndShowExportPanel() {
        // 检查是否有表格数据
        const tableWrapper = document.querySelector('.dataTables_wrapper');
        const tableInfo = document.querySelector('.dataTables_info');
        
        if (!tableWrapper) return;

        // 获取总数
        let totalRows = 0;
        if (tableInfo) {
            const infoText = tableInfo.textContent;
            const match = infoText.match(/共\s*(\d+)/);
            if (match) {
                totalRows = parseInt(match[1]);
            }
        }

        if (totalRows === 0) {
            const rows = tableWrapper.querySelectorAll('tbody tr');
            if (rows.length > 0) {
                totalRows = rows.length;
            }
        }

        if (totalRows === 0) return;

        console.log('[NQI Export] Detected data:', totalRows, 'rows');

        if (!hasDetectedData) {
            hasDetectedData = true;
            showExportPanel(totalRows);
        } else {
            updatePanelStats(totalRows);
        }
        
        // 同时更新 where 显示（定期检查是否有新的筛选条件）
        updateWhereDisplay();
    }

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
        
        // 通知 sidebar
        notifySidebar();
    }

    function createPanelHTML(totalRows) {
        // 获取表名信息
        const tableName = capturedData.tableConfig?.tableName_cn || 
                         capturedData.result?.result?.[0]?.tableName_cn || 
                         '数据表格';
        
        // 获取数据库表名（完整）
        const dbTableName = capturedData.tableConfig?.tableName || 
                           capturedData.result?.result?.[0]?.tableName || 
                           '';
        
        // 获取字段类型
        const fieldType = capturedData.tableConfig?.fieldtype || 
                         capturedData.result?.result?.[0]?.fieldtype || 
                         '';
        
        const columns = capturedData.columns.length > 0 ? capturedData.columns : getColumnNames();
        
        // 优先使用 API 返回的真实总数
        const apiCount = capturedData.count;
        const displayTotal = (apiCount && apiCount > 0) ? apiCount : totalRows;
        
        // 生成 where 条件的显示信息
        let whereInfo = '';
        if (capturedData.where && capturedData.where.length > 0) {
            console.log('[NQI Export] createPanelHTML: capturedData.where has', capturedData.where.length, 'conditions');
            
            const conditions = capturedData.where.map(c => {
                // 处理时间字段 - 开始时间 (>=)
                if (c.feild === 'starttime' && c.symbol === '>=') {
                    return `开始: ${c.val}`;
                }
                // 处理时间字段 - 结束时间 (<)
                if (c.feild === 'starttime' && c.symbol === '<') {
                    return `结束: ${c.val}`;
                }
                // 处理地市
                if (c.feild === 'city') {
                    return `地市: ${c.val}`;
                }
                // 处理网格
                if (c.feild === 'grid') {
                    return `网格: ${c.val}`;
                }
                // 处理维度
                if (c.feild === 'dimension') {
                    return `维度: ${c.val}`;
                }
                // 处理日期类型 (粒度)
                if (c.feild === 'datetype') {
                    return `粒度: ${c.val}`;
                }
                // 处理 Top N
                if (c.feild === 'maptop') {
                    return `Top N: ${c.val}`;
                }
                // 处理人力区县分公司
                if (c.feild === 'county') {
                    return `区县: ${c.val}`;
                }
                // 处理基站
                if (c.feild === 'gnodeb_id' || c.feild === 'enodeb_id') {
                    return `基站: ${c.val}`;
                }
                // 处理小区
                if (c.feild === 'cell') {
                    return `小区: ${c.val}`;
                }
                // 处理 ECI
                if (c.feild === 'eci') {
                    return `ECI: ${c.val}`;
                }
                // 处理小时
                if (c.feild === 'hour') {
                    return `小时: ${c.val}`;
                }
                // 其他条件
                return `${c.feild || c.feildName}: ${c.val}`;
            }).join(' | ');
            whereInfo = conditions;
        } else {
            whereInfo = '未检测到筛选条件（将导出全部数据）';
        }

        return `
            <div class="nqi-panel-header">
                <div class="nqi-panel-title">
                    <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                    <span>数据导出</span>
                </div>
                <div class="nqi-panel-badge">${displayTotal} 条</div>
                <button class="nqi-panel-close" id="nqi-close-panel">✕</button>
            </div>
            <div class="nqi-panel-body">
                <div class="nqi-stats-grid">
                    <div class="nqi-stat-card">
                        <div class="nqi-stat-value" id="nqi-stat-total">${displayTotal}</div>
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
                        ${fieldType ? `<div class="nqi-info-subtitle">${fieldType}</div>` : ''}
                        ${dbTableName ? `<div class="nqi-info-dbname" title="数据库表名">🏷️ ${dbTableName}</div>` : ''}
                        <div class="nqi-info-value">${columns.slice(0, 3).join(', ')}${columns.length > 3 ? '...' : ''}</div>
                    </div>
                </div>
                <div class="nqi-where-row" id="nqi-where-display">
                    <div class="nqi-where-icon">🔍</div>
                    <div class="nqi-where-content">
                        <div class="nqi-where-label">当前筛选条件 (${capturedData.where?.length || 0}个)</div>
                        <div class="nqi-where-value" id="nqi-where-value">${whereInfo}</div>
                    </div>
                </div>
                <div class="nqi-progress" id="nqi-progress" style="display: none;">
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
                <div class="nqi-btn-row">
                    <button class="nqi-btn nqi-btn-primary" id="nqi-export-excel">
                        📈 导出 Excel
                    </button>
                    <button class="nqi-btn nqi-btn-secondary" id="nqi-export-csv">
                        📄 导出 CSV
                    </button>
                </div>
            </div>
        `;
    }

    function bindPanelEvents() {
        // 关闭按钮
        document.getElementById('nqi-close-panel')?.addEventListener('click', () => {
            exportPanel.style.display = 'none';
        });

        // 导出按钮
        document.getElementById('nqi-export-excel')?.addEventListener('click', () => {
            startExport('xlsx');
        });

        document.getElementById('nqi-export-csv')?.addEventListener('click', () => {
            startExport('csv');
        });

        // ========== 拖动功能 ==========
        const header = exportPanel.querySelector('.nqi-panel-header');
        let isDragging = false;
        let startX, startY, startLeft, startTop;

        header.addEventListener('mousedown', (e) => {
            // 忽略关闭按钮的点击
            if (e.target.closest('.nqi-panel-close')) return;

            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;

            const rect = exportPanel.getBoundingClientRect();
            startLeft = rect.left;
            startTop = rect.top;

            header.style.cursor = 'grabbing';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;

            exportPanel.style.left = (startLeft + deltaX) + 'px';
            exportPanel.style.top = (startTop + deltaY) + 'px';
            exportPanel.style.right = 'auto'; // 清除 right 属性
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                header.style.cursor = 'move';
            }
        });
    }

    function updatePanelStats(totalRows) {
        // 优先使用 API 返回的真实总数
        const apiCount = capturedData.count;
        const displayTotal = (apiCount && apiCount > 0) ? apiCount : totalRows;
        
        const badge = exportPanel?.querySelector('.nqi-panel-badge');
        const statTotal = document.getElementById('nqi-stat-total');
        
        if (badge) badge.textContent = `${displayTotal} 条`;
        if (statTotal) statTotal.textContent = displayTotal;
        
        // 更新 where 条件显示
        updateWhereDisplay();
    }
    
    /**
     * 更新筛选条件显示
     */
    function updateWhereDisplay() {
        const whereValueEl = document.getElementById('nqi-where-value');
        const whereLabelEl = document.querySelector('.nqi-where-label');
        if (!whereValueEl) return;
        
        let whereInfo = '';
        if (capturedData.where && capturedData.where.length > 0) {
            // 详细日志：输出所有捕获到的 where 条件
            console.log('[NQI Export] updateWhereDisplay: capturedData.where has', capturedData.where.length, 'conditions');
            console.log('[NQI Export] Full where conditions:', JSON.stringify(capturedData.where));
            
            const conditions = capturedData.where.map(c => {
                // 处理时间字段 - 开始时间 (>=)
                if (c.feild === 'starttime' && c.symbol === '>=') {
                    return `开始: ${c.val}`;
                }
                // 处理时间字段 - 结束时间 (<)
                if (c.feild === 'starttime' && c.symbol === '<') {
                    return `结束: ${c.val}`;
                }
                // 处理地市
                if (c.feild === 'city') {
                    return `地市: ${c.val}`;
                }
                // 处理网格
                if (c.feild === 'grid') {
                    return `网格: ${c.val}`;
                }
                // 处理维度
                if (c.feild === 'dimension') {
                    return `维度: ${c.val}`;
                }
                // 处理日期类型 (粒度)
                if (c.feild === 'datetype') {
                    return `粒度: ${c.val}`;
                }
                // 处理 Top N
                if (c.feild === 'maptop') {
                    return `Top N: ${c.val}`;
                }
                // 处理人力区县分公司
                if (c.feild === 'county') {
                    return `区县: ${c.val}`;
                }
                // 处理基站
                if (c.feild === 'gnodeb_id' || c.feild === 'enodeb_id') {
                    return `基站: ${c.val}`;
                }
                // 处理小区
                if (c.feild === 'cell') {
                    return `小区: ${c.val}`;
                }
                // 处理 ECI
                if (c.feild === 'eci') {
                    return `ECI: ${c.val}`;
                }
                // 处理小时
                if (c.feild === 'hour') {
                    return `小时: ${c.val}`;
                }
                // 其他条件
                return `${c.feild || c.feildName}: ${c.val}`;
            }).join(' | ');
            whereInfo = conditions;
            
            // 更新条件数量
            if (whereLabelEl) {
                whereLabelEl.textContent = `当前筛选条件 (${capturedData.where.length}个)`;
            }
            
            // 高亮显示
            whereValueEl.style.color = '#10b981'; // 绿色表示已捕获
        } else {
            whereInfo = '未检测到筛选条件（将导出全部数据）';
            whereValueEl.style.color = '#fbbf24'; // 黄色表示警告
            if (whereLabelEl) {
                whereLabelEl.textContent = '当前筛选条件';
            }
        }
        
        whereValueEl.textContent = whereInfo;
        console.log('[NQI Export] Updated where display:', whereInfo);
    }

    function updateExportProgress(fetched, total, status) {
        const progress = document.getElementById('nqi-progress');
        const percent = document.getElementById('nqi-progress-percent');
        const fill = document.getElementById('nqi-progress-fill');
        const fetchedEl = document.getElementById('nqi-progress-fetched');
        const statusEl = document.getElementById('nqi-progress-status');
        const fetchedStatEl = document.getElementById('nqi-stat-fetched');

        if (progress) progress.style.display = 'block';
        if (percent) percent.textContent = `${total > 0 ? Math.round((fetched / total) * 100) : 0}%`;
        if (fill) fill.style.width = `${total > 0 ? (fetched / total) * 100 : 0}%`;
        if (fetchedEl) fetchedEl.textContent = `${fetched} 条`;
        if (statusEl) statusEl.textContent = status;
        if (fetchedStatEl) fetchedStatEl.textContent = fetched;
    }

    // ========== 通知 Sidebar ==========

    function notifySidebar() {
        // 优先使用 API 返回的真实总数，否则使用 DOM 中的当前页行数
        const apiCount = capturedData.count;
        const domCount = getTotalRowsFromDOM();
        const totalRows = (apiCount && apiCount > domCount) ? apiCount : domCount;
        
        // 获取表名信息
        const tableName = capturedData.tableConfig?.tableName_cn || 
                         capturedData.result?.result?.[0]?.tableName_cn || 
                         capturedData.tableConfig?.tableName ||
                         capturedData.result?.result?.[0]?.tableName || 
                         '数据表格';
        const dbTableName = capturedData.tableConfig?.tableName || 
                           capturedData.result?.result?.[0]?.tableName || 
                           '';
        const fieldType = capturedData.tableConfig?.fieldtype || 
                         capturedData.result?.result?.[0]?.fieldtype || 
                         '';
        
        const info = {
            tableName: tableName,
            dbTableName: dbTableName,
            fieldType: fieldType,
            columns: capturedData.columns.length > 0 ? capturedData.columns : getColumnNames(),
            rowCount: totalRows,
            apiCount: apiCount || null,
            whereCount: capturedData.where?.length || 0,
            whereConditions: capturedData.where || []
        };
        
        console.log('[NQI Export] Notifying sidebar:', info);
        
        // 存储到 storage
        chrome.storage.local.set({ tableInfo: info }).catch(() => {});
        
        // 发送消息
        chrome.runtime.sendMessage({
            action: 'dataDetected',
            data: info
        }).catch(() => {});
    }
    
    // 当获取到 API count 时专门通知侧边栏（用于更新已显示的总数）
    function notifySidebarWithApiCount(apiCount) {
        const totalRows = apiCount;
        
        const info = {
            tableName: capturedData.tableConfig?.tableName || 
                       capturedData.result?.result?.[0]?.tableName || 
                       '数据表格',
            columns: capturedData.columns.length > 0 ? capturedData.columns : getColumnNames(),
            rowCount: totalRows,
            apiCount: apiCount
        };
        
        console.log('[NQI Export] Notifying sidebar with API count:', info);
        
        // 存储到 storage
        chrome.storage.local.set({ tableInfo: info }).catch(() => {});
        
        // 发送消息
        chrome.runtime.sendMessage({
            action: 'dataDetected',
            data: info
        }).catch(() => {});
    }
    
    function getTotalRowsFromDOM() {
        // 从 DOM 获取准确的总数
        const tableInfo = document.querySelector('.dataTables_info');
        if (tableInfo) {
            const infoText = tableInfo.textContent;
            const match = infoText.match(/共\s*(\d+)/);
            if (match) {
                return parseInt(match[1]);
            }
        }
        
        // 如果没有匹配，返回实际行数
        const rows = document.querySelectorAll('.dataTables_wrapper tbody tr');
        return rows.length;
    }

    // ========== 导出功能 ==========

    async function startExport(format = 'xlsx') {
        if (isExporting) {
            showToast('正在导出中...', 'info');
            return;
        }

        isExporting = true;
        updateButtonState(true);

        try {
            // 使用捕获的数据或从页面获取
            const params = await getRequestParams();
            
            if (!params) {
                console.error('[NQI Export] Failed to get request params. Captured data:', capturedData);
                throw new Error('无法获取查询参数');
            }

            console.log('[NQI Export] Starting export with params:', {
                hasResult: !!params.result,
                resultFields: params.result?.result?.length || params.result?.length || 0,
                hasWhere: !!params.where,
                whereCount: params.where?.length || 0,
                hasOriginalColumns: !!params.originalColumns
            });

            updateExportProgress(0, 0, '正在获取数据...');
            
            const data = await extractTableData(params);

            if (data.length === 0) {
                console.error('[NQI Export] No data extracted. Params:', params);
                throw new Error('未获取到数据');
            }

            updateExportProgress(data.length, data.length, '正在生成文件...');

            if (format === 'xlsx') {
                await generateExcel(data);
            } else {
                await generateCSV(data);
            }

            showToast('导出成功！', 'success');
        } catch (error) {
            console.error('[NQI Export] Export error:', error);
            showToast('导出失败: ' + error.message, 'error');
        } finally {
            isExporting = false;
            updateButtonState(false);
            updateExportProgress(0, 0, '');
        }
    }

    function updateButtonState(disabled) {
        const excelBtn = document.getElementById('nqi-export-excel');
        const csvBtn = document.getElementById('nqi-export-csv');
        if (excelBtn) excelBtn.disabled = disabled;
        if (csvBtn) csvBtn.disabled = disabled;
    }

    // ========== 获取请求参数（核心函数） ==========

    async function getRequestParams() {
        console.log('[NQI Export] Getting request params...');
        
        let result = null;
        let where = capturedData.where || null;
        let tableConfig = capturedData.tableConfig || null;
        
        // 检查捕获的数据
        console.log('[NQI Export] Captured data:', {
            hasResult: !!capturedData.result,
            hasResultArray: capturedData.result?.result?.length > 0,
            hasTableFields: capturedData.tableFields?.length > 0,
            hasWhere: !!capturedData.where,
            hasTableConfig: !!capturedData.tableConfig,
            hasOriginalParams: !!capturedData.originalRequestParams
        });
        
        // 方法0: 如果有原始请求参数，直接使用（最可靠）
        if (capturedData.originalRequestParams?.result) {
            console.log('[NQI Export] Method 0: Using original request params (most reliable)');
            const orig = capturedData.originalRequestParams;
            // 优先使用原始 where，如果没有则使用 capturedData.where
            const finalWhere = orig.where || where || capturedData.where;
            return {
                result: orig.result,
                where: finalWhere,
                // 使用原始的分页和列配置
                originalColumns: orig.columns,
                originalDraw: orig.draw,
                originalOrder: orig.order
            };
        }
        
        // 方法1: capturedData.result 有内容
        if (capturedData.result?.result?.length > 0) {
            console.log('[NQI Export] Method 1: Using capturedData.result');
            result = capturedData.result;
        }
        // 方法2: capturedData.tableFields 有内容（从 getSelectTable 捕获）
        else if (capturedData.tableFields?.length > 0) {
            console.log('[NQI Export] Method 2: Using capturedData.tableFields');
            result = { result: capturedData.tableFields };
        }
        // 方法3: window.searchResult 有内容
        else if (window.searchResult?.result?.length > 0) {
            console.log('[NQI Export] Method 3: Using window.searchResult');
            result = window.searchResult;
        }
        // 方法4: 直接从 DOM 和 API 获取
        else {
            console.log('[NQI Export] Method 4: Direct API call');
            const directResult = await fetchResultDirectly();
            if (directResult) {
                result = directResult;
            }
        }
        
        // 如果没有 tableConfig，检查是否有已捕获的 tableFields
        if (!tableConfig && result) {
            // 检查是否已经有捕获的 tableFields
            if (capturedData.tableFields?.length > 0) {
                console.log('[NQI Export] Using captured tableFields directly');
                const resultArray = Array.isArray(result) ? result : (result.result || []);
                const tableName = capturedData.tableFields[0]?.tableName || resultArray[0]?.tableName || '数据表格';
                const table = capturedData.tableFields[0]?.table || resultArray[0]?.table;
                
                result = {
                    result: capturedData.tableFields.map(f => ({
                        ...f,
                        tableName: f.tableName || tableName,
                        table: f.table || table
                    }))
                };
                tableConfig = {
                    geographicdimension: '小区',
                    timedimension: '天',
                    enodebField: 'gnodeb_id',
                    cgiField: 'cgi',
                    timeField: 'starttime',
                    cellField: 'cell',
                    cityField: 'city',
                    tableName: tableName
                };
            }
        }
        
        // 从 window 获取 where 条件
        if (!where) {
            where = window.searchWhere || window.searchParam?.where || extractWhereFromDOM();
        }

        // 最终检查
        if (!result) {
            console.error('[NQI Export] FAIL: No result data');
            return null;
        }
        
        // 确保 result 是正确格式
        const resultArray = Array.isArray(result) ? result : (result.result || []);
        if (resultArray.length === 0) {
            console.error('[NQI Export] FAIL: Result array empty');
            return null;
        }
        
        // 转换为 {result: [...]} 格式
        if (!result.result) {
            result = { result: resultArray };
        }

        console.log('[NQI Export] SUCCESS:', {
            tableName: result.result[0]?.tableName || result.result[0]?.table,
            fieldCount: result.result.length,
            hasWhere: !!where,
            hasConfig: !!tableConfig
        });

        return {
            result: result,
            where: where,
            ...(tableConfig || {})
        };
    }
    
    /**
     * 直接从 API 获取数据
     */
    async function fetchResultDirectly() {
        try {
            console.log('[NQI Export] fetchResultDirectly start...');
            
            // 1. 从 DOM 获取列信息
            const columns = extractColumnsFromDOM();
            console.log('[NQI Export] DOM columns:', columns.length);
            
            if (columns.length === 0) {
                console.log('[NQI Export] No columns found in DOM');
                return null;
            }
            
            // 2. 从 onclick 提取表名
            let tableName = extractTableNameFromOnclick();
            console.log('[NQI Export] Table name from onclick:', tableName);
            
            // 3. 如果有表名，调用 getSelectTable 获取字段配置
            if (tableName) {
                console.log('[NQI Export] Fetching table config for:', tableName);
                
                const response = await fetch(`${CONFIG.API_BASE}/getSelectTable`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    credentials: 'include',
                    body: `tablename=${encodeURIComponent(tableName)}`
                });

                const data = await response.json();
                console.log('[NQI Export] getSelectTable response keys:', Object.keys(data));
                
                if (data.CFG_ADHOC_CONF_TABLE && data.CFG_ADHOC_CONF_TABLE.length > 0) {
                    // 保存字段用于后续使用
                    capturedData.tableFields = data.CFG_ADHOC_CONF_TABLE.map(item => ({
                        feildtype: item.fieldtype || '报表',
                        table: item.tablename || tableName,
                        tableName: item.tablename_cn || tableName,
                        datatype: item.datatype || '1',
                        feildName: item.columnname_cn || '',
                        feild: item.columnname || '',
                        poly: '无',
                        anyWay: '无',
                        chart: '无',
                        chartpoly: '无'
                    }));
                    
                    console.log('[NQI Export] Got tableFields:', capturedData.tableFields.length);
                    
                    // 构建 result 对象
                    const resultObj = {
                        result: capturedData.tableFields,
                        tableParams: {
                            supporteddimension: null,
                            supportedtimedimension: data.CFG_ADHOC_CONF_TABLE[0]?.timedimension || '天'
                        },
                        columnname: ''
                    };
                    
                    // 使用捕获的 where 条件（如果有的话）
                    // 优先使用 capturedData 中的 where（更完整），其次是原始请求参数
                    const whereConditions = capturedData.where?.length > 0 
                        ? capturedData.where 
                        : (capturedData.originalRequestParams?.where || []);
                    console.log('[NQI Export] Using where conditions:', whereConditions.length, 'from capturedData');
                    
                    // 生成唯一标识
                    const whereKey = JSON.stringify(whereConditions);
                    capturedData.capturedWhereKey = whereKey;
                    
                    // 保存原始请求参数 - 使用捕获的 where 条件
                    capturedData.originalRequestParams = {
                        result: resultObj,
                        where: whereConditions,
                        draw: 1,
                        length: CONFIG.PAGE_SIZE,
                        // 构建完整的原始请求体，使用网页查询时使用的 where 条件
                        rawBody: `result=${encodeURIComponent(JSON.stringify(resultObj))}&where=${encodeURIComponent(JSON.stringify(whereConditions))}`,
                        capturedWhereKey: whereKey
                    };
                    
                    console.log('[NQI Export] Built result object with', resultObj.result.length, 'fields');
                    if (whereConditions.length > 0) {
                        console.log('[NQI Export] Where conditions applied:', JSON.stringify(whereConditions[0]));
                    }
                    
                    return resultObj;
                }
            }
            
            // 4. 备用方案：用 DOM 列构建 result
            console.log('[NQI Export] Building result from DOM columns...');
            
            const result = {
                result: columns.map(col => ({
                    feildtype: '报表',
                    table: 'appdbv3.unknown_table',
                    tableName: '数据表格',
                    datatype: '1',
                    feildName: col.name || col.field,
                    feild: col.field,
                    poly: '无',
                    anyWay: '无',
                    chart: '无',
                    chartpoly: '无'
                }))
            };
            
            console.log('[NQI Export] Built result with', result.result.length, 'fields');
            return result;
            
        } catch (e) {
            console.error('[NQI Export] fetchResultDirectly error:', e);
            return null;
        }
    }
    
    /**
     * 从表格区域提取报表名称
     */
    function extractReportNameFromTable() {
        // 排除列表
        const excludeList = ['即席查询', '广东无线网络', '无线网络', '集中优化', 'index', '查询', '搜索', 'dashboard'];
        
        // 1. 尝试从 onclick=Querypage.selecttable 获取
        try {
            // 尝试多种选择器
            const selectors = [
                '[onclick*="selecttable"]',
                '[onclick*="selectTable"]',
                '[onclick*="Querypage"]',
                'a[onclick*="table"]',
                'button[onclick*="table"]',
                'span[onclick*="table"]',
                'div[onclick*="table"]'
            ];
            
            for (const sel of selectors) {
                const elements = document.querySelectorAll(sel);
                for (const el of elements) {
                    const onclick = el.getAttribute('onclick') || '';
                    if (onclick.includes('selecttable') || onclick.includes('selectTable')) {
                        const text = el.textContent.trim();
                        if (text && text.length > 1 && text.length < 100) {
                            const isExcluded = excludeList.some(ex => text.includes(ex));
                            if (!isExcluded) {
                                console.log('[NQI Export] Found from selecttable:', text, 'onclick:', onclick.substring(0, 50));
                                return text;
                            }
                        }
                    }
                }
            }
            
            // 直接搜索包含 selecttable 的 onclick 属性
            const allElements = document.querySelectorAll('*');
            for (const el of allElements) {
                const onclick = el.getAttribute('onclick');
                if (onclick && (onclick.includes('selecttable') || onclick.includes('selectTable'))) {
                    const text = el.textContent.trim();
                    if (text && text.length > 1 && text.length < 100) {
                        const isExcluded = excludeList.some(ex => text.includes(ex));
                        if (!isExcluded) {
                            console.log('[NQI Export] Found from search:', text);
                            return text;
                        }
                    }
                }
            }
        } catch (e) {
            console.log('[NQI Export] selecttable search error:', e);
        }
        
        // 2. 尝试从表格容器获取
        const tableWrapper = document.querySelector('.dataTables_wrapper');
        if (tableWrapper) {
            let container = tableWrapper.parentElement;
            while (container && container !== document.body) {
                if (container.classList?.contains('panel') || 
                    container.classList?.contains('box') ||
                    container.classList?.contains('card')) {
                    
                    const titleEl = container.querySelector('.panel-title, .box-title, .card-title, h3, h4, .title');
                    if (titleEl) {
                        const text = titleEl.textContent.trim();
                        if (text && text.length > 1 && text.length < 100) {
                            const isExcluded = excludeList.some(ex => text.includes(ex));
                            if (!isExcluded) {
                                return text;
                            }
                        }
                    }
                }
                container = container.parentElement;
            }
        }
        
        // 3. 尝试查找表格上方的标题
        const titleEl = document.querySelector('.content-header h1, .content-header h3, .page-header h1');
        if (titleEl) {
            const text = titleEl.textContent.trim();
            if (text && text.length > 1 && text.length < 100) {
                const isExcluded = excludeList.some(ex => text.includes(ex));
                if (!isExcluded) {
                    return text;
                }
            }
        }
        
        // 4. 从 URL 参数
        const urlParams = new URLSearchParams(window.location.search);
        const key = urlParams.get('key');
        if (key) {
            const decoded = decodeURIComponent(key);
            const isExcluded = excludeList.some(ex => decoded.includes(ex));
            if (!isExcluded) {
                return decoded;
            }
        }
        
        return null;
    }
    
    /**
     * 直接从 HAR 日志或 onclick 提取 result 参数
     */
    async function extractResultFromHAR(tableName) {
        console.log('[NQI Export] extractResultFromHAR for:', tableName);
        
        // 1. 首先尝试从 getSelectTable 获取字段配置
        try {
            const response = await fetch(`${CONFIG.API_BASE}/getSelectTable`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                credentials: 'include',
                body: `tablename=${encodeURIComponent(tableName)}`
            });

            const data = await response.json();
            console.log('[NQI Export] getSelectTable response keys:', Object.keys(data));
            
            if (data.CFG_ADHOC_CONF_TABLE && data.CFG_ADHOC_CONF_TABLE.length > 0) {
                // 保存所有字段用于构建 result
                const fields = data.CFG_ADHOC_CONF_TABLE.map(item => ({
                    feildtype: item.fieldtype || '',
                    table: item.tablename,
                    tableName: item.tablename_cn || tableName,
                    datatype: item.datatype || '1',
                    feildName: item.columnname_cn || '',
                    feild: item.columnname || '',
                    poly: '无',
                    anyWay: '无',
                    chart: '无',
                    chartpoly: '无'
                }));
                
                capturedData.tableFields = fields;
                console.log('[NQI Export] Got tableFields from getSelectTable:', fields.length);
                
                // 构建 result 对象
                return {
                    result: fields,
                    tableParams: {
                        supporteddimension: null,
                        supportedtimedimension: data.CFG_ADHOC_CONF_TABLE[0]?.timedimension || '天'
                    },
                    columnname: ''
                };
            }
        } catch (e) {
            console.error('[NQI Export] getSelectTable error:', e);
        }
        
        return null;
    }
    
    /**
     * 从 onclick 属性提取数据库表名
     * 例如: QueryPage.selectTable('appdbv3.a_interfere_nr_cell')
     */
    function extractTableNameFromOnclick() {
        try {
            // 查找所有包含 selecttable 或 selectTable 的 onclick 属性
            const allElements = document.querySelectorAll('*');
            
            for (const el of allElements) {
                const onclick = el.getAttribute('onclick');
                if (onclick && (onclick.includes('selecttable') || onclick.includes('selectTable'))) {
                    // 尝试匹配 tableName:xxx 或 'tablename' 格式
                    const tableNamePatterns = [
                        /tableName:\s*['"]([^'"]+)['"]/,
                        /selectTable\s*\(\s*['"]([^'"]+)['"]/i,
                        /selecttable\s*\(\s*['"]([^'"]+)['"]/i
                    ];
                    
                    for (const pattern of tableNamePatterns) {
                        const match = onclick.match(pattern);
                        if (match && match[1]) {
                            const tableName = match[1];
                            // 验证看起来像数据库表名（通常包含点号）
                            if (tableName.includes('.') || tableName.startsWith('appdb') || tableName.startsWith('v3_')) {
                                console.log('[NQI Export] Found table name from onclick:', tableName);
                                return tableName;
                            }
                        }
                    }
                    
                    // 如果没匹配到上面的模式，尝试直接提取 onclick 中的引号内容
                    const quoteMatch = onclick.match(/['"]([a-zA-Z0-9_.]+)['"]/);
                    if (quoteMatch && quoteMatch[1]) {
                        const potentialTable = quoteMatch[1];
                        if (potentialTable.includes('.') || potentialTable.includes('_')) {
                            console.log('[NQI Export] Found potential table from onclick quotes:', potentialTable);
                            return potentialTable;
                        }
                    }
                }
            }
        } catch (e) {
            console.log('[NQI Export] extractTableNameFromOnclick error:', e);
        }
        
        return null;
    }
    
    /**
     * 从 DOM 提取表名
     */
    function extractTableNameFromDOM() {
        // 排除的通用标题
        const excludeList = ['即席查询', 'adhoc', 'index', '查询', '搜索'];
        
        // 1. 尝试从表格容器获取标题
        const tableWrapper = document.querySelector('.dataTables_wrapper');
        if (tableWrapper) {
            // 查找表格上方的标题
            const container = tableWrapper.closest('.panel, .box, .card, [class*="panel"]');
            if (container) {
                // 查找标题元素
                const titleSelectors = [
                    '.panel-heading .panel-title',
                    '.box-header .box-title', 
                    '.card-header .card-title',
                    '.panel-heading h3',
                    '.box-header h3',
                    'h3.title',
                    '.title',
                    '[class*="title"]'
                ];
                
                for (const sel of titleSelectors) {
                    const el = container.querySelector(sel);
                    if (el) {
                        const text = el.textContent.trim();
                        if (text && text.length > 1 && text.length < 100) {
                            const isExcluded = excludeList.some(ex => text.includes(ex));
                            if (!isExcluded) {
                                console.log('[NQI Export] Found title in table container:', text);
                                return text;
                            }
                        }
                    }
                }
                
                // 尝试直接从容器获取标题
                const directText = container.textContent.trim().split('\n')[0].trim();
                if (directText && directText.length > 1 && directText.length < 100) {
                    const isExcluded = excludeList.some(ex => directText.includes(ex));
                    if (!isExcluded) {
                        console.log('[NQI Export] Found title from container:', directText);
                        return directText;
                    }
                }
            }
        }
        
        // 2. 尝试标准选择器
        const selectors = [
            '.panel-title',
            '.box-title',
            '.content-header h1',
            '.content-header h3',
            'h1.page-title',
            'h3.page-title',
            '.page-title',
            '.form-title'
        ];
        
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
                const text = el.textContent.trim();
                if (text && text.length > 1 && text.length < 100) {
                    const isExcluded = excludeList.some(ex => text.includes(ex));
                    if (!isExcluded) {
                        console.log('[NQI Export] Found title with', sel, ':', text);
                        return text;
                    }
                }
            }
        }
        
        // 3. 从 URL 获取
        const urlParams = new URLSearchParams(window.location.search);
        const key = urlParams.get('key');
        if (key) {
            const decoded = decodeURIComponent(key);
            console.log('[NQI Export] Found title from URL:', decoded);
            return decoded;
        }
        
        // 4. 从 document title 获取
        const docTitle = document.title.split('-')[0].trim();
        if (docTitle && !excludeList.some(ex => docTitle.includes(ex))) {
            console.log('[NQI Export] Found title from document:', docTitle);
            return docTitle;
        }
        
        return null;
    }
    
    /**
     * 从 DOM 表格提取列信息
     */
    /**
     * 从 DOM 提取 where 条件
     * 增强版本：只提取真正的筛选字段（地市、网格等），过滤掉无关字段
     */
    function extractWhereFromDOM() {
        // 尝试从页面上的输入框获取查询条件
        const where = [];
        const foundInputs = new Set();
        
        // 0. 首先尝试从全局变量获取（最可靠）
        const globalWhereSources = [
            window.searchWhere,
            window.searchParam?.where,
            window.queryParam?.where,
            window.adhocParam?.where,
            window.searchConfig?.where,
            window.gridParam?.where,
            window.cityParam?.where
        ];
        
        for (const source of globalWhereSources) {
            if (source && Array.isArray(source) && source.length > 0) {
                console.log('[NQI Export] Found where conditions from global variable:', source.length);
                return source;
            }
        }
        
        // 0.5. 尝试从 URL 参数获取时间条件
        const urlParams = new URLSearchParams(window.location.search);
        const datesub = urlParams.get('datesub');
        if (datesub) {
            console.log('[NQI Export] Found datesub in URL:', datesub);
            // 格式可能是: "2026-05-31 ~ 2026-05-31" 或 "2026-05-31~2026-05-31"
            const dateMatch = datesub.match(/(\d{4}-\d{2}-\d{2})\s*~?\s*(\d{4}-\d{2}-\d{2})?/);
            if (dateMatch) {
                const startDate = dateMatch[1];
                const endDate = dateMatch[2] || startDate;
                
                if (startDate) {
                    where.push({
                        datatype: 'timestamp',
                        feild: 'starttime',
                        feildName: '数据时间',
                        symbol: '>=',
                        val: startDate + ' 00:00:00',
                        whereCon: 'and',
                        query: true
                    });
                }
                if (endDate) {
                    where.push({
                        datatype: 'timestamp',
                        feild: 'starttime',
                        feildName: '数据时间',
                        symbol: '<',
                        val: endDate + ' 23:59:59',
                        whereCon: 'and',
                        query: true
                    });
                }
                console.log('[NQI Export] Extracted time from URL: start=', startDate, 'end=', endDate);
            }
        }
        
        // 0.6. 尝试从全局变量获取日期（如页面上的 laydate 组件存储的值）
        const dateSources = [
            window.searchParam?.startTime,
            window.searchParam?.endTime,
            window.queryParam?.startTime,
            window.queryParam?.endTime,
            window.startTime,
            window.endTime
        ];
        
        for (const dateVal of dateSources) {
            if (dateVal && typeof dateVal === 'string' && dateVal.match(/\d{4}-\d{2}-\d{2}/)) {
                console.log('[NQI Export] Found date from global variable:', dateVal);
                // 如果已经有了 startDate 和 endDate，跳过
                const hasStartTime = where.some(w => w.feild === 'starttime' && w.symbol === '>=');
                const hasEndTime = where.some(w => w.feild === 'starttime' && w.symbol === '<');
                
                if (!hasStartTime && !hasEndTime) {
                    // 单日查询
                    where.push({
                        datatype: 'timestamp',
                        feild: 'starttime',
                        feildName: '数据时间',
                        symbol: '>=',
                        val: dateVal + ' 00:00:00',
                        whereCon: 'and',
                        query: true
                    });
                    where.push({
                        datatype: 'timestamp',
                        feild: 'starttime',
                        feildName: '数据时间',
                        symbol: '<',
                        val: dateVal + ' 23:59:59',
                        whereCon: 'and',
                        query: true
                    });
                }
                break;
            }
        }
        
        // 1. 尝试从拦截器捕获的条件中获取（如果 DOM 提取失败）
        if (capturedData.lastRequestBody) {
            try {
                const params = new URLSearchParams(capturedData.lastRequestBody);
                const rawWhere = params.get('where');
                if (rawWhere) {
                    const whereObj = JSON.parse(decodeURIComponent(rawWhere));
                    if (Array.isArray(whereObj) && whereObj.length > 0) {
                        console.log('[NQI Export] Found where from interceptor:', whereObj.length);
                        return whereObj;
                    }
                }
            } catch (e) {}
        }
        
        // 2. 尝试从 laydate 日期选择器获取
        const dateInputs = document.querySelectorAll(
            '.layui-laydate input,' +
            '.laydate-input,' +
            'input[lay-date],' +
            'input[class*="laydate"],' +
            'input.Wdate,' +
            'input[class*="Wdate"]'
        );
        
        let startDate = null;
        let endDate = null;
        
        dateInputs.forEach(input => {
            if (foundInputs.has(input)) return;
            
            const value = input.value || input.defaultValue || '';
            const name = input.name || input.id || input.className || '';
            
            if (value && value.match(/\d{4}-\d{2}-\d{2}/)) {
                foundInputs.add(input);
                console.log('[NQI Export] Laydate input:', name, '=', value);
                
                if (name.includes('start') || name.includes('Start') || 
                    name.includes('begin')) {
                    startDate = value;
                } else if (name.includes('end') || name.includes('End')) {
                    endDate = value;
                } else if (!startDate) {
                    startDate = value;
                } else {
                    endDate = value;
                }
            }
        });
        
        // 如果还没有时间条件，使用从 laydate 输入框获取的值
        const hasTimeCondition = where.some(w => w.feild === 'starttime');
        if (!hasTimeCondition) {
            if (startDate) {
                where.push({
                    datatype: 'timestamp',
                    feild: 'starttime',
                    feildName: '数据时间',
                    symbol: '>=',
                    val: startDate + (startDate.length === 10 ? ' 00:00:00' : ''),
                    whereCon: 'and',
                    query: true
                });
            }
            
            if (endDate) {
                where.push({
                    datatype: 'timestamp',
                    feild: 'starttime',
                    feildName: '数据时间',
                    symbol: '<',
                    val: endDate + (endDate.length === 10 ? ' 23:59:59' : ''),
                    whereCon: 'and',
                    query: true
                });
            }
        }
        
        // 3. 从表单中获取筛选字段
        // 扩大筛选字段范围以支持更多报表类型，同时避免遗漏其他字段
        // 只排除已知的无关字段，其他都尝试捕获
        const excludePatterns = ['poly', 'anyWay', 'chartType', 'chartPoly', 'table', 'tableType', 'ispublic'];
        // 已知的有效筛选字段（数据库字段名）
        // 根据用户提供的查询条件映射：
        // 粒度: datetype (小时/天/周/月/忙时/15分钟)
        // 地市: city
        // 维度: dimension (小区/网格/地市/人力区县分公司)
        // 网格: grid
        // 人力区县分公司: county
        // 基站: enodeb_id/gnodeb_id
        // 小区: cell
        // ECI: eci
        const knownFilterFields = {
            'city': 'city', 
            'grid': 'grid', 
            'area': 'area', 
            'region': 'region',
            'county': 'county',        // 人力区县分公司
            'network_type': 'network_type', 
            'networkmode': 'network_type',
            'vendor': 'vendor', 
            'state': 'state', 
            'band': 'band',
            'frequency': 'frequency', 
            'earfcn': 'frequency',
            'network_mode': 'network_type', 
            'gnodeb': 'gnodeb_id', 
            'gnodeb_id': 'gnodeb_id',
            'enodeb': 'enodeb_id', 
            'enodeb_id': 'enodeb_id',
            'cell': 'cell', 
            'province': 'province', 
            'street': 'street',
            'scene': 'scene', 
            'direction': 'direction', 
            'pci': 'pci', 
            'tac': 'tac',
            'device_type': 'device_type', 
            'device': 'device_type',
            'equipment': 'equipment', 
            'manufacturer': 'manufacturer',
            'dimension': 'dimension', 
            'level': 'level',
            'datetype': 'datetype', 
            'maptop': 'maptop', 
            'map-top': 'maptop',
            'eci': 'eci',              // ECI
            'hour': 'hour',            // 小时
            'minute': 'minute'         // 分钟(15分钟粒度)
        };
        
        // 调试：列出页面上所有的 select 元素
        const allSelects = document.querySelectorAll('select');
        console.log('[NQI Export] Page has', allSelects.length, 'select elements');
        
        // 遍历所有 select 元素
        document.querySelectorAll('select').forEach(select => {
            if (foundInputs.has(select)) return;
            
            const name = select.name || select.id || '';
            const className = select.className || '';
            
            // 跳过无关字段
            const shouldExclude = excludePatterns.some(pattern => 
                name.includes(pattern) || className.includes(pattern)
            );
            if (shouldExclude) {
                console.log('[NQI Export] Skipping excluded select:', name, '(class:', className, ')');
                return;
            }
            
            // 检查是否已选中了值
            const selectedOptions = Array.from(select.options).filter(opt => opt.selected && opt.value);
            
            if (selectedOptions.length > 0 && selectedOptions[0].value) {
                foundInputs.add(select);
                
                // 尝试映射到已知的数据库字段名
                let field = null;
                for (const [key, dbField] of Object.entries(knownFilterFields)) {
                    if (name.includes(key)) {
                        field = dbField;
                        break;
                    }
                }
                
                // 如果没有匹配到已知字段，使用 name 作为字段名（可能是新的字段）
                if (!field) {
                    field = name;
                }
                
                const symbol = selectedOptions.length > 1 ? 'in' : '=';
                const value = selectedOptions.map(opt => opt.text || opt.value).join(',');
                
                if (value) {
                    where.push({
                        datatype: 'character',
                        feild: field,
                        feildName: '',
                        symbol: symbol,
                        val: value,
                        whereCon: 'and',
                        query: true
                    });
                    console.log('[NQI Export] Captured filter select:', name, '->', field, '=', value);
                }
            }
        });
        
        // 4. 尝试从隐藏的输入框获取
        const hiddenInputs = document.querySelectorAll('input[type="hidden"]');
        hiddenInputs.forEach(input => {
            if (foundInputs.has(input)) return;
            
            const name = input.name;
            const value = input.value;
            
            if (value && value.trim() && value !== '') {
                foundInputs.add(input);
                
                // 尝试映射到已知的数据库字段名
                let field = null;
                for (const [key, dbField] of Object.entries(knownFilterFields)) {
                    if (name.includes(key)) {
                        field = dbField;
                        break;
                    }
                }
                
                // 如果没有匹配到已知字段，使用 name 作为字段名
                if (!field) {
                    field = name;
                }
                
                where.push({
                    datatype: 'character',
                    feild: field,
                    feildName: '',
                    symbol: '=',
                    val: value,
                    whereCon: 'and',
                    query: true
                });
                console.log('[NQI Export] Captured hidden input:', name, '->', field, '=', value);
            }
        });
        
        console.log('[NQI Export] extractWhereFromDOM: found', where.length, 'conditions');
        return where.length > 0 ? where : null;
    }
    
    /**
     * 从 DOM 表格提取列信息
     */
    function extractColumnsFromDOM() {
        const columns = [];
        
        // 查找表头
        const thead = document.querySelector('.dataTables_wrapper thead') ||
                     document.querySelector('table thead') ||
                     document.querySelector('[class*="dataTables"] thead');
        
        if (thead) {
            const ths = thead.querySelectorAll('th');
            console.log('[NQI Export] Found thead with', ths.length, 'th elements');
            
            ths.forEach((th, i) => {
                // 尝试获取 data 属性
                const dataField = th.getAttribute('data-column') || 
                                 th.getAttribute('data-name') ||
                                 th.getAttribute('data-field') ||
                                 th.getAttribute('data');
                
                const text = th.textContent.trim();
                
                if (dataField) {
                    columns.push({ field: dataField, name: text });
                    if (i < 3) console.log('[NQI Export] Column', i, ':', dataField, '/', text);
                } else if (text && text.length > 0 && text.length < 50) {
                    // 转换中文名为英文
                    const field = text.replace(/[\u4e00-\u9fa5]/g, '_').toLowerCase().replace(/\s+/g, '_');
                    columns.push({ field: field, name: text });
                    if (i < 3) console.log('[NQI Export] Column (from text)', i, ':', field, '/', text);
                }
            });
        } else {
            console.log('[NQI Export] No thead found, trying tbody...');
        }
        
        // 如果表头没有足够信息，尝试从第一行数据推断
        if (columns.length < 2) {
            const firstRow = document.querySelector('.dataTables_wrapper tbody tr:first-child, table tbody tr:first-child');
            if (firstRow) {
                const cells = firstRow.querySelectorAll('td');
                console.log('[NQI Export] Using first row, found', cells.length, 'cells');
                
                cells.forEach((cell, i) => {
                    const text = cell.textContent.trim();
                    if (text) {
                        const field = 'col_' + (i + 1);
                        columns.push({ field: field, name: text.substring(0, 20) });
                        if (i < 3) console.log('[NQI Export] Cell', i, ':', field, '/', text);
                    }
                });
            }
        }
        
        console.log('[NQI Export] extractColumnsFromDOM: found', columns.length, 'columns');
        return columns;
    }

    async function fetchTableConfig(tablename) {
        try {
            console.log('[NQI Export] fetchTableConfig:', tablename);
            
            const response = await fetch(`${CONFIG.API_BASE}/getSelectTable`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                credentials: 'include',
                body: `tablename=${encodeURIComponent(tablename)}`
            });

            if (!response.ok) return null;

            const data = await response.json();
            console.log('[NQI Export] getSelectTable response keys:', Object.keys(data));
            
            if (data.CFG_ADHOC_CONF_TABLE && data.CFG_ADHOC_CONF_TABLE.length > 0) {
                // 保存所有字段用于构建 result
                capturedData.tableFields = data.CFG_ADHOC_CONF_TABLE.map(item => ({
                    feildtype: item.tablename_cn || item.fieldtype,
                    table: item.tablename,
                    tableName: item.tablename_cn,
                    datatype: item.datatype,
                    feildName: item.columnname_cn,
                    feild: item.columnname,
                    poly: '无',
                    anyWay: '无',
                    chart: '无',
                    chartpoly: '无'
                }));
                
                const conf = data.CFG_ADHOC_CONF_TABLE[0];
                return {
                    geographicdimension: conf.geographicdimension || '小区',
                    timedimension: conf.timedimension || '天',
                    enodebField: conf.enodeb_field || 'enodeb_id',
                    cgiField: conf.cgi_field || 'cgi',
                    timeField: conf.time_field || 'starttime',
                    cellField: conf.cell_field || 'cell',
                    cityField: conf.city_field || 'city',
                    tableName: conf.tablename_cn || conf.tablename
                };
            }
        } catch (e) {
            console.error('[NQI Export] fetchTableConfig error:', e);
        }
        return null;
    }

    // ========== 数据提取 ==========

    async function extractTableData(params) {
        console.log('[NQI Export] extractTableData: Starting data extraction');
        
        // 策略1: 尝试从页面的 DataTables API 获取完整数据
        const dtData = extractFromDataTables();
        if (dtData && dtData.length > 0) {
            console.log('[NQI Export] Successfully extracted', dtData.length, 'rows from DataTables API');
            return dtData;
        }
        
        // 策略2: 尝试使用保存的请求参数通过 API 获取
        const hasSavedRequest = capturedData.successfulRequestBody || capturedData.originalRequestParams?.rawBody;
        console.log('[NQI Export] Has saved request params:', !!hasSavedRequest);
        
        // ========== 打印所有保存的参数用于调试 ==========
        console.log('');
        console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
        console.log('║ [NQI Export] ========== SAVED PARAMS DEBUG ==========                  ║');
        console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
        console.log('║ successfulRequestBody exists:', !!capturedData.successfulRequestBody);
        if (capturedData.successfulRequestBody) {
            console.log('║ successfulRequestBody length:', capturedData.successfulRequestBody.length);
            console.log('║ successfulRequestBody (first 300 chars):', capturedData.successfulRequestBody.substring(0, 300));
        }
        console.log('║ originalRequestParams exists:', !!capturedData.originalRequestParams);
        if (capturedData.originalRequestParams) {
            console.log('║ originalRequestParams.rawBody exists:', !!capturedData.originalRequestParams.rawBody);
            console.log('║ originalRequestParams.rawBody length:', capturedData.originalRequestParams.rawBody?.length || 0);
            console.log('║ originalRequestParams.columns exists:', !!capturedData.originalRequestParams.columns);
            console.log('║ originalRequestParams.order exists:', !!capturedData.originalRequestParams.order);
            console.log('║ originalRequestParams.result exists:', !!capturedData.originalRequestParams.result);
            console.log('║ originalRequestParams.where count:', capturedData.originalRequestParams.where?.length || 0);
        }
        console.log('║ capturedData.where count:', capturedData.where?.length || 0);
        console.log('║ lastGetTableParams exists:', !!capturedData.lastGetTableParams);
        if (capturedData.lastGetTableParams) {
            console.log('║ lastGetTableParams.rawBody length:', capturedData.lastGetTableParams.rawBody?.length || 0);
        }
        console.log('║ tableFields count:', capturedData.tableFields?.length || 0);
        console.log('║ tableConfig:', capturedData.tableConfig);
        console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
        console.log('');
        
        if (hasSavedRequest) {
            console.log('[NQI Export] Has saved request params, using API to get full data');
            
            const allRows = [];
            let page = 1;
            let draw = 1;
            let retries = 0;

            const total = getTotalRowsFromDOM();
            
            if (total > 0) {
                updateExportProgress(0, total, '开始导出...');

                while (allRows.length < total) {
                    try {
                        const pageData = await fetchPageData(page, draw, params);
                        
                        if (!pageData || pageData.length === 0) {
                            retries++;
                            if (retries >= CONFIG.MAX_RETRIES) break;
                            await sleep(1000);
                            continue;
                        }

                        allRows.push(...pageData);
                        updateExportProgress(allRows.length, total, `获取 ${allRows.length}/${total}...`);
                        console.log('[NQI Export] Fetched page', page, 'total:', allRows.length);

                        if (pageData.length < CONFIG.PAGE_SIZE) {
                            break;
                        }
                        
                        page++;
                        draw++;
                        await sleep(300);
                    } catch (error) {
                        console.error('[NQI Export] Page fetch error:', error);
                        retries++;
                        if (retries >= CONFIG.MAX_RETRIES) break;
                        await sleep(1000);
                    }
                }

                if (allRows.length > 0) {
                    console.log('[NQI Export] Successfully extracted', allRows.length, 'rows via API');
                    return allRows;
                }
            }
        }
        
        // 策略3: 尝试模拟页面翻页来获取完整数据
        const pageData = await extractViaSimulatedPagination();
        if (pageData && pageData.length > 0) {
            console.log('[NQI Export] Successfully extracted', pageData.length, 'rows via simulated pagination');
            return pageData;
        }
        
        // 最终回退到 DOM 提取（只提取当前页面的数据）
        console.log('[NQI Export] Falling back to DOM extraction');
        const domData = extractDataFromDOM();
        if (domData.length > 0) {
            console.log('[NQI Export] Successfully extracted', domData.length, 'rows from DOM');
            
            const domCount = getTotalRowsFromDOM();
            if (domCount > domData.length) {
                console.log('[NQI Export] WARNING: Only extracted', domData.length, 'rows from current page, but total is', domCount);
                showToast(`注意：只导出了当前页面的 ${domData.length} 条数据（共 ${domCount} 条）`, 'warning');
            }
            
            return domData;
        }
        
        showToast('未获取到数据', 'error');
        return [];
    }

    // ========== 模拟翻页策略 ==========

    async function extractViaSimulatedPagination() {
        console.log('[NQI Export] Starting simulated pagination extraction');
        
        const total = getTotalRowsFromDOM();
        if (total <= CONFIG.PAGE_SIZE) {
            console.log('[NQI Export] Total rows <= PAGE_SIZE, no pagination needed');
            return extractDataFromDOM();
        }
        
        // 首先保存当前是第一页的状态
        const originalRows = extractDataFromDOM();
        if (originalRows.length === 0) {
            return null;
        }
        
        console.log('[NQI Export] Total:', total, 'rows, need to paginate through', Math.ceil(total / CONFIG.PAGE_SIZE), 'pages');
        
        const allRows = [...originalRows];
        
        // 方法1: 尝试使用 jQuery DataTables API 翻页
        if (typeof $ !== 'undefined') {
            try {
                const dtResult = await extractViaDataTablesAPI(total);
                if (dtResult && dtResult.length > 0) {
                    return dtResult;
                }
            } catch (e) {
                console.log('[NQI Export] DataTables API method failed:', e.message);
            }
        }
        
        // 方法2: 尝试使用原生 DataTables 实例翻页
        try {
            const nativeResult = await extractViaNativeDataTables(total);
            if (nativeResult && nativeResult.length > 0) {
                return nativeResult;
            }
        } catch (e) {
            console.log('[NQI Export] Native DataTables method failed:', e.message);
        }
        
        // 方法3: 直接模拟点击翻页按钮
        const buttonResult = await extractViaButtonClick(total);
        if (buttonResult && buttonResult.length > 0) {
            return buttonResult;
        }
        
        console.log('[NQI Export] All pagination methods failed');
        return null;
    }

    async function extractViaDataTablesAPI(total) {
        console.log('[NQI Export] Trying jQuery DataTables API method');
        
        const tables = $('.dataTable, [id^="DataTables"], table.dataTable');
        
        for (const table of tables) {
            try {
                const api = $(table).DataTable();
                if (!api || !api.page) continue;
                
                const pageCount = api.page.info().pages;
                console.log('[NQI Export] DataTables found with', pageCount, 'pages');
                
                const allData = [];
                
                // 获取当前页数据
                const currentData = api.rows().data().toArray();
                allData.push(...currentData);
                
                // 逐页翻页获取
                for (let i = 1; i < pageCount; i++) {
                    api.page(i).draw(false);
                    await sleep(500);
                    
                    const pageData = api.rows().data().toArray();
                    allData.push(...pageData);
                    
                    updateExportProgress(allData.length, total, `获取第 ${i + 1}/${pageCount} 页...`);
                    console.log('[NQI Export] Page', i + 1, ':', pageData.length, 'rows, total:', allData.length);
                }
                
                // 返回第一页
                api.page(0).draw(false);
                
                if (allData.length > 0) {
                    console.log('[NQI Export] DataTables API extracted', allData.length, 'rows');
                    return convertDataTablesToObjects(allData, api);
                }
            } catch (e) {
                console.log('[NQI Export] DataTables API error:', e.message);
            }
        }
        
        return null;
    }

    async function extractViaNativeDataTables(total) {
        console.log('[NQI Export] Trying native DataTables method');
        
        // 查找所有 DataTables 实例
        const wrappers = document.querySelectorAll('.dataTables_wrapper');
        
        for (const wrapper of wrappers) {
            try {
                const table = wrapper.querySelector('table');
                if (!table) continue;
                
                // 尝试从 table 元素获取 DataTables API
                if (table.api) {
                    const api = table.api();
                    if (api && api.page) {
                        const pageCount = api.page.info().pages;
                        console.log('[NQI Export] Native DataTables found with', pageCount, 'pages');
                        
                        const allData = [];
                        
                        for (let i = 0; i < pageCount; i++) {
                            api.page(i).draw(false);
                            await sleep(500);
                            
                            const pageData = api.rows().data().toArray();
                            allData.push(...pageData);
                            
                            updateExportProgress(allData.length, total, `获取第 ${i + 1}/${pageCount} 页...`);
                        }
                        
                        // 返回第一页
                        api.page(0).draw(false);
                        
                        if (allData.length > 0) {
                            console.log('[NQI Export] Native DataTables extracted', allData.length, 'rows');
                            return convertDataTablesToObjects(allData, api);
                        }
                    }
                }
            } catch (e) {
                console.log('[NQI Export] Native DataTables error:', e.message);
            }
        }
        
        return null;
    }

    async function extractViaButtonClick(total) {
        console.log('[NQI Export] Trying button click method');
        
        const wrapper = document.querySelector('.dataTables_wrapper');
        if (!wrapper) return null;
        
        // 查找分页控件
        const paginate = wrapper.querySelector('.dataTables_paginate');
        if (!paginate) return null;
        
        // 查找下一页按钮
        const nextBtn = paginate.querySelector('.paginate_button.next:not(.disabled), .next:not(.disabled), [aria-label="下一页"], [aria-label="next"]');
        
        // 如果有下一页按钮，尝试点击
        if (nextBtn) {
            console.log('[NQI Export] Found next button, attempting to paginate');
            
            const allRows = [...extractDataFromDOM()];
            let pageNum = 0;
            const maxPages = Math.ceil(total / CONFIG.PAGE_SIZE);
            
            // 设置拦截器监听新的 API 请求
            let requestInterceptor = null;
            const pageDataMap = new Map();
            
            // 监听 API 请求（通过拦截器已捕获的数据）
            const originalLen = capturedData.interceptedRequests?.length || 0;
            
            for (let i = 0; i < maxPages - 1; i++) {
                // 点击下一页
                nextBtn.click();
                await sleep(800);
                
                // 获取当前页的 DOM 数据
                const pageRows = extractDataFromDOM();
                if (pageRows.length > 0) {
                    allRows.push(...pageRows);
                    pageNum++;
                    updateExportProgress(allRows.length, total, `获取第 ${pageNum + 1}/${maxPages} 页...`);
                    console.log('[NQI Export] Page', pageNum + 1, ':', pageRows.length, 'rows, total:', allRows.length);
                }
                
                // 检查是否已到达最后一页
                const isDisabled = paginate.querySelector('.paginate_button.next.disabled');
                if (isDisabled) {
                    console.log('[NQI Export] Reached last page');
                    break;
                }
            }
            
            // 返回第一页
            const firstBtn = paginate.querySelector('.paginate_button.first, .first');
            if (firstBtn) {
                firstBtn.click();
                await sleep(500);
            }
            
            if (allRows.length > CONFIG.PAGE_SIZE) {
                console.log('[NQI Export] Button click method extracted', allRows.length, 'rows');
                return allRows;
            }
        }
        
        return null;
    }

    function convertDataTablesToObjects(dataArray, api) {
        // 获取列名
        const columns = [];
        try {
            const settings = api.settings();
            if (settings && settings[0] && settings[0].aoColumns) {
                settings[0].aoColumns.forEach((col, i) => {
                    const name = col.sName || col.sTitle || `col_${i}`;
                    columns.push(name);
                });
            }
        } catch (e) {}
        
        // 转换为对象数组
        const result = [];
        for (const row of dataArray) {
            if (Array.isArray(row)) {
                const rowObj = {};
                row.forEach((cell, i) => {
                    rowObj[columns[i] || `col_${i}`] = cell;
                });
                result.push(rowObj);
            } else if (typeof row === 'object') {
                result.push(row);
            }
        }
        
        return result;
    }
    
    // 从 DataTables API 直接获取完整数据
    function extractFromDataTables() {
        console.log('[NQI Export] extractFromDataTables: Trying to get data from DataTables API');
        
        // 尝试从 jQuery DataTables 获取数据
        if (typeof $ !== 'undefined') {
            const tables = $('.dataTable, [id^="DataTables"]');
            for (const table of tables) {
                try {
                    const api = $(table).DataTable();
                    if (api && api.data) {
                        const data = api.data();
                        if (data && data.length > 0) {
                            console.log('[NQI Export] DataTables API returned', data.length, 'rows');
                            
                            // 获取列名
                            const columns = [];
                            const settings = api.settings();
                            if (settings && settings.length > 0 && settings[0].aoColumns) {
                                settings[0].aoColumns.forEach((col, i) => {
                                    const name = col.sName || col.sTitle || `col_${i}`;
                                    columns.push(name);
                                });
                            }
                            
                            // 转换为对象数组
                            const result = [];
                            for (const row of data) {
                                const rowObj = {};
                                if (Array.isArray(row)) {
                                    row.forEach((cell, i) => {
                                        rowObj[columns[i] || `col_${i}`] = cell;
                                    });
                                } else if (typeof row === 'object') {
                                    Object.assign(rowObj, row);
                                }
                                if (Object.keys(rowObj).length > 0) {
                                    result.push(rowObj);
                                }
                            }
                            
                            console.log('[NQI Export] Converted', result.length, 'rows to objects');
                            return result;
                        }
                    }
                } catch (e) {
                    console.log('[NQI Export] DataTables extraction error:', e.message);
                }
            }
        }
        
        // 尝试从原生 DataTables 获取
        try {
            const dtElements = document.querySelectorAll('.dataTables_wrapper');
            for (const wrapper of dtElements) {
                // 尝试找到 DataTables 实例
                const table = wrapper.querySelector('table');
                if (table && table._DT_RowsInData !== undefined) {
                    console.log('[NQI Export] Found DT_RowsInData:', table._DT_RowsInData);
                }
            }
        } catch (e) {}
        
        console.log('[NQI Export] No data from DataTables API');
        return null;
    }

    async function getTotalCount(params) {
        try {
            // 确保 result 有内容
            if (!params.result) {
                console.error('[NQI Export] No result data available');
                return 0;
            }
            
            // result 可能直接是数组，也可能包装在 {result: [...]} 中
            const resultArray = Array.isArray(params.result) 
                ? params.result 
                : params.result.result;
            
            if (!resultArray || resultArray.length === 0) {
                console.error('[NQI Export] result array is empty:', params.result);
                return 0;
            }
            
            const body = buildRequestBody(params, 1, 1, true);
            console.log('[NQI Export] getTotalCount body length:', body.length);
            
            const response = await fetch(`${CONFIG.API_BASE}/getTableCount`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                credentials: 'include',
                body: body
            });

            const data = await response.json();
            console.log('[NQI Export] getTotalCount response:', data);
            
            // 优先使用 API 返回的 count
            let count = data.count;
            
            // 如果 API 没有返回有效 count，尝试从其他字段获取
            if (!count || count === 0) {
                // 尝试从 stat 字段（有些接口用 stat 表示总数）
                if (data.stat && !isNaN(parseInt(data.stat))) {
                    count = parseInt(data.stat);
                }
                // 尝试从 message 中解析
                else if (data.message && !isNaN(parseInt(data.message))) {
                    count = parseInt(data.message);
                }
            }
            
            // 如果 API 仍然返回 0，使用 DOM 中显示的总行数作为备选
            if (!count || count === 0) {
                const domCount = getTotalRowsFromDOM();
                if (domCount > 0) {
                    console.log('[NQI Export] Using DOM count as fallback:', domCount);
                    return domCount;
                }
            }
            
            return count || 0;
        } catch (e) {
            console.error('[NQI Export] getTotalCount error:', e);
            // API 调用失败时，使用 DOM 总数
            const domCount = getTotalRowsFromDOM();
            if (domCount > 0) {
                console.log('[NQI Export] Using DOM count after error:', domCount);
                return domCount;
            }
            return 0;
        }
    }

    async function fetchPageData(page, draw, params) {
        try {
            console.log('[NQI Export] fetchPageData page:', page, 'draw:', draw);
            
            let response;
            let data;
            
            // 优先使用成功返回数据的请求（最可靠！）
            if (capturedData.successfulRequestBody) {
                console.log('[NQI Export] Using successfulRequestBody');
                
                let body = capturedData.successfulRequestBody;
                const bodyParams = new URLSearchParams(body);
                
                // 只更新分页参数，不要修改 where 条件！
                bodyParams.set('draw', draw.toString());
                bodyParams.set('start', ((page - 1) * CONFIG.PAGE_SIZE).toString());
                bodyParams.set('length', CONFIG.PAGE_SIZE.toString());
                
                console.log('[NQI Export] Sending with pagination only, body length:', bodyParams.toString().length);
                
                response = await fetch(`${CONFIG.API_BASE}/getTable`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    credentials: 'include',
                    body: bodyParams.toString()
                });

                data = await response.json();
                console.log('[NQI Export] fetchPageData response:', JSON.stringify(data).substring(0, 300));
                
                if (data.data && Array.isArray(data.data) && data.data.length > 0) {
                    console.log('[NQI Export] SUCCESS with successfulRequestBody, got', data.data.length, 'rows');
                    return data.data;
                } else if (data.result && Array.isArray(data.result) && data.result.length > 0) {
                    return data.result;
                } else {
                    console.log('[NQI Export] successfulRequestBody returned no data');
                }
            }
            
            // 回退：使用 originalRequestParams（可能需要重建 where）
            if (capturedData.originalRequestParams?.rawBody) {
                console.log('[NQI Export] Using originalRequestParams.rawBody as fallback');
                
                const params = capturedData.originalRequestParams;
                
                // 最可靠方案：直接修改原始请求体中的分页参数
                // 先尝试解析原始请求体
                let body = params.rawBody;
                
                // 如果 rawBody 是编码后的字符串，需要解析并重建
                if (typeof body === 'string' && body.includes('=')) {
                    try {
                        const bodyParams = new URLSearchParams(body);
                        
                        // 更新分页参数
                        bodyParams.set('draw', draw.toString());
                        bodyParams.set('start', ((page - 1) * CONFIG.PAGE_SIZE).toString());
                        bodyParams.set('length', CONFIG.PAGE_SIZE.toString());
                        
                        // 更新 where 条件（如果需要）
                        if (capturedData.where?.length > 0) {
                            bodyParams.set('where', encodeURIComponent(JSON.stringify(capturedData.where)));
                            console.log('[NQI Export] Updated where in originalRequestParams:', capturedData.where.length, 'conditions');
                        }
                        
                        // 重建请求体
                        // 注意：需要特殊处理 columns/order/search 等 JSON 参数
                        const newParts = [];
                        for (const [key, value] of bodyParams.entries()) {
                            // columns, order, search, result, where 需要保持编码格式
                            if (['columns', 'order', 'search', 'result', 'where'].includes(key)) {
                                // 这些参数保持原始编码
                                newParts.push(`${key}=${value}`);
                            } else {
                                // 其他参数直接添加
                                newParts.push(`${key}=${encodeURIComponent(value)}`);
                            }
                        }
                        body = newParts.join('&');
                        console.log('[NQI Export] Rebuilt request body from original, body length:', body.length);
                    } catch (e) {
                        console.error('[NQI Export] Failed to parse rawBody, building from scratch:', e);
                        // 回退到构建方式
                        body = null;
                    }
                }
                
                // 如果解析失败，使用构建方式
                if (!body) {
                    const bodyParts = [];
                    
                    // 分页参数
                    bodyParts.push(`draw=${draw}`);
                    bodyParts.push(`start=${(page - 1) * CONFIG.PAGE_SIZE}`);
                    bodyParts.push(`length=${CONFIG.PAGE_SIZE}`);
                    bodyParts.push(`total=0`);
                    
                    // 处理 columns 参数
                    if (params.columns) {
                        let columnsValue = params.columns;
                        if (typeof columnsValue === 'string' && columnsValue.includes('%')) {
                            try {
                                columnsValue = urlDecode(columnsValue);
                                JSON.parse(columnsValue);
                            } catch (e) {}
                        }
                        bodyParts.push(encodeJsonParam('columns', columnsValue));
                    }
                    
                    // 处理 order 参数
                    if (params.order) {
                        let orderValue = params.order;
                        if (typeof orderValue === 'string' && orderValue.includes('%')) {
                            try {
                                orderValue = urlDecode(orderValue);
                                JSON.parse(orderValue);
                            } catch (e) {}
                        }
                        bodyParts.push(encodeJsonParam('order', orderValue));
                    } else {
                        bodyParts.push(encodeJsonParam('order', [{ column: 0, dir: 'desc' }]));
                    }
                    
                    // 添加 search
                    bodyParts.push(encodeJsonParam('search', { value: '', regex: false }));
                    
                    // 处理 result 参数
                    if (params.result) {
                        bodyParts.push(encodeJsonParam('result', params.result));
                    }
                    
                    // 使用最新的 where 条件
                    if (capturedData.where?.length > 0) {
                        bodyParts.push(encodeJsonParam('where', capturedData.where));
                    } else if (params.where) {
                        bodyParts.push(encodeJsonParam('where', params.where));
                    }
                    
                    bodyParts.push(`indexcount=0`);
                    body = bodyParts.join('&');
                    console.log('[NQI Export] Rebuilt request body from scratch, body length:', body.length);
                }
                
                response = await fetch(`${CONFIG.API_BASE}/getTable`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                        'X-Requested-With': 'XMLHttpRequest',
                        'Referer': window.location.href,
                        'Origin': window.location.origin,
                        'Accept': 'application/json, text/javascript, */*; q=0.01',
                        'Accept-Language': 'zh-CN,zh;q=0.9',
                        'sec-ch-ua': '"Chromium";v="147", "Not.A/Brand";v="8"',
                        'sec-ch-ua-mobile': '?0',
                        'sec-ch-ua-platform': '"macOS"',
                        'sec-fetch-dest': 'empty',
                        'sec-fetch-mode': 'cors',
                        'sec-fetch-site': 'same-origin'
                    },
                    credentials: 'include',
                    body: body
                });
                
                // ========== 完整调试日志 ==========
                console.log('');
                console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
                console.log('║ [NQI Export] ========== REQUEST BODY DEBUG ==========                   ║');
                console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
                console.log('║ [1] API URL:', CONFIG.API_BASE + '/getTable');
                console.log('║ [2] Body length:', body.length);
                console.log('║ [3] Body (full):', body);
                console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
                // 解码关键参数用于验证
                try {
                    const params = new URLSearchParams(body);
                    console.log('║ [4] draw:', params.get('draw'));
                    console.log('║ [5] start:', params.get('start'));
                    console.log('║ [6] length:', params.get('length'));
                    console.log('║ [7] total:', params.get('total'));
                    console.log('║ [8] indexcount:', params.get('indexcount'));
                    console.log('║ [9] geographicdimension:', params.get('geographicdimension'));
                    console.log('║ [10] timedimension:', params.get('timedimension'));
                    
                    // columns 参数
                    const columnsVal = params.get('columns');
                    console.log('║ [11] columns exists:', !!columnsVal, 'length:', columnsVal?.length || 0);
                    if (columnsVal) {
                        try {
                            const cols = JSON.parse(decodeURIComponent(columnsVal));
                            console.log('║ [12] columns count:', cols.length);
                        } catch (e) {
                            console.log('║ [12] columns parse failed:', e.message);
                        }
                    }
                    
                    // order 参数
                    const orderVal = params.get('order');
                    console.log('║ [13] order:', orderVal);
                    
                    // search 参数
                    const searchVal = params.get('search');
                    console.log('║ [14] search:', searchVal);
                    
                    // result 参数
                    const resultVal = params.get('result');
                    console.log('║ [15] result exists:', !!resultVal, 'length:', resultVal?.length || 0);
                    if (resultVal) {
                        try {
                            const res = JSON.parse(decodeURIComponent(resultVal));
                            console.log('║ [16] result.result count:', res.result?.length || 0);
                        } catch (e) {
                            console.log('║ [16] result parse failed:', e.message);
                        }
                    }
                    
                    // where 参数
                    const whereVal = params.get('where');
                    console.log('║ [17] where exists:', !!whereVal, 'length:', whereVal?.length || 0);
                    if (whereVal) {
                        try {
                            const wh = JSON.parse(decodeURIComponent(whereVal));
                            console.log('║ [18] where conditions count:', wh.length);
                            console.log('║ [19] where[0]:', JSON.stringify(wh[0]));
                        } catch (e) {
                            console.log('║ [19] where parse failed:', e.message);
                        }
                    }
                } catch (e) {
                    console.log('║ [ERROR] Failed to parse body for logging:', e.message);
                }
                console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
                console.log('║ [20] document.cookie:', document.cookie.substring(0, 200));
                console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
                console.log('');

                data = await response.json();
                console.log('[NQI Export] fetchPageData response:', JSON.stringify(data).substring(0, 300));
                
                if (data.data && Array.isArray(data.data) && data.data.length > 0) {
                    console.log('[NQI Export] SUCCESS with originalRequestParams, got', data.data.length, 'rows');
                    return data.data;
                } else if (data.result && Array.isArray(data.result) && data.result.length > 0) {
                    return data.result;
                } else {
                    console.log('[NQI Export] originalRequestParams returned no data');
                }
            }
            
            // 最后回退：使用 buildRequestBody 构建的请求
            console.log('[NQI Export] Using buildRequestBody as last fallback');
            const effectiveParams = { ...params };
            if (capturedData.where?.length > 0) {
                effectiveParams.where = capturedData.where;
            }
            const buildBody = buildRequestBody(effectiveParams, page, draw, false);
            console.log('[NQI Export] Using buildRequestBody, body length:', buildBody.length);
            
            // ========== buildRequestBody 调试日志 ==========
            console.log('');
            console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
            console.log('║ [NQI Export] ========== BUILDER REQUEST DEBUG ==========                 ║');
            console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
            console.log('║ [1] API URL:', CONFIG.API_BASE + '/getTable');
            console.log('║ [2] Body length:', buildBody.length);
            console.log('║ [3] Body (full):', buildBody);
            console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
            try {
                const params = new URLSearchParams(buildBody);
                console.log('║ [4] draw:', params.get('draw'));
                console.log('║ [5] start:', params.get('start'));
                console.log('║ [6] length:', params.get('length'));
                console.log('║ [7] geographicdimension:', params.get('geographicdimension'));
                console.log('║ [8] timedimension:', params.get('timedimension'));
                
                const resultVal = params.get('result');
                console.log('║ [9] result exists:', !!resultVal, 'length:', resultVal?.length || 0);
                if (resultVal) {
                    try {
                        const res = JSON.parse(decodeURIComponent(resultVal));
                        console.log('║ [10] result.result count:', res.result?.length || 0);
                    } catch (e) {}
                }
                
                const whereVal = params.get('where');
                console.log('║ [11] where exists:', !!whereVal, 'length:', whereVal?.length || 0);
                if (whereVal) {
                    try {
                        const wh = JSON.parse(decodeURIComponent(whereVal));
                        console.log('║ [12] where count:', wh.length);
                    } catch (e) {}
                }
            } catch (e) {}
            console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
            console.log('');
            
                // 检查是否需要获取 JSESSIONID
                function hasCookie(name) {
                    return document.cookie.split(';').some(c => c.trim().startsWith(name + '='));
                }
                
                // 如果没有 JSESSIONID，尝试获取
                if (!hasCookie('JSESSIONID')) {
                    console.log('[NQI Export] No JSESSIONID cookie, attempting to get one...');
                    try {
                        // 模拟 Python 工具获取 JSESSIONID 的方式
                        const castgcMatch = document.cookie.match(/CASTGC=([^;]+)/);
                        const castgc = castgcMatch ? castgcMatch[1] : null;
                        
                        if (castgc) {
                            const jxcxUrl = `${CONFIG.API_BASE}/pro-portal/pure/urlAction.action?url=pro-adhoc/index&__PID=JXCX&random=${Math.random()}&token=${castgc}`;
                            await fetch(jxcxUrl, {
                                method: 'GET',
                                credentials: 'include'
                            });
                            console.log('[NQI Export] Attempted to get JSESSIONID');
                        }
                    } catch (e) {
                        console.error('[NQI Export] Failed to get JSESSIONID:', e);
                    }
                }
                
                console.log('[NQI Export] Current cookies:', document.cookie.substring(0, 300));
                
                response = await fetch(`${CONFIG.API_BASE}/getTable`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                        'X-Requested-With': 'XMLHttpRequest',
                        'Referer': window.location.href,
                        'Origin': window.location.origin,
                        'Accept': 'application/json, text/javascript, */*; q=0.01',
                        'Accept-Language': 'zh-CN,zh;q=0.9',
                        'sec-ch-ua': '"Chromium";v="147", "Not.A/Brand";v="8"',
                        'sec-ch-ua-mobile': '?0',
                        'sec-ch-ua-platform': '"macOS"',
                        'sec-fetch-dest': 'empty',
                        'sec-fetch-mode': 'cors',
                        'sec-fetch-site': 'same-origin'
                    },
                    credentials: 'include',
                    body: buildBody
                });

            data = await response.json();
            console.log('[NQI Export] fetchPageData response:', JSON.stringify(data).substring(0, 300));
            console.log('[NQI Export] fetchPageData response keys:', Object.keys(data));
            
            // 检查是否有错误消息
            if (data.message && typeof data.message === 'string') {
                console.log('[NQI Export] API message:', data.message);
            }
            
            // 检查 recordsFiltered 和 recordsTotal
            if (data.recordsFiltered !== undefined || data.recordsTotal !== undefined) {
                console.log('[NQI Export] DataTables info - filtered:', data.recordsFiltered, 'total:', data.recordsTotal);
            }
            
            // 尝试多种数据格式
            if (data.data && Array.isArray(data.data) && data.data.length > 0) {
                return data.data;
            } else if (data.result && Array.isArray(data.result) && data.result.length > 0) {
                return data.result;
            } else if (Array.isArray(data) && data.length > 0) {
                return data;
            } else if (data.message && Array.isArray(data.message) && data.message.length > 0) {
                return data.message;
            }
            
            console.warn('[NQI Export] Unexpected data format:', {
                keys: Object.keys(data),
                dataNull: data.data === null,
                dataLength: data.data?.length
            });
            
            return [];
        } catch (e) {
            console.error('[NQI Export] fetchPageData error:', e);
            throw e;
        }
    }

    /**
     * URL 编码函数，与 Python 的 quote(str, safe='/:= ') 等效
     * 关键：不编码 :、/、= 和空格字符
     */
    function urlEncode(str) {
        return encodeURIComponent(str)
            .replace(/%3A/g, ':')   // 不编码 :
            .replace(/%2F/g, '/')   // 不编码 /
            .replace(/%3D/g, '=')   // 不编码 =
            .replace(/%20/g, ' ');  // 不编码空格
    }

    /**
     * 解码 URL 编码的字符串
     */
    function urlDecode(str) {
        try {
            return decodeURIComponent(str);
        } catch (e) {
            return str;
        }
    }

    /**
     * 编码 JSON 对象/数组为请求参数格式
     * @param {string} key - 参数名
     * @param {any} value - 参数值（可能是对象、数组或字符串）
     * @returns {string} - 编码后的参数字符串
     */
    function encodeJsonParam(key, value) {
        if (typeof value === 'string') {
            // 如果是字符串，先尝试解码（去除双重编码），再编码
            try {
                const decoded = decodeURIComponent(value);
                JSON.parse(decoded); // 验证是否是 JSON 编码的字符串
                return `${key}=${urlEncode(decoded)}`;
            } catch (e) {
                // 不是 JSON 编码的字符串，直接编码
                return `${key}=${urlEncode(value)}`;
            }
        } else {
            // 对象或数组，转为 JSON 后编码
            return `${key}=${urlEncode(JSON.stringify(value))}`;
        }
    }

    /**
     * 构建请求体 - 与 Python _encode_payload 等效
     */
    function buildRequestBody(params, page, draw, isCount) {
        const parts = [];

        // 如果有原始请求参数，使用原始参数作为基础（最可靠）
        if (params.originalColumns && !isCount) {
            // 使用原始列配置，但更新分页参数
            const origColumns = params.originalColumns;
            const origDraw = params.originalDraw || 1;
            
            // 解析原始列配置
            let origColumnsObj;
            try {
                // 如果是字符串，尝试解码
                if (typeof origColumns === 'string') {
                    origColumnsObj = JSON.parse(urlDecode(origColumns));
                } else {
                    origColumnsObj = origColumns;
                }
            } catch (e) {
                origColumnsObj = null;
            }
            
            // 解析原始排序
            let origOrder = params.originalOrder;
            if (origOrder) {
                try {
                    if (typeof origOrder === 'string') {
                        origOrder = JSON.parse(urlDecode(origOrder));
                    }
                } catch (e) {
                    origOrder = null;
                }
            }
            
            // 使用原始分页配置中的 length，或者使用配置的 PAGE_SIZE
            let origLength;
            if (origColumnsObj && origColumnsObj.length > 0 && origColumnsObj[0].data !== undefined) {
                // 如果 length 参数存在，使用它
                const lengthParam = new URLSearchParams();
                // 保持原始格式，但更新 draw 和 start
                parts.push(`draw=${draw}`);
                parts.push(`start=${(page - 1) * CONFIG.PAGE_SIZE}`);
                parts.push(`length=${CONFIG.PAGE_SIZE}`);
                parts.push(`total=0`);
                // 使用 encodeJsonParam 处理 columns
                parts.push(encodeJsonParam('columns', origColumnsObj));
                if (origOrder) {
                    parts.push(encodeJsonParam('order', origOrder));
                } else {
                    parts.push(encodeJsonParam('order', [{ column: 0, dir: 'desc' }]));
                }
                parts.push(encodeJsonParam('search', { value: '', regex: false }));
                
                // 添加 result
                if (params.result) {
                    parts.push(encodeJsonParam('result', params.result));
                }
                
                // 添加 where
                if (params.where) {
                    parts.push(encodeJsonParam('where', params.where));
                }
                
                parts.push(`indexcount=0`);
                
                console.log('[NQI Export] buildRequestBody: using original columns format');
                return parts.join('&');
            }
        }
        
        // ========== 添加缺失参数的默认值 ==========
        // 从 tableConfig 获取维度参数
        const tableConfig = capturedData.tableConfig || {};
        const geographicdimension = params.geographicdimension || tableConfig.geographicdimension || '小区';
        const timedimension = params.timedimension || tableConfig.timedimension || '天';
        const enodebField = params.enodebField || tableConfig.enodebField || 'gnodeb_id';
        const cgiField = params.cgiField || tableConfig.cgiField || 'cgi';
        const timeField = params.timeField || tableConfig.timeField || 'starttime';
        const cellField = params.cellField || tableConfig.cellField || 'cell';
        const cityField = params.cityField || tableConfig.cityField || 'city';
        
        // 分页参数
        if (!isCount) {
            parts.push(`draw=${draw}`);
            parts.push(`start=${(page - 1) * CONFIG.PAGE_SIZE}`);
            parts.push(`length=${CONFIG.PAGE_SIZE}`);
        }

        // 添加 total 参数
        parts.push(`total=0`);

        // 字段映射 - 始终添加这些参数！
        parts.push(`geographicdimension=${encodeURIComponent(geographicdimension)}`);
        parts.push(`timedimension=${encodeURIComponent(timedimension)}`);
        parts.push(`enodebField=${encodeURIComponent(enodebField)}`);
        parts.push(`cgiField=${encodeURIComponent(cgiField)}`);
        parts.push(`timeField=${encodeURIComponent(timeField)}`);
        parts.push(`cellField=${encodeURIComponent(cellField)}`);
        parts.push(`cityField=${encodeURIComponent(cityField)}`);

        // 构建 columns 参数（DataTables 格式）
        if (!isCount) {
            if (params.columns && Array.isArray(params.columns)) {
                const columns = params.columns.map((col, i) => ({
                    data: col.field || col.feild || col.name || `col_${i}`,
                    name: '',
                    searchable: true,
                    orderable: true,
                    search: { value: '', regex: false }
                }));
                parts.push(`columns=${encodeURIComponent(JSON.stringify(columns))}`);
            }
            
            // 添加排序参数
            parts.push(`order=${encodeURIComponent(JSON.stringify([{ column: 0, dir: 'desc' }]))}`);
            parts.push(`search=${encodeURIComponent(JSON.stringify({ value: '', regex: false }))}`);
        }

        // 核心参数 - result 格式按照文档要求
        if (params.result) {
            let resultArray;
            
            // 提取 result 数组
            if (params.result.result && Array.isArray(params.result.result)) {
                resultArray = params.result.result;
            } else if (Array.isArray(params.result)) {
                resultArray = params.result;
            } else {
                resultArray = [];
            }
            
            // 构建完整的 result 对象
            const resultObj = {
                result: resultArray,
                tableParams: {
                    supporteddimension: null,
                    supportedtimedimension: timedimension
                },
                columnname: ''
            };
            
            parts.push(`result=${encodeURIComponent(JSON.stringify(resultObj))}`);
        }
        
        // where 参数
        if (params.where) {
            parts.push(`where=${encodeURIComponent(JSON.stringify(params.where))}`);
        }

        parts.push(`indexcount=0`);

        console.log('[NQI Export] buildRequestBody: generated', parts.length, 'params');
        console.log('[NQI Export] buildRequestBody params:', parts.map(p => p.split('=')[0]).join(', '));
        return parts.join('&');
    }

    async function loadXlsxLibViaBackground() {
        if (xlsxLib) return xlsxLib;
        if (typeof XLSX !== 'undefined') {
            xlsxLib = XLSX;
            return xlsxLib;
        }
        try {
            const resp = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({ action: 'loadXlsxLib' }, r => {
                    if (r?.success) resolve(r); else reject(r);
                });
            });
            if (resp?.code) {
                const fn = new Function(resp.code);
                fn();
                xlsxLib = window.XLSX;
                console.log('[NQI Export] XLSX loaded via background relay');
                return xlsxLib;
            }
        } catch(e) { console.error('[NQI] XLSX via BG failed:', e); }
        return null;
    }

    // ========== 文件生成 ==========

    async function generateExcel(data) {
        const xlsx = await loadXlsxLibViaBackground();
        
        if (!xlsx) {
            console.log('[NQI Export] XLSX not available, falling back to CSV');
            generateCSV(data);
            return;
        }

        // 获取中英文列名映射
        const columnMapping = getColumnMapping();
        console.log('[NQI Export] Column mapping for Excel:', columnMapping);
        
        // 获取实际数据字段名
        const actualColumns = Object.keys(data[0]);
        
        // 构建最终使用的列配置：使用中文表头 + 对应的英文字段名
        const columns = [];
        columnMapping.forEach(item => {
            if (actualColumns.includes(item.english)) {
                columns.push({
                    chinese: item.chinese,
                    english: item.english
                });
            }
        });
        
        // 如果没有有效映射，使用数据中的字段名
        if (columns.length === 0) {
            actualColumns.forEach(col => {
                columns.push({ chinese: col, english: col });
            });
        }
        
        // 构建 SheetJS 格式的数据
        const header = columns.map(c => c.chinese);
        const filteredData = data.map(row => {
            const newRow = {};
            columns.forEach(col => {
                newRow[col.chinese] = row[col.english];
            });
            return newRow;
        });
        
        const ws = xlsx.utils.json_to_sheet(filteredData, {
            header: header,
            skipHeader: false
        });

        const wb = xlsx.utils.book_new();
        const sheetName = '数据';
        xlsx.utils.book_append_sheet(wb, ws, sheetName);

        const filename = `export_${Date.now()}.xlsx`;
        xlsx.writeFile(wb, filename);
    }

    // 列名映射：中文列名 -> 英文字段名
    function getColumnMapping() {
        const mapping = [];
        document.querySelectorAll('.dataTables_wrapper thead th').forEach(th => {
            const dataField = th.getAttribute('data-column');
            const chineseName = th.textContent.trim();
            if (dataField && chineseName) {
                mapping.push({
                    chinese: chineseName,
                    english: dataField
                });
            }
        });
        return mapping;
    }

    async function generateCSV(data) {
        if (data.length === 0) return;

        // 获取中英文列名映射
        const columnMapping = getColumnMapping();
        console.log('[NQI Export] Column mapping:', columnMapping);
        
        // 获取实际数据字段名
        const actualColumns = Object.keys(data[0]);
        console.log('[NQI Export] Actual data columns:', actualColumns);
        
        // 构建最终使用的列配置：使用中文表头 + 对应的英文字段名
        const columns = [];
        columnMapping.forEach(item => {
            // 只添加数据中存在的列
            if (actualColumns.includes(item.english)) {
                columns.push({
                    chinese: item.chinese,
                    english: item.english
                });
            }
        });
        
        // 如果没有有效映射，使用数据中的字段名
        if (columns.length === 0) {
            console.log('[NQI Export] No DOM columns match, using actual data columns');
            actualColumns.forEach(col => {
                columns.push({
                    chinese: col,
                    english: col
                });
            });
        }
        
        const headers = columns.map(c => c.chinese).join(',');
        const rows = data.map(row => {
            return columns.map(col => {
                const val = (row[col.english] ?? '').toString();
                if (val.includes(',') || val.includes('"') || val.includes('\n')) {
                    return '"' + val.replace(/"/g, '""') + '"';
                }
                return val;
            }).join(',');
        });

        const csv = '\ufeff' + [headers, ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `export_${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // SheetJS 库缓存
    let xlsxLib = null;
    
    async function loadXlsxLib() {
        // 如果已经加载过，直接返回
        if (typeof XLSX !== 'undefined') {
            return XLSX;
        }
        
        // 如果已经加载过，直接返回
        if (xlsxLib) {
            return xlsxLib;
        }
        
        // 尝试多种方式加载 xlsx 库
        const loadFromExtension = () => {
            return new Promise((resolve) => {
                try {
                    const script = document.createElement('script');
                    // 尝试从扩展资源加载
                    script.src = chrome.runtime.getURL('lib/xlsx.full.min.js');
                    script.onload = () => {
                        console.log('[NQI Export] XLSX loaded from extension');
                        xlsxLib = window.XLSX;
                        resolve(xlsxLib);
                    };
                    script.onerror = () => {
                        console.log('[NQI Export] Extension xlsx lib not found');
                        resolve(null);
                    };
                    document.head.appendChild(script);
                } catch (e) {
                    console.error('[NQI Export] loadFromExtension error:', e);
                    resolve(null);
                }
            });
        };
        
        const loadFromCDN = () => {
            return new Promise((resolve) => {
                // CSP 可能会阻止这个，所以作为备选
                const script = document.createElement('script');
                script.src = 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js';
                script.onload = () => {
                    console.log('[NQI Export] XLSX loaded from CDN');
                    xlsxLib = window.XLSX;
                    resolve(xlsxLib);
                };
                script.onerror = () => {
                    console.log('[NQI Export] CDN xlsx lib blocked by CSP, will use CSV');
                    resolve(null);
                };
                document.head.appendChild(script);
            });
        };
        
        // 先尝试从扩展加载，如果没有则尝试 CDN
        const result = await loadFromExtension();
        if (!result) {
            return await loadFromCDN();
        }
        return result;
    }

    // ========== 工具函数 ==========

    function getColumnNames() {
        const columns = [];
        document.querySelectorAll('.dataTables_wrapper thead th').forEach(th => {
            const dataField = th.getAttribute('data-column');
            if (dataField) {
                columns.push(dataField);
            } else {
                const text = th.textContent.trim();
                if (text) columns.push(text);
            }
        });
        return columns.length > 0 ? columns : ['Column1', 'Column2'];
    }

    function showToast(message, type = 'info') {
        const existing = document.querySelector('.nqi-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `nqi-toast ${type}`;
        toast.innerHTML = `<span>${message}</span>`;
        document.body.appendChild(toast);

        setTimeout(() => toast.remove(), 4000);
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ========== 从 DOM 提取数据（备选方案）==========
    
    function extractDataFromDOM() {
        console.log('[NQI Export] extractDataFromDOM: Starting DOM data extraction');
        
        const data = [];
        
        // 尝试找到表格
        const tables = document.querySelectorAll('.dataTables_wrapper table, table.dataTable, table[id^="DataTables"]');
        console.log('[NQI Export] Found', tables.length, 'tables in DOM');
        
        for (const table of tables) {
            const tbody = table.querySelector('tbody');
            if (!tbody) continue;
            
            const rows = tbody.querySelectorAll('tr');
            console.log('[NQI Export] Table has', rows.length, 'rows');
            
            if (rows.length === 0) continue;
            
            // 获取列名
            const thead = table.querySelector('thead');
            let columns = [];
            
            if (thead) {
                const ths = thead.querySelectorAll('th');
                ths.forEach(th => {
                    const text = th.textContent.trim();
                    // 清理可能存在的排序图标
                    const cleanText = text.replace(/↑|↓|↕/g, '').trim();
                    if (cleanText) {
                        columns.push(cleanText);
                    }
                });
                console.log('[NQI Export] DOM columns:', columns);
            }
            
            // 提取数据行
            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                const rowData = {};
                
                cells.forEach((cell, i) => {
                    if (columns[i]) {
                        rowData[columns[i]] = cell.textContent.trim();
                    } else {
                        rowData['col_' + i] = cell.textContent.trim();
                    }
                });
                
                if (Object.keys(rowData).length > 0) {
                    data.push(rowData);
                }
            });
            
            if (data.length > 0) {
                console.log('[NQI Export] Extracted', data.length, 'rows from DOM table');
                break; // 只处理第一个有数据的表格
            }
        }
        
        // 如果没有找到表格，尝试其他选择器
        if (data.length === 0) {
            const allTables = document.querySelectorAll('table');
            console.log('[NQI Export] Searching all', allTables.length, 'tables on page');
            
            allTables.forEach((table, idx) => {
                const tbody = table.querySelector('tbody');
                if (!tbody) return;
                
                const rows = tbody.querySelectorAll('tr');
                if (rows.length > 0 && rows.length < 1000) { // 限制大小
                    const thead = table.querySelector('thead');
                    let columns = [];
                    
                    if (thead) {
                        thead.querySelectorAll('th').forEach(th => {
                            columns.push(th.textContent.trim().replace(/↑|↓|↕/g, '').trim());
                        });
                    }
                    
                    rows.forEach(row => {
                        const cells = row.querySelectorAll('td');
                        const rowData = {};
                        
                        cells.forEach((cell, i) => {
                            if (columns[i]) {
                                rowData[columns[i]] = cell.textContent.trim();
                            }
                        });
                        
                        if (Object.keys(rowData).length > 0) {
                            data.push(rowData);
                        }
                    });
                }
            });
        }
        
        console.log('[NQI Export] extractDataFromDOM: Total extracted', data.length, 'rows');
        return data;
    }

    // ========== 消息监听 ==========

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log('[NQI Export] Message received:', message.action);

        if (message.action === 'ping') {
            sendResponse({ success: true, message: 'pong' });
            return true;
        }

        if (message.action === 'getTableInfo') {
            const apiCount = capturedData.count;
            const domCount = parseInt(document.querySelector('.nqi-panel-badge')?.textContent?.replace(/[^\d]/g, '') || '0');
            const rowCount = (apiCount && apiCount > 0) ? apiCount : domCount;
            
            const info = {
                tableName: capturedData.tableConfig?.tableName || 
                           capturedData.result?.result?.[0]?.tableName || 
                           '数据表格',
                columns: capturedData.columns.length > 0 ? capturedData.columns : getColumnNames(),
                rowCount: rowCount,
                apiCount: apiCount || null
            };
            
            chrome.storage.local.set({ tableInfo: info }).catch(() => {});
            sendResponse({ success: true, data: info });
            return true;
        }

        if (message.action === 'startExport') {
            startExport(message.format || 'xlsx');
            sendResponse({ success: true });
            return true;
        }

        if (message.action === 'getExportProgress') {
            const apiCount = capturedData.count || 0;
            sendResponse({
                success: true,
                data: {
                    fetched: currentTableData?.length || 0,
                    total: apiCount,
                    status: isExporting ? 'exporting' : 'idle'
                }
            });
            return true;
        }
    });

    window.NQIExportTool = {
        startExport,
        extractTableData
    };

    // ========== 启动 ==========

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
