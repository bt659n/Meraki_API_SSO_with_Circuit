window.apiRegistry = {}; 
let globalSpec = null; 
let currentSelectedApi = null; 
let apiTreeRoot = {}; 

let rawResponseData = null; // Store raw JSON response
let currentTableData = [];   // Store flat array of objects for table searching & CSV export
let tableHeaders = [];       // Store sorted header list
let currentTablePageIndex = 0;
let activeApiAbortController = null;
let activeApiStopRequested = false;
const CIRCUIT_HOME_URL = 'https://circuit.cisco.com/app/home';
const CIRCUIT_DATA_CHAR_LIMIT = 70000;
const CIRCUIT_HISTORY_KEY = 'circuitAnalysisHistory';
const CIRCUIT_HISTORY_LIMIT = 8;
const DEFAULT_MAX_FETCH_RECORDS = 50000;
const DEFAULT_JSON_PREVIEW_RECORDS = 200;
const DEFAULT_TABLE_PREVIEW_ROWS = 2000;
const CIRCUIT_PROMPT_PRESETS = {
    troubleshoot: 'Analyze this Meraki API result. Summarize the important findings, call out anomalies, and suggest practical next troubleshooting steps.',
    'case-note': 'Write a concise support case note from this Meraki API result. Include symptoms, evidence, impact, and recommended next action. Keep it professional and grounded in the data.',
    anomalies: 'Inspect this Meraki API result for anomalies, outliers, missing data, errors, or suspicious state changes. List the strongest findings first and cite the exact fields or rows that support them.',
    customer: 'Explain this Meraki API result in customer-friendly language. Avoid internal jargon, keep numeric claims accurate, and include what we recommend checking next.',
    'next-steps': 'Based on this Meraki API result, suggest the next troubleshooting steps. Separate immediate checks, useful follow-up API calls, and information to request from the customer.'
};
let lastCircuitAnswer = '';

document.addEventListener('DOMContentLoaded', () => {
    const currentYear = new Date().getFullYear();
    const whatsNewLink = document.getElementById('link-whatsnew');
    if (whatsNewLink) {
        whatsNewLink.href = `https://developer.cisco.com/meraki/whats-new/${currentYear}/#whats-new`;
    }

    chrome.storage.local.get(['merakiSpec'], (data) => {
        if (data.merakiSpec) {
            globalSpec = data.merakiSpec;
            
            const badge = document.getElementById('spec-version-badge');
            if (badge && globalSpec.info) {
                const apiVer = globalSpec.info.version || 'Unknown';
                const oasVer = globalSpec.openapi || '?';
                badge.innerText = `v${apiVer} (OAS ${oasVer})`;
                badge.style.display = 'inline-block';
            }

            buildDeepApiTree(); 
            renderCollapsibleTree(); 
        } else {
            document.getElementById('api-desc').innerText = "API specification cache not found. Please verify background.js is running properly.";
        }
    });

    // Env change listener
    const envSelect = document.getElementById('env-select');

    // Update spec button listener
    document.getElementById('update-spec-btn').addEventListener('click', forceUpdateSpec);

    document.getElementById('run-btn').addEventListener('click', runApi);
    document.getElementById('stop-run-btn').addEventListener('click', stopActiveApiRequest);
    document.getElementById('api-search').addEventListener('input', handleApiSearch);
    
    // Tab switching
    const tabJson = document.getElementById('tab-json');
    const tabTable = document.getElementById('tab-table');
    const jsonPane = document.getElementById('json-view-pane');
    const tablePane = document.getElementById('table-view-pane');
    
    tabJson.addEventListener('click', () => {
        tabJson.classList.add('active');
        tabTable.classList.remove('active');
        jsonPane.classList.add('active');
        tablePane.classList.remove('active');
        updatePrimaryDataActionButton();
    });
    
    tabTable.addEventListener('click', () => {
        tabTable.classList.add('active');
        tabJson.classList.remove('active');
        tablePane.classList.add('active');
        jsonPane.classList.remove('active');
        updatePrimaryDataActionButton();
    });

    document.getElementById('copy-btn').addEventListener('click', handlePrimaryDataAction);
    updatePrimaryDataActionButton();

    document.getElementById('table-prev-page-btn').addEventListener('click', () => changeTablePage(-1));
    document.getElementById('table-next-page-btn').addEventListener('click', () => changeTablePage(1));

    // Table search input filter listener
    document.getElementById('table-search').addEventListener('input', handleTableSearch);

    document.getElementById('send-circuit-btn').addEventListener('click', sendCurrentResultToCircuit);
    document.getElementById('copy-circuit-response-btn').addEventListener('click', () => {
        copyCircuitText(lastCircuitAnswer, 'copy-circuit-response-btn', 'Copy Response');
    });
    document.getElementById('circuit-preset-select').addEventListener('change', applyCircuitPromptPreset);
    document.getElementById('circuit-data-scope').addEventListener('change', updateCircuitPayloadHint);
    document.getElementById('circuit-redact-sensitive').addEventListener('change', updateCircuitPayloadHint);
    document.getElementById('circuit-history-select').addEventListener('change', loadCircuitHistoryItem);
    loadCircuitHistory();
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

    const tokens = keyword.split(/\s+/).filter(t => t.length > 0);

    let searchHtml = '';
    Object.keys(window.apiRegistry).forEach(apiId => {
        const apiObj = window.apiRegistry[apiId];
        const opId = (apiObj.details.operationId || '').toLowerCase();
        const path = (apiObj.path || '').toLowerCase();
        const summary = (apiObj.summary || '').toLowerCase();
        
        const matchString = (target) => {
            let currentIndex = 0;
            for (const token of tokens) {
                const index = target.indexOf(token, currentIndex);
                if (index === -1) return false;
                currentIndex = index + token.length;
            }
            return true;
        };

        const isMatch = matchString(opId) || matchString(path) || matchString(summary);
        
        if (isMatch) {
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
        treeContainer.innerHTML = '<div style="color: #94a3b8; text-align: center; padding: 15px; font-size: 12px;">❌ No matching Operation ID found</div>';
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
        <strong>Operation ID:</strong> <code style="background:#e2e8f0; padding:2px 5px; border-radius:3px; color:#0f172a; font-family:monospace;">${apiObj.details.operationId || 'None'}</code><br><br>
        <strong>Description:</strong> ${apiObj.details.description || 'No detailed description available.'}
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
                        <label><span style="color:#dc2626;">*</span> ${param.name} <small style="color:#64748b; font-weight:normal;">(Required Path Param)</small>:</label>
                        <input type="text" id="param-path-${param.name}" placeholder="Enter ${param.name}" required>
                        ${descHtml}
                    </div>`;
            } else if (param.in === 'query') {
                let inputHtml = '';
                if (['t0', 't1'].includes(param.name)) {
                    inputHtml = `
                        <div style="display: flex; gap: 8px;">
                            <input type="text" id="param-query-${param.name}" placeholder="Supports ISO 8601 or Unix Epoch" data-param-name="${param.name}" style="flex: 1;">
                            <input type="datetime-local" id="param-query-date-${param.name}" title="Set selected local time as UTC" style="width: 170px; padding: 6px; box-sizing: border-box; border: 1px solid #16a34a; border-radius: 4px; font-size: 12px; cursor: pointer; color: #16a34a; background: #f0fdf4;">
                        </div>`;
                } else {
                    inputHtml = `<input type="text" id="param-query-${param.name}" placeholder="Enter ${param.name}" data-param-name="${param.name}">`;
                }

                queryHtml += `
                    <div class="param-group" style="margin-bottom: 12px;">
                        <label>${param.name} <small style="color:#0284c7; font-weight:normal;">(Optional Query Param)</small>:</label>
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
                        <label><span style="color:#dc2626;">*</span> ${paramName} <small style="color:#64748b; font-weight:normal;">(Required Path Param)</small>:</label>
                        <input type="text" id="param-path-${paramName}" placeholder="Enter ${paramName}" required>
                    </div>`;
            });
        }
    }

    let finalHtml = pathHtml || '<label style="color:#16a34a; display:block; margin-bottom:4px;">✓ This API does not require any path parameters.</label>';
    finalHtml += buildTimeShortcutHtml(apiParams);
    
    if (queryHtml) {
        finalHtml += `
            <details class="query-collapse">
                <summary>⚙️ Advanced Optional Query Parameters</summary>
                <div style="margin-top: 6px; padding: 2px;">
                    ${queryHtml}
                </div>
            </details>
        `;
    }

    if (apiObj.method === 'POST') {
        finalHtml += `<div style="color:#ea580c; margin-top:8px; font-size:11px; font-weight:bold;">* This operation is a LiveTool diagnostic task and will be triggered with an empty request body.</div>`;
    }

    paramContainer.innerHTML = finalHtml;
    bindTimeShortcutEvents();

    ['timespan', 't0', 't1'].forEach(timeParam => {
        const textInput = document.getElementById(`param-query-${timeParam}`);
        if (textInput) {
            textInput.addEventListener('input', clearActiveTimeShortcut);
        }
    });

    ['t0', 't1'].forEach(timeParam => {
        const datePicker = document.getElementById(`param-query-date-${timeParam}`);
        const textInput = document.getElementById(`param-query-${timeParam}`);
        if (datePicker && textInput) {
            const syncTime = () => {
                textInput.value = datePicker.value ? datePicker.value + ':00Z' : '';
                clearActiveTimeShortcut();
            };
            datePicker.addEventListener('input', syncTime);
            datePicker.addEventListener('change', syncTime);
        }
    });
}

function buildTimeShortcutHtml(apiParams) {
    const queryNames = new Set((apiParams || []).filter(param => param.in === 'query').map(param => param.name));
    const supportsTimespan = queryNames.has('timespan');
    const supportsT0T1 = queryNames.has('t0') || queryNames.has('t1');

    if (!supportsTimespan && !supportsT0T1) return '';

    return `
        <div class="time-shortcuts">
            <div class="time-shortcuts-title">Time shortcuts</div>
            <div class="time-shortcut-row">
                <button type="button" class="shortcut-btn" data-minutes="5">Last 5 min</button>
                <button type="button" class="shortcut-btn" data-minutes="30">Last 30 min</button>
                <button type="button" class="shortcut-btn" data-minutes="120">Last 2 hours</button>
                <button type="button" class="shortcut-btn" data-minutes="1440">Last 1 day</button>
            </div>
        </div>
    `;
}

function bindTimeShortcutEvents() {
    document.querySelectorAll('.shortcut-btn[data-minutes]').forEach(button => {
        button.addEventListener('click', () => applyTimeShortcut(Number(button.dataset.minutes), button));
    });
}

function clearActiveTimeShortcut() {
    document.querySelectorAll('.shortcut-btn[data-minutes]').forEach(button => {
        button.classList.remove('active');
        button.setAttribute('aria-pressed', 'false');
    });
}

function setActiveTimeShortcut(activeButton) {
    clearActiveTimeShortcut();
    if (!activeButton) return;
    activeButton.classList.add('active');
    activeButton.setAttribute('aria-pressed', 'true');
}

function applyTimeShortcut(minutes, activeButton = null) {
    const now = new Date();
    const start = new Date(now.getTime() - minutes * 60 * 1000);
    const timespanEl = document.getElementById('param-query-timespan');
    const t0El = document.getElementById('param-query-t0');
    const t1El = document.getElementById('param-query-t1');
    const t0DateEl = document.getElementById('param-query-date-t0');
    const t1DateEl = document.getElementById('param-query-date-t1');

    if (timespanEl) {
        timespanEl.value = String(minutes * 60);
        if (t0El) t0El.value = '';
        if (t1El) t1El.value = '';
        if (t0DateEl) t0DateEl.value = '';
        if (t1DateEl) t1DateEl.value = '';
        setActiveTimeShortcut(activeButton);
        return;
    }
    if (t0El) t0El.value = start.toISOString();
    if (t1El) t1El.value = now.toISOString();

    if (t0DateEl) t0DateEl.value = isoToDateTimeLocal(start);
    if (t1DateEl) t1DateEl.value = isoToDateTimeLocal(now);
    setActiveTimeShortcut(activeButton);
}

function normalizeTimeQueryValues(queryValues) {
    const hasTimespan = Boolean(queryValues.timespan);
    const hasT0 = Boolean(queryValues.t0);
    const hasT1 = Boolean(queryValues.t1);

    if (hasTimespan && hasT0 && hasT1) {
        delete queryValues.timespan;
        return 'Both timespan and t0/t1 were set. Sending t0/t1 and omitting timespan.';
    }

    if (hasTimespan && (hasT0 || hasT1)) {
        delete queryValues.t0;
        delete queryValues.t1;
        return 'Timespan was set with only one of t0/t1. Sending timespan and omitting partial t0/t1.';
    }

    return '';
}

function isoToDateTimeLocal(date) {
    const pad = value => String(value).padStart(2, '0');
    return [
        date.getFullYear(),
        '-',
        pad(date.getMonth() + 1),
        '-',
        pad(date.getDate()),
        'T',
        pad(date.getHours()),
        ':',
        pad(date.getMinutes())
    ].join('');
}

function parseResponseBody(text) {
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch (e) {
        return text;
    }
}

function formatApiError(response, body, requestUrl) {
    const statusLine = `HTTP ${response.status} ${response.statusText || 'Error'}`;
    const friendlyHint = getFriendlyApiErrorHint(response.status, body);
    const lines = [
        statusLine,
        `Request: ${requestUrl}`,
        ''
    ];

    if (friendlyHint) {
        lines.push('Hint:');
        lines.push(friendlyHint);
        lines.push('');
    }

    if (body && typeof body === 'object') {
        if (Array.isArray(body.errors) && body.errors.length > 0) {
            lines.push('Errors:');
            body.errors.forEach(error => lines.push(`- ${error}`));
            lines.push('');
        }
        lines.push('Raw response:');
        lines.push(JSON.stringify(body, null, 2));
    } else if (body) {
        lines.push(String(body));
    } else {
        lines.push('No response body returned by the API.');
    }

    return lines.join('\n');
}

function getFriendlyApiErrorHint(status, body) {
    const errorText = extractErrorText(body).toLowerCase();

    if (status === 400 && /timespan|t0|t1/.test(errorText)) {
        return 'This API requires either timespan OR both t0 and t1, but not both groups at the same time. Use a Time shortcut for timespan, or clear timespan and fill t0/t1 manually.';
    }
    if (status === 401) {
        return 'Your Dashboard session may not be authenticated. Open the matching Meraki Dashboard shard in Chrome, sign in, then retry.';
    }
    if (status === 403) {
        return 'The current SSO session may not have access to this organization, network, device, or API endpoint.';
    }
    if (status === 404) {
        return 'Check that the orgId, networkId, device serial, or other path parameter belongs to the selected environment shard.';
    }
    if (status === 429) {
        return 'Meraki rate limit was reached. Wait briefly and retry with a narrower time range or fewer paginated requests.';
    }
    if (status >= 500) {
        return 'The Meraki API gateway returned a server-side error. Retry later or narrow the request if it is expensive.';
    }

    return '';
}

function extractErrorText(body) {
    if (!body) return '';
    if (typeof body === 'string') return body;
    if (Array.isArray(body.errors)) return body.errors.join(' ');
    try {
        return JSON.stringify(body);
    } catch (e) {
        return String(body);
    }
}

function setApiRequestRunning(isRunning) {
    const runBtn = document.getElementById('run-btn');
    const stopBtn = document.getElementById('stop-run-btn');

    if (runBtn) {
        runBtn.disabled = isRunning;
        runBtn.innerText = isRunning ? 'Running API Request...' : 'Run Selected API (SSO Direct)';
    }

    if (stopBtn) {
        stopBtn.style.display = isRunning ? 'inline-block' : 'none';
        stopBtn.disabled = false;
        stopBtn.innerText = 'Stop';
    }
}

function stopActiveApiRequest() {
    const stopBtn = document.getElementById('stop-run-btn');

    if (!activeApiAbortController) return;

    activeApiStopRequested = true;
    if (stopBtn) {
        stopBtn.disabled = true;
        stopBtn.innerText = 'Stopping...';
    }
    activeApiAbortController.abort();
}

function isJsonViewActive() {
    const tabJson = document.getElementById('tab-json');
    return !tabJson || tabJson.classList.contains('active');
}

function updatePrimaryDataActionButton() {
    const actionBtn = document.getElementById('copy-btn');
    if (!actionBtn) return;
    if (actionBtn.disabled) return;

    if (isJsonViewActive()) {
        actionBtn.innerText = 'Download JSON';
        actionBtn.title = 'Download the full fetched JSON result';
    } else {
        actionBtn.innerText = 'Export Excel CSV';
        actionBtn.title = 'Download the full fetched table data as a CSV file that opens in Excel';
    }
}

function handlePrimaryDataAction() {
    if (isJsonViewActive()) {
        exportToJson();
    } else {
        exportToCsv();
    }
}

function getPositiveIntegerInput(id, fallback, min, max) {
    const el = document.getElementById(id);
    const value = el ? Number.parseInt(el.value, 10) : NaN;
    if (!Number.isFinite(value)) return fallback;
    return Math.min(Math.max(value, min), max);
}

function getApiSafetyLimits() {
    return {
        maxFetchRecords: getPositiveIntegerInput('max-records-input', DEFAULT_MAX_FETCH_RECORDS, 1000, 1000000),
        jsonPreviewRecords: getPositiveIntegerInput('json-preview-input', DEFAULT_JSON_PREVIEW_RECORDS, 50, 10000),
        tablePreviewRows: getPositiveIntegerInput('table-preview-input', DEFAULT_TABLE_PREVIEW_ROWS, 100, 50000)
    };
}

function appendArrayPageWithinLimit(target, page, maxRecords) {
    const remaining = maxRecords - target.length;
    if (remaining <= 0) return 0;
    const itemsToAppend = page.slice(0, remaining);
    target.push(...itemsToAppend);
    return itemsToAppend.length;
}

function displayApiResult(resultData, treeContainer) {
    const limits = getApiSafetyLimits();
    const isArrayResult = Array.isArray(resultData);
    const jsonRenderData = isArrayResult && resultData.length > limits.jsonPreviewRecords
        ? resultData.slice(0, limits.jsonPreviewRecords)
        : resultData;
    const jsonNotice = isArrayResult && resultData.length > limits.jsonPreviewRecords
        ? `JSON preview is showing the first ${limits.jsonPreviewRecords.toLocaleString()} of ${resultData.length.toLocaleString()} fetched records to keep the side panel responsive.`
        : '';

    rawResponseData = resultData;
    updateCircuitPayloadHint();

    renderJsonTree(jsonRenderData, treeContainer, jsonNotice);

    if (Array.isArray(resultData) && resultData.length > 0 && typeof resultData[0] === 'object') {
        const uniqueKeys = new Set();
        const scanLimit = Math.min(resultData.length, 20);
        for (let i = 0; i < scanLimit; i++) {
            Object.keys(flattenObject(resultData[i])).forEach(k => uniqueKeys.add(k));
        }
        tableHeaders = Array.from(uniqueKeys);
        const primaryFields = ['id', 'name', 'serial', 'mac', 'status', 'networkId', 'organizationId'];
        tableHeaders.sort((a, b) => {
            const idxA = primaryFields.indexOf(a);
            const idxB = primaryFields.indexOf(b);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.localeCompare(b);
        });

        currentTablePageIndex = 0;
        renderCurrentTablePage();
        document.getElementById('tab-table').style.display = 'inline-block';
    } else {
        currentTableData = [];
        currentTablePageIndex = 0;
        document.getElementById('tab-table').style.display = 'none';
    }
}

function renderCurrentTablePage() {
    const limits = getApiSafetyLimits();
    const tableData = Array.isArray(rawResponseData) ? rawResponseData : [];
    const pageSize = limits.tablePreviewRows;
    const totalPages = Math.max(1, Math.ceil(tableData.length / pageSize));
    currentTablePageIndex = Math.min(Math.max(currentTablePageIndex, 0), totalPages - 1);

    const start = currentTablePageIndex * pageSize;
    const end = Math.min(start + pageSize, tableData.length);
    currentTableData = tableData.slice(start, end).map(item => flattenObject(item));

    const notice = tableData.length > pageSize
        ? `Table renders ${start + 1}-${end} of ${tableData.length.toLocaleString()} fetched records. Use Prev/Next to render another local page without refetching.`
        : '';

    renderTable(currentTableData, tableHeaders, notice);
    updateTablePageControls(totalPages, start, end, tableData.length);
}

function updateTablePageControls(totalPages, start, end, totalRows) {
    const prevBtn = document.getElementById('table-prev-page-btn');
    const nextBtn = document.getElementById('table-next-page-btn');
    const status = document.getElementById('table-page-status');

    if (prevBtn) prevBtn.disabled = currentTablePageIndex <= 0;
    if (nextBtn) nextBtn.disabled = currentTablePageIndex >= totalPages - 1;
    if (status) {
        status.innerText = totalRows > 0
            ? `Page ${currentTablePageIndex + 1}/${totalPages} (${start + 1}-${end})`
            : 'Page 0/0';
    }
}

function changeTablePage(delta) {
    if (!Array.isArray(rawResponseData) || rawResponseData.length === 0) return;
    currentTablePageIndex += delta;
    document.getElementById('table-search').value = '';
    renderCurrentTablePage();
}

async function runApi() {
    if (!currentSelectedApi) return alert("Please select an API operation first.");
    if (activeApiAbortController) return;
    
    const logBox = document.getElementById('debug-log');
    const treeContainer = document.getElementById('data-result-tree');
    const envDomain = document.getElementById('env-select').value; 
    
    treeContainer.innerText = "Executing request, please wait...";
    
    // Hide table tab initially and reset variables
    document.getElementById('tab-table').style.display = 'none';
    document.getElementById('table-search').value = '';
    document.getElementById('tab-json').click();
    
    rawResponseData = null;
    currentTableData = [];
    tableHeaders = [];
    
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
                if (!val) {
                    log(`❌ Terminated: Required parameter ${param.name} is missing!`);
                    treeContainer.innerText = "Aborted: Missing required path parameters.";
                    return;
                }
                finalPath = finalPath.replace(`{${param.name}}`, val);
            }
        }
    } else {
        const pathParamsMatch = finalPath.match(/\{([^}]+)\}/g);
        if (pathParamsMatch) {
            for (const param of pathParamsMatch) {
                const paramName = param.replace(/[{}]/g, '');
                const val = document.getElementById(`param-path-${paramName}`).value.trim();
                if (!val) {
                    log(`❌ Terminated: Required parameter ${paramName} is missing!`);
                    treeContainer.innerText = "Aborted: Missing required path parameters.";
                    return;
                }
                finalPath = finalPath.replace(param, val);
            }
        }
    }

    const queryValues = {};
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
                    queryValues[param.name] = val;
                }
            }
        });
    }

    const timeNormalizationLog = normalizeTimeQueryValues(queryValues);
    if (timeNormalizationLog) log(`ℹ️ ${timeNormalizationLog}`);

    const supportsPerPage = apiParams.some(param => param.in === 'query' && param.name === 'perPage');
    if (supportsPerPage && !queryValues.perPage) {
        queryValues.perPage = '1000';
        const perPageEl = document.getElementById('param-query-perPage');
        if (perPageEl) perPageEl.value = queryValues.perPage;
        log(`ℹ️ perPage was empty. Using 1000 to reduce pagination requests.`);
    }

    const queryPairs = Object.keys(queryValues).map(key => `${encodeURIComponent(key)}=${encodeURIComponent(queryValues[key])}`);
    const baseQueryString = queryPairs.length > 0 ? `?${queryPairs.join('&')}` : '';
    let targetUrl = `https://${envDomain}/api/v1${finalPath}${baseQueryString}`;
    let baseUrlWithoutCursor = targetUrl; 
    let aggregatedData = [];
    let isPaginatedFlow = false;
    let currentPageIndex = 0;
    const safetyLimits = getApiSafetyLimits();
    activeApiStopRequested = false;
    const requestAbortController = new AbortController();
    activeApiAbortController = requestAbortController;
    setApiRequestRunning(true);
    
    try {
        const fetchOptions = {
            method: method,
            credentials: 'include', 
            headers: { "Accept": "application/json", "Content-Type": "application/json" },
            signal: requestAbortController.signal
        };

        if (method === 'POST') fetchOptions.body = JSON.stringify({});

        const visitedRequestUrls = new Set();
        const MAX_PAGE_SAFETY_LIMIT = 250; 

        log(`Verifying session and starting request transmission to ${envDomain}...`);

        while (targetUrl) {
            if (activeApiStopRequested) {
                log(`🛑 Request stopped by user before dispatching the next page.`);
                break;
            }

            if (visitedRequestUrls.has(targetUrl)) {
                log(`🛑 Pagination loop detected. URL was already requested: ${targetUrl}`);
                break;
            }
            visitedRequestUrls.add(targetUrl);

            currentPageIndex++;
            log(`[Page ${currentPageIndex}] Dispatching Fetch: ${targetUrl}`);

            const response = await fetch(targetUrl, fetchOptions);
            
            if (!response.ok) {
                const text = await response.text();
                const errData = parseResponseBody(text);
                const formattedError = formatApiError(response, errData, targetUrl);
                log(`❌ Request denied by API gateway (HTTP ${response.status} ${response.statusText || 'Error'})`);
                treeContainer.innerText = formattedError;
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
            log(`✅ Response received (HTTP ${response.status}). Records in this page: ${itemCount}`);

            if (Array.isArray(pageJson)) {
                const appendedCount = appendArrayPageWithinLimit(aggregatedData, pageJson, safetyLimits.maxFetchRecords);
                isPaginatedFlow = true;
                if (appendedCount < pageJson.length || aggregatedData.length >= safetyLimits.maxFetchRecords) {
                    log(`🛑 Max records limit reached at ${aggregatedData.length.toLocaleString()} records. Increase Max records or narrow the time range if more data is needed.`);
                    break;
                }
            } else {
                aggregatedData = pageJson;
                break;
            }

            const linkHeader = response.headers.get('Link') || response.headers.get('link');
            targetUrl = null; 

            if (linkHeader) {
                log(`🔗 Received Link Header: ${linkHeader}`);
                if (currentPageIndex >= MAX_PAGE_SAFETY_LIMIT) {
                    log(`🛑 Safety limit reached after ${MAX_PAGE_SAFETY_LIMIT} pages. Narrow the time range if more data is needed.`);
                } else {
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
            } 
            else if (!linkHeader && pageJson.length > 0 && currentPageIndex < MAX_PAGE_SAFETY_LIMIT) {
                const lastItem = pageJson[pageJson.length - 1];
                const lastCursor = lastItem.id || lastItem.serial || lastItem.occurredAt || lastItem.networkId;
                
                if (lastCursor) {
                    log(`⚠️ CORS blocked headers or Link missing. Fallback -> Extracting cursor from last record: ${lastCursor}`);
                    try {
                        const urlObj = new URL(baseUrlWithoutCursor);
                        urlObj.searchParams.set('startingAfter', lastCursor);
                        targetUrl = urlObj.toString();
                    } catch (e) {
                        targetUrl = null;
                    }
                } else {
                    log(`🏁 No cursor found on last item or pagination completed.`);
                }
            } else {
                log(`🏁 Pagination completed successfully. No further pages.`);
            }
        }

        if (activeApiStopRequested) {
            log(`🛑 [Request stopped] Dispatched ${currentPageIndex} pages. Showing ${Array.isArray(aggregatedData) ? aggregatedData.length : 0} records already fetched.\n`);
        } else if (isPaginatedFlow && currentPageIndex > 1) {
            log(`✨ [Auto-pagination complete] Dispatched ${currentPageIndex} pages. Aggregated total: ${aggregatedData.length} records\n`);
        }
        
        displayApiResult(aggregatedData, treeContainer);

    } catch (err) {
        if (err.name === 'AbortError' && activeApiStopRequested) {
            log(`🛑 Request stopped by user. Showing ${Array.isArray(aggregatedData) ? aggregatedData.length : 0} records already fetched.\n`);
            displayApiResult(aggregatedData, treeContainer);
        } else {
            log(`💣 Connection blocked: ${err.message}`);
            treeContainer.innerText = `Connection error. Unable to fetch data.\n(Please verify your browser is logged into ${envDomain} and your dashboard session is active)`;
        }
    } finally {
        if (activeApiAbortController === requestAbortController) {
            activeApiAbortController = null;
            activeApiStopRequested = false;
            setApiRequestRunning(false);
        }
    }
}

function updateCircuitPayloadHint() {
    const hint = document.getElementById('circuit-payload-hint');
    const status = document.getElementById('circuit-status');
    if (!hint) return;

    if (!rawResponseData) {
        hint.innerText = '';
        return;
    }

    const payloadData = getCircuitPayloadData();
    const serialized = JSON.stringify(payloadData);
    const truncated = serialized.length > CIRCUIT_DATA_CHAR_LIMIT;
    hint.innerText = truncated
        ? `~${CIRCUIT_DATA_CHAR_LIMIT.toLocaleString()} chars sent`
        : `~${serialized.length.toLocaleString()} chars`;

    if (status) {
        status.innerText = truncated
            ? 'Ready. Large result will be truncated before sending to Circuit.'
            : 'Ready to send the latest API result to Circuit.';
    }
}

function buildCircuitPrompt() {
    const taskInput = document.getElementById('circuit-prompt');
    const task = taskInput ? taskInput.value.trim() : '';
    const apiLabel = currentSelectedApi
        ? `[${currentSelectedApi.method}] ${currentSelectedApi.path}`
        : 'Unknown Meraki API operation';

    const sourceData = getCircuitPayloadData();

    let serialized = JSON.stringify(sourceData, null, 2);
    const originalLength = serialized.length;
    if (serialized.length > CIRCUIT_DATA_CHAR_LIMIT) {
        serialized = serialized.slice(0, CIRCUIT_DATA_CHAR_LIMIT);
    }

    const truncationNote = originalLength > CIRCUIT_DATA_CHAR_LIMIT
        ? `\nNote: The payload was truncated from ${originalLength} characters to ${CIRCUIT_DATA_CHAR_LIMIT} characters. Ask me to narrow the time range or fields if more detail is needed.\n`
        : '';

    return [
        task || 'Analyze this Meraki API result and summarize the important findings.',
        '',
        'Return practical support-engineering output. Keep numeric claims grounded in the supplied data.',
        '',
        `Source API: ${apiLabel}`,
        `Operation ID: ${currentSelectedApi && currentSelectedApi.details ? currentSelectedApi.details.operationId || 'None' : 'None'}`,
        truncationNote,
        'Data:',
        '```json',
        serialized,
        '```'
    ].join('\n');
}

function getCircuitPayloadData() {
    const scope = document.getElementById('circuit-data-scope') ? document.getElementById('circuit-data-scope').value : 'smart';
    const shouldRedact = document.getElementById('circuit-redact-sensitive') ? document.getElementById('circuit-redact-sensitive').checked : true;
    let data;

    if (scope === 'full-json') {
        data = rawResponseData;
    } else if (scope === 'visible-table') {
        data = currentTableData.length > 0 ? { tableHeaders, rows: getVisibleTableRows() } : rawResponseData;
    } else {
        data = currentTableData.length > 0 ? { tableHeaders, rows: currentTableData } : rawResponseData;
    }

    return shouldRedact ? redactSensitiveData(data) : data;
}

function getVisibleTableRows() {
    if (currentTableData.length === 0) return [];

    return currentTableData.filter((row, idx) => {
        const tr = document.getElementById(`table-row-${idx}`);
        return !tr || tr.style.display !== 'none';
    });
}

function redactSensitiveData(value, key = '') {
    if (value === null || value === undefined) return value;

    if (typeof value === 'string') {
        return redactSensitiveString(value, key);
    }
    if (Array.isArray(value)) {
        return value.map(item => redactSensitiveData(item, key));
    }
    if (typeof value === 'object') {
        const redacted = {};
        Object.keys(value).forEach(childKey => {
            redacted[childKey] = redactSensitiveData(value[childKey], childKey);
        });
        return redacted;
    }
    return value;
}

function redactSensitiveString(value, key = '') {
    if (/serial/i.test(key)) return '[REDACTED_SERIAL]';

    return value
        .replace(/\b[A-Fa-f0-9]{2}(?::[A-Fa-f0-9]{2}){5}\b/g, '[REDACTED_MAC]')
        .replace(/\b[A-Fa-f0-9]{2}(?:-[A-Fa-f0-9]{2}){5}\b/g, '[REDACTED_MAC]')
        .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[REDACTED_IP]')
        .replace(/\b[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}\b/g, '[REDACTED_SERIAL]');
}

async function sendCurrentResultToCircuit() {
    const button = document.getElementById('send-circuit-btn');
    const status = document.getElementById('circuit-status');
    const responseBox = document.getElementById('circuit-response');

    if (!rawResponseData) {
        alert('Please run a Meraki API request first.');
        return;
    }

    const setStatus = (msg) => {
        if (status) status.innerText = msg;
    };

    if (button) {
        button.disabled = true;
        button.innerText = 'Sending...';
    }
    resetCircuitResponseTools();
    if (responseBox) {
        responseBox.style.display = 'block';
        responseBox.innerText = 'Waiting for Circuit response...';
    }

    try {
        const prompt = buildCircuitPrompt();
        setStatus('Looking for an existing Circuit tab...');

        const tabs = await chrome.tabs.query({ url: 'https://circuit.cisco.com/*' });
        if (!tabs || tabs.length === 0) {
            await openCircuitSsoPage();
            showCircuitLoginPrompt(responseBox, setStatus);
            return;
        }

        const circuitTab = tabs.find(tab => tab.url && tab.url.includes('/app/')) || tabs[0];
        setStatus('Sending prompt through the logged-in Circuit page...');

        let injectionResults;
        try {
            injectionResults = await chrome.scripting.executeScript({
                target: { tabId: circuitTab.id },
                func: postPromptToCircuitBrain,
                args: [prompt, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC']
            });
        } catch (scriptErr) {
            await openCircuitSsoPage(circuitTab.id);
            showCircuitLoginPrompt(responseBox, setStatus, scriptErr.message);
            return;
        }

        const result = injectionResults && injectionResults[0] ? injectionResults[0].result : null;
        if (!result) {
            throw new Error('Circuit page did not return a result.');
        }
        if (result.needsLogin) {
            await openCircuitSsoPage(circuitTab.id);
            showCircuitLoginPrompt(responseBox, setStatus, result.error);
            return;
        }
        if (!result.ok) {
            throw new Error(result.error || 'Circuit request failed.');
        }

        setStatus(`Circuit response received. Session: ${result.session_id || 'new conversation'}`);
        renderCircuitResponse(result.answer || '(Circuit returned an empty response.)');
        saveCircuitHistoryItem(result.answer || '', getCircuitUserPrompt());
    } catch (err) {
        setStatus(`Circuit request failed: ${err.message}`);
        renderCircuitResponse([
            'Unable to send to Circuit.',
            '',
            err.message,
            '',
            'Make sure https://circuit.cisco.com/app/home is open, loaded, and logged in.'
        ].join('\n'));
    } finally {
        if (button) {
            button.disabled = false;
            button.innerText = 'Send to Circuit';
        }
    }
}

function applyCircuitPromptPreset() {
    const select = document.getElementById('circuit-preset-select');
    const prompt = document.getElementById('circuit-prompt');
    if (!select || !prompt) return;

    prompt.value = CIRCUIT_PROMPT_PRESETS[select.value] || CIRCUIT_PROMPT_PRESETS.troubleshoot;
}

function getCircuitUserPrompt() {
    const prompt = document.getElementById('circuit-prompt');
    return prompt ? prompt.value.trim() : '';
}

async function loadCircuitHistory() {
    const select = document.getElementById('circuit-history-select');
    if (!select) return;

    const data = await chrome.storage.local.get([CIRCUIT_HISTORY_KEY]);
    const history = Array.isArray(data[CIRCUIT_HISTORY_KEY]) ? data[CIRCUIT_HISTORY_KEY] : [];

    select.innerHTML = '';
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.innerText = history.length > 0 ? 'Select recent response...' : 'No saved Circuit responses';
    select.appendChild(emptyOption);

    history.forEach((item, idx) => {
        const option = document.createElement('option');
        option.value = String(idx);
        option.innerText = `${item.createdAtLabel} - ${item.apiLabel}`;
        select.appendChild(option);
    });
}

async function saveCircuitHistoryItem(answer, prompt) {
    if (!answer) return;

    const data = await chrome.storage.local.get([CIRCUIT_HISTORY_KEY]);
    const history = Array.isArray(data[CIRCUIT_HISTORY_KEY]) ? data[CIRCUIT_HISTORY_KEY] : [];
    const apiLabel = currentSelectedApi
        ? `[${currentSelectedApi.method}] ${currentSelectedApi.path}`
        : 'Unknown API';
    const createdAt = new Date();

    history.unshift({
        createdAt: createdAt.toISOString(),
        createdAtLabel: createdAt.toLocaleString(),
        apiLabel,
        prompt,
        answer
    });

    await chrome.storage.local.set({
        [CIRCUIT_HISTORY_KEY]: history.slice(0, CIRCUIT_HISTORY_LIMIT)
    });
    await loadCircuitHistory();
}

async function loadCircuitHistoryItem() {
    const select = document.getElementById('circuit-history-select');
    const prompt = document.getElementById('circuit-prompt');
    if (!select || select.value === '') return;

    const data = await chrome.storage.local.get([CIRCUIT_HISTORY_KEY]);
    const history = Array.isArray(data[CIRCUIT_HISTORY_KEY]) ? data[CIRCUIT_HISTORY_KEY] : [];
    const item = history[Number(select.value)];
    if (!item) return;

    if (prompt && item.prompt) prompt.value = item.prompt;
    renderCircuitResponse(item.answer);
}

async function openCircuitSsoPage(tabId = null) {
    if (tabId) {
        await chrome.tabs.update(tabId, { url: CIRCUIT_HOME_URL, active: true });
        return;
    }

    const tabs = await chrome.tabs.query({ url: 'https://circuit.cisco.com/*' });
    const existingTab = tabs && tabs.length > 0 ? tabs[0] : null;
    if (existingTab && existingTab.id) {
        await chrome.tabs.update(existingTab.id, { url: CIRCUIT_HOME_URL, active: true });
        return;
    }

    await chrome.tabs.create({ url: CIRCUIT_HOME_URL, active: true });
}

function showCircuitLoginPrompt(responseBox, setStatus, detail = '') {
    setStatus('Circuit SSO page opened. Log in, wait for Circuit to load, then click Send again.');
    if (responseBox) {
        responseBox.innerText = [
            'Opened Circuit SSO:',
            CIRCUIT_HOME_URL,
            '',
            'After Circuit finishes loading and you are logged in, return here and click Send to Circuit again.',
            detail ? `\nDetail: ${detail}` : ''
        ].join('\n');
    }
}

function resetCircuitResponseTools() {
    lastCircuitAnswer = '';

    const actions = document.getElementById('circuit-response-actions');

    if (actions) actions.style.display = 'none';
}

function renderCircuitResponse(answer) {
    const responseBox = document.getElementById('circuit-response');
    const actions = document.getElementById('circuit-response-actions');

    lastCircuitAnswer = answer || '';

    if (responseBox) {
        responseBox.style.display = 'block';
        responseBox.innerText = lastCircuitAnswer;
    }
    if (actions) actions.style.display = 'flex';
}

async function copyCircuitText(text, buttonId, defaultLabel) {
    if (!text) return;

    const button = document.getElementById(buttonId);
    await navigator.clipboard.writeText(text);

    if (!button) return;
    button.innerText = 'Copied';
    setTimeout(() => {
        button.innerText = defaultLabel;
    }, 1400);
}

async function postPromptToCircuitBrain(prompt, userTimezone) {
    const makeUuid = () => {
        if (self.crypto && self.crypto.randomUUID) return self.crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    };

    const safeBtoa = (value) => {
        try {
            return btoa(value);
        } catch (e) {
            return btoa(unescape(encodeURIComponent(value)));
        }
    };

    const walkForValue = (value, predicate, depth = 0) => {
        if (depth > 5 || value === null || value === undefined) return null;
        if (typeof value === 'string') {
            return predicate(value) ? value : null;
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                const found = walkForValue(item, predicate, depth + 1);
                if (found) return found;
            }
            return null;
        }
        if (typeof value === 'object') {
            for (const key of Object.keys(value)) {
                if (/session[_-]?id|chat[_-]?conversation[_-]?id/i.test(key) && typeof value[key] === 'string') {
                    if (predicate(value[key])) return value[key];
                }
                const found = walkForValue(value[key], predicate, depth + 1);
                if (found) return found;
            }
        }
        return null;
    };

    const scanStorage = (predicate) => {
        const stores = [window.localStorage, window.sessionStorage];
        for (const store of stores) {
            for (let i = 0; i < store.length; i++) {
                const key = store.key(i);
                const value = store.getItem(key);
                if (!value) continue;
                if (predicate(value)) return value;
                try {
                    const parsed = JSON.parse(value);
                    const found = walkForValue(parsed, predicate);
                    if (found) return found;
                } catch (e) {}
            }
        }
        return null;
    };

    const findExistingSessionId = () => {
        return scanStorage(value => /###[0-9a-f-]{20,}###\d+/i.test(value));
    };

    const findUserId = () => {
        const photo = document.querySelector('img[src*="/dir/photo/std/"]');
        if (photo && photo.src) {
            const match = photo.src.match(/\/dir\/photo\/std\/([^/.]+)\./);
            if (match) return match[1];
        }

        const storedUser = scanStorage(value => /^[a-z][a-z0-9_-]{2,20}$/i.test(value));
        if (storedUser) return storedUser;

        const textMatch = document.body && document.body.innerText
            ? document.body.innerText.match(/\b[a-z][a-z0-9_-]{2,20}@cisco\.com\b/i)
            : null;
        return textMatch ? textMatch[0].split('@')[0] : 'meraki-extension';
    };

    const sessionId = findExistingSessionId() || `${safeBtoa(findUserId())}###${makeUuid()}###${Date.now()}`;
    const chatRequestId = makeUuid();
    const payload = {
        session_id: sessionId,
        prompt,
        uiversion: 'ciscogpt',
        versionType: 'external',
        fileDetails: [],
        chat_conversation_id: sessionId,
        chat_request_id: chatRequestId,
        user_timezone: userTimezone,
        conversation: true,
        type: 'default',
        operation: 'default',
        model_type: 'default',
        files_attached: false,
        is_csv: false,
        is_excel: false,
        searchType: ''
    };

    const response = await fetch('/app/webservices/generativeAI/brain', {
        method: 'POST',
        credentials: 'include',
        headers: {
            accept: '*/*',
            'content-type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) {
        const body = await response.text();
        return {
            ok: false,
            needsLogin: response.status === 401 || response.status === 403,
            status: response.status,
            error: `Circuit returned HTTP ${response.status}: ${body.slice(0, 1000)}`
        };
    }

    if (response.redirected || contentType.includes('text/html')) {
        const body = await response.text();
        return {
            ok: false,
            needsLogin: true,
            status: response.status,
            error: `Circuit returned a login or HTML page instead of an AI response. ${body.slice(0, 300)}`
        };
    }

    if (contentType.includes('text/event-stream') && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let answer = '';
        let lastEvent = null;

        const processBlock = (block) => {
            const dataLines = block
                .split('\n')
                .filter(line => line.startsWith('data:'))
                .map(line => line.slice(5).trim());
            if (dataLines.length === 0) return;

            const dataText = dataLines.join('\n');
            if (!dataText || dataText === '[DONE]') return;

            try {
                const event = JSON.parse(dataText);
                lastEvent = event;
                if (typeof event.data === 'string') {
                    answer += event.data;
                }
            } catch (e) {}
        };

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const blocks = buffer.split('\n\n');
            buffer = blocks.pop() || '';
            blocks.forEach(processBlock);
        }

        if (buffer.trim()) processBlock(buffer);

        return {
            ok: true,
            answer,
            session_id: lastEvent && lastEvent.session_id ? lastEvent.session_id : sessionId,
            response_type: lastEvent && lastEvent.response_type ? lastEvent.response_type : 'final_response_stream'
        };
    }

    const text = await response.text();
    try {
        const json = JSON.parse(text);
        return {
            ok: true,
            answer: json.data || json.response || JSON.stringify(json, null, 2),
            session_id: json.session_id || sessionId,
            response_type: json.response_type || 'json'
        };
    } catch (e) {
        return {
            ok: true,
            answer: text,
            session_id: sessionId,
            response_type: contentType || 'text'
        };
    }
}



async function forceUpdateSpec() {
    const logBox = document.getElementById('debug-log');
    const updateBtn = document.getElementById('update-spec-btn');
    const badge = document.getElementById('spec-version-badge');
    if (!updateBtn) return;
    
    const originalText = updateBtn.innerText;
    updateBtn.innerText = '⏳ Downloading...';
    updateBtn.disabled = true;
    
    let debugLogs = `=======================================\n🔄 OpenAPI Spec Sync Triggered\n=======================================\n`;
    const log = (msg) => {
        debugLogs += `> ${msg}\n`;
        logBox.innerText = debugLogs;
        logBox.scrollTop = logBox.scrollHeight;
    };
    
    try {
        log("Fetching latest spec3.json from raw.githubusercontent.com...");
        const res = await fetch("https://raw.githubusercontent.com/meraki/openapi/master/openapi/spec3.json");
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        
        log("Parsing spec JSON...");
        const spec = await res.json();
        
        log("Saving to local chrome storage...");
        await chrome.storage.local.set({ 'merakiSpec': spec });
        
        log("Caching successful. Rebuilding API layout...");
        globalSpec = spec;
        
        if (badge && globalSpec.info) {
            const apiVer = globalSpec.info.version || 'Unknown';
            const oasVer = globalSpec.openapi || '?';
            badge.innerText = `v${apiVer} (OAS ${oasVer})`;
            badge.style.display = 'inline-block';
        }
        
        buildDeepApiTree();
        renderCollapsibleTree();
        
        log("✅ API specification updated successfully!");
        updateBtn.innerText = '✅ Updated';
        setTimeout(() => {
            updateBtn.innerText = originalText;
            updateBtn.disabled = false;
        }, 2000);
    } catch (err) {
        log(`❌ Refresh failed: ${err.message}`);
        updateBtn.innerText = '❌ Failed';
        setTimeout(() => {
            updateBtn.innerText = originalText;
            updateBtn.disabled = false;
        }, 3000);
    }
}

function renderJsonTree(data, container, noticeText = '') {
    container.innerHTML = '';
    if (noticeText) {
        const notice = document.createElement('div');
        notice.className = 'result-notice';
        notice.innerText = noticeText;
        container.appendChild(notice);
    }
    if (data === null || data === undefined) {
        const nullNode = document.createElement('span');
        nullNode.className = 'json-val-null';
        nullNode.innerText = 'null';
        container.appendChild(nullNode);
        return;
    }
    const treeRoot = buildJsonTreeNode(data, '', true);
    container.appendChild(treeRoot);
}

function buildJsonTreeNode(val, key = '', isLast = true) {
    const nodeEl = document.createElement('div');
    nodeEl.className = 'json-node';
    
    let keySpan = null;
    if (key !== '') {
        keySpan = document.createElement('span');
        keySpan.className = 'json-key';
        keySpan.innerText = `"${key}": `;
    }
    
    const type = typeof val;
    
    if (val === null) {
        if (keySpan) nodeEl.appendChild(keySpan);
        const valSpan = document.createElement('span');
        valSpan.className = 'json-val-null';
        valSpan.innerText = 'null' + (isLast ? '' : ',');
        nodeEl.appendChild(valSpan);
    } else if (type === 'string') {
        if (keySpan) nodeEl.appendChild(keySpan);
        const valSpan = document.createElement('span');
        valSpan.className = 'json-val-string';
        valSpan.innerText = `"${val}"` + (isLast ? '' : ',');
        nodeEl.appendChild(valSpan);
    } else if (type === 'number') {
        if (keySpan) nodeEl.appendChild(keySpan);
        const valSpan = document.createElement('span');
        valSpan.className = 'json-val-number';
        valSpan.innerText = val + (isLast ? '' : ',');
        nodeEl.appendChild(valSpan);
    } else if (type === 'boolean') {
        if (keySpan) nodeEl.appendChild(keySpan);
        const valSpan = document.createElement('span');
        valSpan.className = 'json-val-boolean';
        valSpan.innerText = val + (isLast ? '' : ',');
        nodeEl.appendChild(valSpan);
    } else if (Array.isArray(val)) {
        const toggleSpan = document.createElement('span');
        toggleSpan.className = 'json-toggle';
        toggleSpan.innerText = '▼ ';
        nodeEl.appendChild(toggleSpan);
        
        if (keySpan) nodeEl.appendChild(keySpan);
        
        const openBracket = document.createElement('span');
        openBracket.innerText = '[';
        nodeEl.appendChild(openBracket);
        
        const collapsedText = document.createElement('span');
        collapsedText.className = 'json-collapsed-text';
        collapsedText.innerText = ` ... ${val.length} items `;
        collapsedText.style.display = 'none';
        nodeEl.appendChild(collapsedText);
        
        const childrenContainer = document.createElement('div');
        childrenContainer.style.paddingLeft = '10px';
        
        val.forEach((item, idx) => {
            const childNode = buildJsonTreeNode(item, '', idx === val.length - 1);
            childrenContainer.appendChild(childNode);
        });
        nodeEl.appendChild(childrenContainer);
        
        const closeBracket = document.createElement('div');
        closeBracket.innerText = ']' + (isLast ? '' : ',');
        nodeEl.appendChild(closeBracket);
        
        toggleSpan.addEventListener('click', (e) => {
            e.stopPropagation();
            const isCollapsed = childrenContainer.style.display === 'none';
            if (isCollapsed) {
                childrenContainer.style.display = 'block';
                collapsedText.style.display = 'none';
                toggleSpan.innerText = '▼ ';
                toggleSpan.classList.remove('collapsed');
            } else {
                childrenContainer.style.display = 'none';
                collapsedText.style.display = 'inline';
                toggleSpan.innerText = '▶ ';
                toggleSpan.classList.add('collapsed');
            }
        });
        
    } else if (type === 'object') {
        const toggleSpan = document.createElement('span');
        toggleSpan.className = 'json-toggle';
        toggleSpan.innerText = '▼ ';
        nodeEl.appendChild(toggleSpan);
        
        if (keySpan) nodeEl.appendChild(keySpan);
        
        const openBrace = document.createElement('span');
        openBrace.innerText = '{';
        nodeEl.appendChild(openBrace);
        
        const keys = Object.keys(val);
        const collapsedText = document.createElement('span');
        collapsedText.className = 'json-collapsed-text';
        collapsedText.innerText = ` ... ${keys.length} keys `;
        collapsedText.style.display = 'none';
        nodeEl.appendChild(collapsedText);
        
        const childrenContainer = document.createElement('div');
        childrenContainer.style.paddingLeft = '10px';
        
        keys.forEach((k, idx) => {
            const childNode = buildJsonTreeNode(val[k], k, idx === keys.length - 1);
            childrenContainer.appendChild(childNode);
        });
        nodeEl.appendChild(childrenContainer);
        
        const closeBrace = document.createElement('div');
        closeBrace.innerText = '}' + (isLast ? '' : ',');
        nodeEl.appendChild(closeBrace);
        
        toggleSpan.addEventListener('click', (e) => {
            e.stopPropagation();
            const isCollapsed = childrenContainer.style.display === 'none';
            if (isCollapsed) {
                childrenContainer.style.display = 'block';
                collapsedText.style.display = 'none';
                toggleSpan.innerText = '▼ ';
                toggleSpan.classList.remove('collapsed');
            } else {
                childrenContainer.style.display = 'none';
                collapsedText.style.display = 'inline';
                toggleSpan.innerText = '▶ ';
                toggleSpan.classList.add('collapsed');
            }
        });
    }
    
    return nodeEl;
}

function flattenObject(obj, prefix = '') {
    const flat = {};
    for (const key in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
        const val = obj[key];
        const newKey = prefix ? `${prefix}.${key}` : key;
        
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            Object.assign(flat, flattenObject(val, newKey));
        } else {
            flat[newKey] = val;
        }
    }
    return flat;
}

function renderTable(flatData, headers, noticeText = '') {
    const table = document.getElementById('data-result-table');
    table.innerHTML = '';

    if (noticeText) {
        const caption = document.createElement('caption');
        caption.className = 'result-notice';
        caption.innerText = noticeText;
        table.appendChild(caption);
    }
    
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headers.forEach(h => {
        const th = document.createElement('th');
        th.innerText = h;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    const tbody = document.createElement('tbody');
    flatData.forEach((row, rowIdx) => {
        const tr = document.createElement('tr');
        tr.id = `table-row-${rowIdx}`;
        
        headers.forEach(h => {
            const td = document.createElement('td');
            const val = row[h];
            let copyText = '';
            if (val === undefined || val === null) {
                td.innerText = '';
            } else if (typeof val === 'object') {
                if (Array.isArray(val)) {
                    if (val.length === 0) {
                        td.innerText = '';
                        td.title = '[] (Double-click to copy)';
                        copyText = '[]';
                    } else {
                        const allPrimitives = val.every(item => item === null || typeof item !== 'object');
                        if (allPrimitives) {
                            const joined = val.map(item => item === null ? 'null' : String(item)).join(', ');
                            td.innerText = joined;
                            td.title = `${joined} (Double-click to copy)`;
                            copyText = joined;
                        } else {
                            const str = JSON.stringify(val);
                            let displayed = str;
                            if (str.length > 100) {
                                displayed = str.substring(0, 100) + '...';
                            }
                            td.innerText = displayed;
                            td.title = `${str}\n\n(Double-click to copy)`;
                            copyText = str;
                        }
                    }
                } else {
                    const str = JSON.stringify(val);
                    let displayed = str;
                    if (str.length > 100) {
                        displayed = str.substring(0, 100) + '...';
                    }
                    td.innerText = displayed;
                    td.title = `${str}\n\n(Double-click to copy)`;
                    copyText = str;
                }
            } else {
                const str = String(val);
                td.innerText = str;
                td.title = `${str} (Double-click to copy)`;
                copyText = str;
            }

            if (copyText) {
                td.addEventListener('dblclick', () => {
                    navigator.clipboard.writeText(copyText).then(() => {
                        td.classList.add('copied-cell');
                        setTimeout(() => {
                            td.classList.remove('copied-cell');
                        }, 800);
                    });
                });
            }
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
}

function handleTableSearch(e) {
    const keyword = e.target.value.trim().toLowerCase();
    
    currentTableData.forEach((row, idx) => {
        const tr = document.getElementById(`table-row-${idx}`);
        if (!tr) return;
        
        if (!keyword) {
            tr.style.display = '';
            return;
        }
        
        const matches = Object.values(row).some(val => {
            if (val === null || val === undefined) return false;
            const strVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
            return strVal.toLowerCase().includes(keyword);
        });
        
        tr.style.display = matches ? '' : 'none';
    });
}

function yieldToBrowser() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

function rowMatchesKeyword(row, keyword) {
    if (!keyword) return true;
    return Object.values(row).some(val => {
        if (val === null || val === undefined) return false;
        const strVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
        return strVal.toLowerCase().includes(keyword);
    });
}

function getExportBaseName() {
    const envDomain = document.getElementById('env-select').value;
    const cleanPath = currentSelectedApi ? currentSelectedApi.path.replace(/\//g, '_').replace(/[{}]/g, '') : 'export';
    return `${envDomain}${cleanPath}_export`;
}

function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

async function exportToCsv() {
    if (!Array.isArray(rawResponseData) || rawResponseData.length === 0) return;

    const exportBtn = document.getElementById('copy-btn');
    const originalText = exportBtn ? exportBtn.innerText : '';
    const keyword = document.getElementById('table-search').value.trim().toLowerCase();
    const headers = new Set(tableHeaders);
    const csvRows = [];
    let exportedRows = 0;
    const batchSize = 500;

    if (exportBtn) {
        exportBtn.disabled = true;
        exportBtn.innerText = 'Preparing...';
    }

    try {
        for (let i = 0; i < rawResponseData.length; i += batchSize) {
            rawResponseData.slice(i, i + batchSize).forEach(item => {
                const row = flattenObject(item);
                if (!rowMatchesKeyword(row, keyword)) return;
                Object.keys(row).forEach(key => headers.add(key));
            });
            if (exportBtn) exportBtn.innerText = `Scanning ${Math.min(i + batchSize, rawResponseData.length).toLocaleString()}`;
            await yieldToBrowser();
        }

        const headerList = Array.from(headers);
        csvRows.push(headerList.map(h => `"${h.replace(/"/g, '""')}"`).join(','));

        for (let i = 0; i < rawResponseData.length; i += batchSize) {
            rawResponseData.slice(i, i + batchSize).forEach(item => {
                const row = flattenObject(item);
                if (!rowMatchesKeyword(row, keyword)) return;

                const rowStr = headerList.map(h => {
                    let val = row[h];
                    if (val === undefined || val === null) return '""';
                    if (typeof val === 'object') val = JSON.stringify(val);
                    return `"${String(val).replace(/"/g, '""')}"`;
                }).join(',');
                csvRows.push(rowStr);
                exportedRows++;
            });
            if (exportBtn) exportBtn.innerText = `Writing ${exportedRows.toLocaleString()}`;
            await yieldToBrowser();
        }

        if (exportedRows === 0) {
            alert('No rows matched the current table search.');
            return;
        }

        const blob = new Blob([csvRows.join('\n') + '\n'], { type: 'text/csv;charset=utf-8;' });
        downloadBlob(blob, `${getExportBaseName()}.csv`);
    } finally {
        if (exportBtn) {
            exportBtn.disabled = false;
            exportBtn.innerText = originalText || 'Export Excel CSV';
            updatePrimaryDataActionButton();
        }
    }
}

async function exportToJson() {
    if (!rawResponseData) return;

    const exportBtn = document.getElementById('copy-btn');
    const originalText = exportBtn ? exportBtn.innerText : '';

    if (exportBtn) {
        exportBtn.disabled = true;
        exportBtn.innerText = 'Preparing...';
    }

    try {
        await yieldToBrowser();
        const blob = new Blob([JSON.stringify(rawResponseData, null, 2)], { type: 'application/json;charset=utf-8;' });
        downloadBlob(blob, `${getExportBaseName()}.json`);
    } finally {
        if (exportBtn) {
            exportBtn.disabled = false;
            exportBtn.innerText = originalText || 'Download JSON';
            updatePrimaryDataActionButton();
        }
    }
}
