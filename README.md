# Meraki_API_SSO
# 🚀 Meraki API SSO 直连极速控制台 (Meraki API Fast-Console)

**专为 Cisco Meraki NSE (Network Support Engineers) 及高级开发者打造的浏览器端无缝发包神器。**

![Version](https://img.shields.io/badge/Version-4.4-brightgreen.svg)
![Manifest](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-blue.svg)
![License](https://img.shields.io/badge/License-MIT-orange.svg)

## 💡 诞生背景与痛点思考 (Why we built this?)

在日常的 Meraki 网络大规模排错和客户支持中，NSE 经常需要调用 Meraki API（尤其是 LiveTools 和各类状态查询接口）。传统方式存在极大的摩擦力：
1. **API Key 管理繁琐**：通过 Postman 发包需要客户授权生成 API Key，Key 有效期短，且跨 Org 调试时需要频繁切换。
2. **海量数据截断**：像 `/alerts/history` 或数千个 Networks 列表，默认只会返回第一页。在 Postman 里手动找 `startingAfter` 游标拼 URL 简直是噩梦。
3. **反人类的时间戳**：接口要求的 `t0`, `t1` 是纯 UTC Unix 时间或 ISO 8601 字符串，每次查 Log 都需要额外打开网页转换时区，极其影响排错连贯性。
4. **官方文档检索慢**：官方文档体系庞大，想要快速根据 Operation ID 测试一个偏门 API，层层翻找很耗时。

**本项目旨在打破这些壁垒：让 API 调试像在终端里敲命令一样顺滑、无感、极速。**

## ✨ 核心功能 (Key Features)

* 🔑 **原生 SSO 会话直连 (Zero-Config Auth)**：无需任何 API Key！利用浏览器底层的 `credentials: 'include'`，直接白嫖你当前登录在 Meraki Dashboard 的管理员 Session 鉴权发包。
* 🌐 **全区服环境支持 (Multi-Region)**：一键切换 Global (`.com`), China (`.cn`), Canada (`.ca`), India (`.in`) 网关。
* 🤖 **史诗级全自动游标分页引擎 (Auto-Pagination)**：
    * 自动解析 RFC 5988 `Link: rel="next"` 响应头。
    * 独创 **CORS 智能回退机制**：在浏览器因跨域安全策略屏蔽 Header 时，自动提取数据尾部元素的 ID/Serial 作为游标，强行向后翻页，最高可无缝吞噬拼接 50 页（数万条）数据！
* 🕒 **所见即所得的时间转换器 (Smart Time Converter)**：检测到 `t0/t1` 参数时，自动生成原生可视化日历，无论你怎么选，底层都会毫秒级同步为 API 要求的标准零时区 (UTC) 格式，消灭时区差错。
* 🔍 **毫秒级内存检索 (Real-time Filter)**：复刻官网，直接输入 `Operation ID` 或关键字，在数百个接口中瞬间定位。
* 💻 **分离式极客终端 UI (Split Console UI)**：上方显示带翻页追踪的运行过程日志 (Trace Log)，下方沉淀纯净的 JSON 载荷，并附带一键系统剪贴板复制功能。

---

## 🛠️ 架构与实现原理解析 (How it works?)

作为个人 Track 记录，以下是该项目最核心的几个技术攻坚点：

### 1. 动态 OpenAPI 解析树
插件没有硬编码任何一个 API 路径。`background.js` 在安装时会从 GitHub Raw 抓取最新的 `spec3.json` 缓存在浏览器本地。`popup.js` 通过解析 `tags` 数组（例如 `["networks", "monitor", "alerts"]`）在内存中递归构建出无限级折叠的 DOM 树。当官方发布新 API 时，只需点击扩展页的刷新 🔄 即可同步。

### 2. 突破跨域阻断 (The CORS Challenge)
在侧边栏向 `api.meraki.cn` 发包属于跨域行为 (Cross-Origin)。
* **思路**：在 `manifest.json` 的 `host_permissions` 中显式声明了所有 Meraki Region 域名，赋予插件极高的网络特权，避免了基础的 `Failed to fetch`。
* **深层跨域对抗**：Meraki 网关有时未在 `Access-Control-Expose-Headers` 中放行 `Link` 分页头。我们在 `runApi` 的 `while` 循环中加入了强力兜底：`const lastCursor = lastItem.id || lastItem.serial || lastItem.occurredAt;`，即使拿不到 Header，依然能用最后一条数据的指纹强行组装 `startingAfter` 发起下一次请求。

### 3. 表单参数动态挂载与双路监听
针对 `<input type="datetime-local">` 浏览器原生组件事件不同步的经典 UX Bug，我们摒弃了容易被 CSP (内容安全策略) 拦截的内联 HTML 事件，改为在 DOM 渲染后动态绑定 `input` 和 `change` 双路事件：
```javascript
const syncTime = () => { textInput.value = datePicker.value ? datePicker.value + ':00Z' : ''; };
datePicker.addEventListener('input', syncTime);
datePicker.addEventListener('change', syncTime);






📦 安装指南 (Installation)
由于本项目申请了全局 Dashboard 域名的深层网络特权，为了企业合规性，强烈建议通过 ZIP 压缩包在团队内部以开发者模式分发，不要上架 Chrome Web Store。
	1.	在本 GitHub 仓库点击 Code -> Download ZIP。
	2.	将 ZIP 文件解压到本地固定文件夹（如 D:\Meraki_Tools\Meraki_API_Console）。
	3.	打开 Chrome 浏览器，访问扩展管理页：chrome://extensions/。
	4.	打开页面右上角的 开发者模式 (Developer mode)。
	5.	点击左上角 加载已解压的扩展程序 (Load unpacked)。
	6.	选择你刚才解压的文件夹，安装完成！建议将插件“钉”在浏览器工具栏。
🕹️ 使用姿势 (Usage)
	1.	先决条件：确保你的 Chrome 浏览器当前有一个活跃的 Meraki Dashboard 标签页（无论是 .com 还是 .cn）。
	2.	打开插件侧边栏。
	3.	在顶部分别选择你要测试的 目标环境 (Region)。
	4.	使用左侧菜单浏览，或在搜索框输入 Operation ID（如 getNetworkAlertsHistory）。
	5.	填入必填的 Path 参数（如 networkId）。
	6.	（可选）展开高级查询参数，设定 perPage: 1000 并选择起始时间。
	7.	点击 运行当前 API (SSO 直连)。
	8.	喝口茶，看着终端日志自动疯狂翻页拉取，最后点击 📋 复制数据。
🗺️ 版本演进轨迹 (Track / Changelog)
•	v4.4 (Current): 史诗级 UI 终局。分离调试日志与纯净数据输出窗口；新增一键复制数据至系统剪贴板；加入底层 CSP 防护绕过，彻底解决日历二次选择不同步问题。
•	v4.3: 加入 India (.in) 与 Canada (.ca) 节点支持；实装 Smart Cursor Fallback（智能 CORS 游标回退机制）；加入 t0/t1 时间戳智能可视化转换。
•	v4.2: 重构为 Manifest V3 SidePanel 侧边栏模式；加入基于 spec3.json 的动态树状目录渲染。
•	v4.1: 接入 host_permissions 攻克跨域直连痛点；支持 .cn 国区独立 Session 特权。
Built with coffee and pure engineering empathy by Meraki NSE.
