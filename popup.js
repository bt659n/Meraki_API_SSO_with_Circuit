window.apiRegistry = {}; 
let globalSpec = null; 
let currentSelectedApi = null; 
let apiTreeRoot = {}; 

document.addEventListener('DOMContentLoaded', () => {
    const currentYear = new Date().getFullYear();
    const whatsNewLink = document.getElementById('link-whatsnew');
    if (whatsNewLink) {
        whatsNewLink.href = `https://developer.cisco.com/meraki/whats-new/${currentYear}/#whats-new`;
    }

    chrome.storage.local.get(['merakiSpec'], (data) => {
        if (data.merakiSpec) {
            globalSpec = data.merakiSpec;
            
            // 🔥 新增：动态解析并展示官方底层版本号
            const badge = document.getElementById('spec-version-badge');
            if (badge && globalSpec.info) {
                const apiVer = globalSpec.info.version || 'Unknown';
                const oasVer = globalSpec.openapi || '?';
                badge.innerText = `v${apiVer} (OAS ${oasVer})`;
                badge.style.display = 'inline-block'; // 解析成功后点亮展示
            }

            buildDeepApiTree(); 
            renderCollapsibleTree(); 
        } else {
            document.getElementById('api-desc').innerText = "未找到 API 缓存，请检查 background.js 是否正常抓取。";
        }
    });

    document.getElementById('run-btn').addEventListener('click', runApi);
    document.getElementById('api-search').addEventListener('input', handleApiSearch);
    
    document.getElementById('copy-btn').addEventListener('click', function() {
        const dataText = document.getElementById('data-result').innerText;
        if (!dataText || dataText === '等待发起请求...' || dataText === '请求执行中，请稍候...') return;
        
        navigator.clipboard.writeText(dataText).then(() => {
            const originalText = this.innerText;
            this.innerText = '✅ 已复制!';
            this.classList.add('copied');
            setTimeout(() => {
                this.innerText = '📋 复制数据';
                this.classList.remove('copied');
            }, 2000);
        });
    });
});

function formatTagName(str) {
    const acronyms = {
        'jwks': 'JWKS', 'vlans': 'VLANs', 'bgp': 'BGP', 'ospf': 'OSPF', 
        'vpn': 'VPN', 'ssid': 'SSID', 'ssids': 'SSIDs', 'api': 'API', 
        'pii': 'PII', 'qos': 'QoS', 'mtu': 'MTU', 'lldp': 'LLDP', 'cdp': 'CDP'
    };
    if (acronyms[str.toLowerCase()]) return acronyms[str.toLowerCase()];
    let formatted = str.replace(/([A-Z])/g, ' $1').trim();
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function buildDeepApiTree() {
    apiTreeRoot = {};
    window.apiRegistry = {}; 

    for (const path in globalSpec.paths) {
        const methods = ['get', 'post'];
        for (const method of methods) {
            const apiDef = globalSpec.paths[path][method];
            if (!apiDef || !apiDef.tags) continue;

            const tags = apiDef.tags;
            const action = tags[1] ? tags[1].toLowerCase() : '';

            if (method === 'post' && action !== 'livetools') continue; 

            const product = formatTagName(tags[0] || 'General');
            const subComponents = tags.slice(2).map(t => formatTagName(t));
            
            let currentLevel = apiTreeRoot;
            
            if (!currentLevel[product]) currentLevel[product] = { isCategory: true, children: {} };
            currentLevel = currentLevel[product].children;
            
            subComponents.forEach(comp => {
                if (!currentLevel[comp]) currentLevel[comp] = { isCategory: true, children: {} };
                currentLevel = currentLevel[comp].children;
            });

            const apiSummary = apiDef.summary || path;
            const uniqueApiId = btoa(method + '_' + path).replace(/=/g, ''); 
            
            window.apiRegistry[uniqueApiId] = {
                path: path,
                method: method.toUpperCase(),
                summary: apiSummary,
                details: apiDef
            };

            currentLevel[apiSummary] = {
                isCategory: false,
                apiId: uniqueApiId,
                method: method.toUpperCase()
            };
        }
    }
}

function renderCollapsibleTree() {
    const treeContainer = document.getElementById('category-tree-container');
    
    function generateHtml(node) {
        let html = '';
        Object.keys(node).sort().forEach(key => {
            const item = node[key];
            if (item.isCategory) {
                html += `
                    <details>
                        <summary>${key}</summary>
                        <div style="margin-left: 4px;">
                            ${generateHtml(item.children)}
                        </div>
                    </details>
                `;
            } else {
                const methodClass = item.method.toLowerCase();
                html += `
                    <div class="tree-leaf" data-api-id="${item.apiId}">
                        <span class="method-tag ${methodClass}">${item.method}</span>
                        <span>${key}</span>
                    </div>
                `;
            }
        });
        return html;
    }

    treeContainer.innerHTML = generateHtml(apiTreeRoot);
    bindTreeLeafClickEvents();
}

function bindTreeLeafClickEvents() {
    const treeContainer = document.getElementById('category-tree-container');
    treeContainer.querySelectorAll('.tree-leaf').forEach(leaf => {
        leaf.addEventListener('click', function() {
            treeContainer.querySelectorAll('.tree-leaf').forEach(l => l.classList.remove('active'));
            this.classList.add('active');
            loadApiToConsole(this.dataset.apiId);
        });
    });
}

function handleApiSearch(e) {
    const keyword = e.target.value.trim().toLowerCase();
    const treeContainer = document.getElementById('category-tree-container');
    
    if (!keyword) {
        renderCollapsibleTree();
        return;
    }

    let searchHtml = '';
    Object.keys(window.apiRegistry).forEach(apiId => {
        const apiObj = window.apiRegistry[apiId];
        const opId = (apiObj.details.operationId || '').toLowerCase();
        
        if (opId.includes(keyword)) {
            const methodClass = apiObj.method.toLowerCase();
            searchHtml += `
                <div class="tree-leaf" data-api-id="${apiId}" style="margin-left: 0px; border-bottom: 1px solid #f1f5f9; padding: 8px 4px;">
                    <div>
                        <span class="method-tag ${methodClass}">${apiObj.method}</span>
                        <span style="font-weight: 600; color: #1e293b;">${apiObj.details.operationId || apiObj.summary}</span>
                        <div style="font-size: 11px; color: #64748b; margin-top: 2px; padding-left: 42px;">${apiObj.path}</div>
                    </div>
                </div>
            `;
        }
    });

    if (searchHtml) {
        treeContainer.innerHTML = searchHtml;
    } else {
        treeContainer.innerHTML = '<div style="color: #94a3b8; text-align: center; padding: 15px; font-size: 12px;">❌ 未找到匹配的 Operation ID</div>';
    }
    
    bindTreeLeafClickEvents();
}

function loadApiToConsole(apiId) {
    const apiObj = window.apiRegistry[apiId];
    if (!apiObj) return;

    currentSelectedApi = apiObj;
    const paramContainer = document.getElementById('param-container');
    paramContainer.innerHTML = ''; 

    document.getElementById('api-desc').innerHTML = `
        <strong>[${apiObj.method}]</strong> <code style="color:#0284c7;">${apiObj.path}</code><br>
        <strong>Operation ID:</strong> <code style="background:#e2e8f0; padding:2px 5px; border-radius:3px; color:#0f172a; font-family:monospace;">${apiObj.details.operationId || '无'}</code><br><br>
        <strong>说明:</strong> ${apiObj.details.description || '无详细描述'}
    `;

    const apiParams = apiObj.details.parameters || [];
    let pathHtml = '';
    let queryHtml = '';

    if (apiParams.length > 0) {
        apiParams.forEach(param => {
            const descHtml = param.description 
                ? `<div style="font-size: 11px; color: #64748b; margin-top: 4px; line-height: 1.35; padding-left: 2px; word-break: break-word;">${param.description}</div>` 
                : '';

            if (param.in === 'path') {
                pathHtml += `
                    <div class="param-group" style="margin-bottom: 12px;">
                        <label><span style="color:#dc2626;">*</span> ${param.name} <small style="color:#64748b; font-weight:normal;">(必填路径参数)</small>:</label>
                        <input type="text" id="param-path-${param.name}" placeholder="请输入 ${param.name}" required>
                        ${descHtml}
                    </div>`;
            } else if (param.in === 'query') {
                
                let inputHtml = '';
                if (['t0', 't1'].includes(param.name)) {
                    inputHtml = `
                        <div style="display: flex; gap: 8px;">
                            <input type="text" id="param-query-${param.name}" placeholder="支持 ISO 8601 或 Unix Epoch" data-param-name="${param.name}" style="flex: 1;">
                            <input type="datetime-local" id="param-query-date-${param.name}" title="将所选时间作为 UTC 直接填入" style="width: 170px; padding: 6px; box-sizing: border-box; border: 1px solid #16a34a; border-radius: 4px; font-size: 12px; cursor: pointer; color: #16a34a; background: #f0fdf4;">
                        </div>`;
                } else {
                    inputHtml = `<input type="text" id="param-query-${param.name}" placeholder="请输入 ${param.name}" data-param-name="${param.name}">`;
                }

                queryHtml += `
                    <div class="param-group" style="margin-bottom: 12px;">
                        <label>${param.name} <small style="color:#0284c7; font-weight:normal;">(可选查询参数)</small>:</label>
                        ${inputHtml}
                        ${descHtml}
                    </div>`;
            }
        });
    } else {
        const pathParamsMatch = apiObj.path.match(/\{([^}]+)\}/g);
        if (pathParamsMatch) {
            pathParamsMatch.forEach(param => {
                const paramName = param.replace(/[{}]/g, ''); 
                pathHtml += `
                    <div class="param-group" style="margin-bottom: 12px;">
                        <label><span style="color:#dc2626;">*</span> ${paramName} <small style="color:#64748b; font-weight:normal;">(必填路径参数)</small>:</label>
                        <input type="text" id="param-path-${paramName}" placeholder="请输入 ${paramName}" required>
                    </div>`;
            });
        }
    }

    let finalHtml = pathHtml || '<label style="color:#16a34a; display:block; margin-bottom:4px;">✓ 此 API 无需任何必填变量路径。</label>';
    
    if (queryHtml) {
        finalHtml += `
            <details class="query-collapse" open>
                <summary>⚙️ 高级可选查询参数 (Query Params)</summary>
                <div style="margin-top: 6px; padding: 2px;">
                    ${queryHtml}
                </div>
            </details>
        `;
    }

    if (apiObj.method === 'POST') {
        finalHtml += `<div style="color:#ea580c; margin-top:8px; font-size:11px; font-weight:bold;">* 此操作为 LiveTool 实时工具，将以空 Body 触发。</div>`;
    }

    paramContainer.innerHTML = finalHtml;

    ['t0', 't1'].forEach(timeParam => {
        const datePicker = document.getElementById(`param-query-date-${timeParam}`);
        const textInput = document.getElementById(`param-query-${timeParam}`);
        if (datePicker && textInput) {
            const syncTime = () => {
                textInput.value = datePicker.value ? datePicker.value + ':00Z' : '';
            };
            datePicker.addEventListener('input', syncTime);
            datePicker.addEventListener('change', syncTime);
        }
    });
}

async function runApi() {
    if (!currentSelectedApi) return alert("请先在上方目录点击选择一个 API 操作");
    
    const logBox = document.getElementById('debug-log');
    const dataBox = document.getElementById('data-result');
    const envDomain = document.getElementById('env-select').value; 
    
    dataBox.innerText = "请求执行中，请稍候...";
    
    let debugLogs = `=======================================\n🚀 [${currentSelectedApi.method}] ${currentSelectedApi.path}\n=======================================\n`;
    const log = (msg) => {
        debugLogs += `> ${msg}\n`;
        logBox.innerText = debugLogs;
        logBox.scrollTop = logBox.scrollHeight;
    };

    let finalPath = currentSelectedApi.path;
    const method = currentSelectedApi.method;
    const apiParams = currentSelectedApi.details.parameters || [];
    
    if (apiParams.length > 0) {
        for (const param of apiParams) {
            if (param.in === 'path') {
                const el = document.getElementById(`param-path-${param.name}`);
                const val = el ? el.value.trim() : '';
                if (!val) { log(`❌ 终止：必填变量 ${param.name} 未填写！`); dataBox.innerText = "发起中止，缺少必填变量。"; return; }
                finalPath = finalPath.replace(`{${param.name}}`, val);
            }
        }
    } else {
        const pathParamsMatch = finalPath.match(/\{([^}]+)\}/g);
        if (pathParamsMatch) {
            for (const param of pathParamsMatch) {
                const paramName = param.replace(/[{}]/g, '');
                const val = document.getElementById(`param-path-${paramName}`).value.trim();
                if (!val) { log(`❌ 终止：必填变量 ${paramName} 未填写！`); dataBox.innerText = "发起中止，缺少必填变量。"; return; }
                finalPath = finalPath.replace(param, val);
            }
        }
    }

    const queryPairs = [];
    if (apiParams.length > 0) {
        apiParams.forEach(param => {
            if (param.in === 'query') {
                const el = document.getElementById(`param-query-${param.name}`);
                let val = el ? el.value.trim() : '';

                if (!val && ['t0', 't1'].includes(param.name)) {
                    const dateEl = document.getElementById(`param-query-date-${param.name}`);
                    if (dateEl && dateEl.value) {
                        val = dateEl.value + ':00Z';
                        if (el) el.value = val; 
                    }
                }

                if (val) {
                    queryPairs.push(`${encodeURIComponent(param.name)}=${encodeURIComponent(val)}`);
                }
            }
        });
    }

    const baseQueryString = queryPairs.length > 0 ? `?${queryPairs.join('&')}` : '';
    let targetUrl = `https://${envDomain}/api/v1${finalPath}${baseQueryString}`;
    let baseUrlWithoutCursor = targetUrl; 
    
    try {
        const fetchOptions = {
            method: method,
            credentials: 'include', 
            headers: { "Accept": "application/json", "Content-Type": "application/json" }
        };

        if (method === 'POST') fetchOptions.body = JSON.stringify({});

        let aggregatedData = [];
        let isPaginatedFlow = false;
        let currentPageIndex = 0;
        let lastFirstItemId = null; 
        const MAX_PAGE_SAFETY_LIMIT = 50; 

        log(`校验 Session 并开始向 ${envDomain} 持续发包...`);

        while (targetUrl) {
            currentPageIndex++;
            log(`[Page ${currentPageIndex}] 正在发起 Fetch: ${targetUrl}`);

            const response = await fetch(targetUrl, fetchOptions);
            
            if (!response.ok) {
                const text = await response.text();
                let errData = text; try { errData = JSON.parse(text); } catch(e){}
                log(`❌ 网关拒绝请求 (HTTP ${response.status})`);
                dataBox.innerText = typeof errData === 'object' ? JSON.stringify(errData, null, 2) : errData;
                return;
            }

            const text = await response.text();
            let pageJson;
            try {
                pageJson = text ? JSON.parse(text) : null;
            } catch (e) {
                pageJson = text;
            }

            let itemCount = Array.isArray(pageJson) ? pageJson.length : (typeof pageJson === 'object' ? 1 : 0);
            log(`✅ 收齐响应 (HTTP ${response.status})，本页包含数据量: ${itemCount} 条`);

            if (Array.isArray(pageJson)) {
                const currentFirstItemId = pageJson.length > 0 ? (pageJson[0].id || pageJson[0].serial || pageJson[0].occurredAt || JSON.stringify(pageJson[0]).substring(0, 20)) : null;
                if (currentPageIndex > 1 && currentFirstItemId && currentFirstItemId === lastFirstItemId) {
                    log(`🛑 检测到重复数据段 (目标接口可能不支持游标回退)，分页安全中断。`);
                    break; 
                }
                lastFirstItemId = currentFirstItemId;

                aggregatedData = aggregatedData.concat(pageJson);
                isPaginatedFlow = true;
            } else {
                aggregatedData = pageJson;
                break;
            }

            const linkHeader = response.headers.get('Link') || response.headers.get('link');
            targetUrl = null; 

            if (linkHeader && currentPageIndex < MAX_PAGE_SAFETY_LIMIT) {
                log(`🔗 获取到官方 Link Header: ${linkHeader}`);
                const links = linkHeader.split(',');
                for (let link of links) {
                    if (/rel=["']?next["']?/.test(link)) {
                        const match = link.match(/<([^>]+)>/);
                        if (match) {
                            let rawNextUrl = match[1];
                            try {
                                const urlObj = new URL(rawNextUrl);
                                urlObj.host = envDomain; 
                                targetUrl = urlObj.toString();
                            } catch (urlErr) {
                                targetUrl = rawNextUrl.replace(/https:\/\/[^\/]+/, `https://${envDomain}`);
                            }
                        }
                    }
                }
            } 
            else if (!linkHeader && pageJson.length > 0 && currentPageIndex < MAX_PAGE_SAFETY_LIMIT) {
                const lastItem = pageJson[pageJson.length - 1];
                const lastCursor = lastItem.id || lastItem.serial || lastItem.occurredAt || lastItem.networkId;
                
                if (lastCursor) {
                    log(`⚠️ CORS 拦截了 Header。触发智能回退机制 -> 提取最后一条元素游标: ${lastCursor}`);
                    try {
                        const urlObj = new URL(baseUrlWithoutCursor);
                        urlObj.searchParams.set('startingAfter', lastCursor);
                        targetUrl = urlObj.toString();
                    } catch (e) {
                        targetUrl = null;
                    }
                } else {
                    log(`🏁 无法解析数据结尾游标（或已到达终点），分页结束。`);
                }
            } else {
                log(`🏁 本轮抓取顺利完成，无下一页内容。`);
            }
        }

        if (isPaginatedFlow && currentPageIndex > 1) {
            log(`✨ [全自动分页完毕] 累计成功跨页请求 ${currentPageIndex} 次，无缝合并输出：${aggregatedData.length} 条数据\n`);
        }
        
        dataBox.innerText = typeof aggregatedData === 'object' ? JSON.stringify(aggregatedData, null, 2) : aggregatedData;

    } catch (err) {
        log(`💣 网络层阻断: ${err.message}`);
        dataBox.innerText = `网络异常，无法获取数据。\n(请确保当前浏览器拥有该客户在 ${envDomain} 的 Dashboard 合规 Session)`;
    }
}