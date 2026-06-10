# Meraki API SSO Console (v4.5)

A lightweight, premium Chrome Developer Extension designed for Cisco Meraki Network Support Engineers (NSEs). It intercepts, caches, and utilizes active Meraki Dashboard Single Sign-On (SSO) browser sessions to safely execute read-only GET requests and select diagnostic APIs directly from the browser's side panel.

---

## Major Functions & Features

### 🔑 1. Session SSO Pass-through
* Executes API queries within the context of your active browser session on the Meraki Dashboard.
* Eliminates the need for manual API key generation, copying, or configuration.

### 🔍 2. In-Order Fuzzy Operation Search
* Search and filter through thousands of Meraki endpoints in real-time.
* Features a smart token fuzzy search: queries like `"get org net"` will instantly match operations such as `getOrganizationNetworks` by matching tokens sequentially across the operation ID, summary, or path.

### 🌳 3. Interactive JSON Tree Viewer
* Visualizes API response bodies using a color-coded syntax highlighter.
* Supports collapsible/expandable nodes for nested arrays and objects to drill down into payload data easily.

### 📊 4. Dynamic Data Table View
* When an endpoint returns an array of records, the console activates the **Data Table** view.
* Flattens nested dictionary keys (e.g. `device.status`) into structured columns.
* Placed columns are fully **resizable** by dragging header borders.
* Cells containing complex structures or arrays are stringified and safely truncated with tooltips showing the complete value on hover.

### 📋 5. Double-Click to Copy & Visual Flash
* Double-clicking any cell in the Data Table copies its **entire untruncated content** directly to the clipboard.
* The clicked cell briefly flashes green as confirmation.

### 💾 6. Client-Side Search & CSV Exporter
* Filter rows instantly with the client-side search box inside the Data Table view.
* Export filtered or complete table outputs to a formatted `.csv` download file matching your select environment and request path.

### 🔄 7. OpenAPI Spec Synchronizer
* Keeps the extension updated with the latest Meraki API releases.
* Features a manual update trigger to fetch and cache the official OpenAPI specifications on-demand.

---

## How to Install (Chrome Developer Mode)

1. Open Google Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode** in the top-right corner.
3. Click the **Load unpacked** button in the top-left corner.
4. Select the root folder of this repository (the folder containing `manifest.json`).
5. The extension **"Meraki API SSO Console"** will install and appear in your extension list.

---

## How to Use the Extension

1. **Open the Side Panel**:
   Click the Chrome Extensions toolbar icon (puzzle piece) or Side Panel icon and choose **Meraki API SSO Console** from the dropdown.

2. **Select your Environment**:
   Choose the appropriate regional API shard domain from the top dropdown (e.g. `🌐 Global (.com)`, `🇨🇳 China (.cn)`, `🇨🇦 Canada (.ca)`, or `🇮🇳 India (.in)`).

3. **Search for an API Operation**:
   Start typing keywords into the search box under step 1 (e.g., `"get org"`). The sidebar tree will filter operations dynamically.

4. **Fill in Required Parameters**:
   Select an API operation. The UI will automatically generate form fields for any required Path or Query parameters. Enter the manual IDs (e.g. Network ID starting with `N_...` or Org ID starting with `L_...`).

5. **Execute the Call**:
   Click the green **Run Request** button. Status logs will populate in the debug window.

6. **View and Export Results**:
   * Inspect the formatted payload in the **JSON View** tab.
   * Toggle to the **Data Table** tab for lists, filter results, double-click values to copy them, or click **Download CSV** to export.
