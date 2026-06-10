chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

// 插件启动时自动缓存 API 文档
chrome.runtime.onInstalled.addListener(() => {
    fetch("https://raw.githubusercontent.com/meraki/openapi/master/openapi/spec3.json")
    .then(res => res.json())
    .then(spec => chrome.storage.local.set({ 'merakiSpec': spec }))
    .catch(console.error);
});