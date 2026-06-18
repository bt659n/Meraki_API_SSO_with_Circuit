# Meraki API Connect to Circuit AI (v5.0)

A lightweight Chrome Developer Extension designed for Cisco Meraki Network Support Engineers (NSEs). It uses active Meraki Dashboard Single Sign-On (SSO) browser sessions to execute read-only GET requests and select diagnostic APIs directly from the browser's side panel, then can send the latest result to Circuit AI through an already logged-in Circuit browser tab.

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
* For very large array responses, renders a configurable JSON preview instead of building a massive DOM tree.
* Downloads the full fetched JSON result from the JSON View action button, even when the on-screen preview is limited.

### 📊 4. Dynamic Data Table View
* When an endpoint returns an array of records, the console activates the **Data Table** view.
* Flattens nested dictionary keys (e.g. `device.status`) into structured columns.
* Placed columns are fully **resizable** by dragging header borders.
* Cells containing complex structures or arrays are stringified and safely truncated with tooltips showing the complete value on hover.
* Renders large datasets in local table pages so the side panel stays responsive.
* Uses **Prev** and **Next** to move through already fetched records without re-querying the Meraki API.

### 📋 5. Double-Click to Copy & Visual Flash
* Double-clicking any cell in the Data Table copies its **entire untruncated content** directly to the clipboard.
* The clicked cell briefly flashes green as confirmation.

### 💾 6. Large Result Controls & Exporter
* Adds a **Stop** button while an API request is running. Stopping cancels the active fetch and displays records already received.
* Adds local safety controls for maximum fetched records, JSON preview size, and table page size.
* Automatically uses `perPage=1000` when supported and left empty, reducing the number of pagination requests.
* Filter rows instantly with the client-side search box inside the Data Table view.
* In **JSON View**, the primary result action downloads the full fetched `.json` file.
* In **Table View**, the primary result action exports the full fetched table data as a `.csv` file that opens cleanly in Excel.

> Note: UI previews are intentionally capped to avoid browser slowdowns. CSV and JSON exports use the full data fetched up to the configured maximum record limit.

### 🤖 7. Send Result to Circuit AI
* Adds a **Send to Circuit** panel below the API result.
* Sends the latest API response plus your instruction prompt to `https://circuit.cisco.com/app/webservices/generativeAI/brain`.
* Uses an existing logged-in Circuit tab and parses the streaming response back into the extension.
* Keeps the AI result as text in the extension, with a copy button for case notes or follow-up work.
* Includes prompt presets, data-scope selection, optional redaction for MAC/IP/serial-like values, and recent response history.

### ⏱️ 8. Time Parameter Shortcuts
* Shows shortcut buttons for APIs with `timespan` or `t0`/`t1` query parameters.
* Quickly fills common ranges like last 5 minutes, 30 minutes, 2 hours, or 1 day.
* Highlights the selected shortcut in green, then clears that highlight when the time fields are manually edited.

### 🔄 9. OpenAPI Spec Synchronizer
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
   For APIs that require time range parameters, use the generated time shortcut buttons or fill `timespan` / `t0` and `t1` manually. The active shortcut stays highlighted until you manually edit the generated time fields.
   For large paginated responses, adjust **Max records**, **JSON preview**, and **Table rows** before running. Click **Stop** at any time to halt pagination and keep the records already fetched.

6. **View and Export Results**:
   * Inspect the formatted payload in the **JSON View** tab. Large arrays show only a preview on screen, but **Download JSON** exports the full fetched payload.
   * Toggle to the **Data Table** tab for lists, filter the current page, move through local pages with **Prev** / **Next**, double-click values to copy them, or use **Export Excel CSV** to export the full fetched table data.

7. **Send Results to Circuit AI**:
   * Open `https://circuit.cisco.com/app/home` in Chrome and make sure you are logged in.
   * Run a Meraki API request in the extension.
   * Choose a prompt preset, data scope, and redaction setting in **Send Result to Circuit AI**.
   * Edit the prompt if needed, then click **Send to Circuit**.
   * The Circuit response will stream back and appear in the extension.
   * If Circuit is not open or the session is not ready, the extension opens `https://circuit.cisco.com/app/home` for SSO. Log in, wait for Circuit to load, then click **Send to Circuit** again.
