# 客户地址排列神器

一个为手机端优化的行程管理网页应用，帮助快速安排每周上门量尺寸的客户路线。应用默认使用浏览器本地存储，也支持同步到 Google Sheets，结合 Google Maps Places / Directions API 提供地址自动补全与导航跳转。

## 功能亮点
- “今天 / 未来”行程分栏展示，按日期自动归类
- 支持添加、编辑、删除客户行程，并提供双重确认
- 集成 Google Places 自动补全，减少输入错误
- 依据客户坐标生成避收费路段的行驶顺序
- 一键打开 Google 地图或复制客户顺序文本
- UI 为中文界面，移动端优先设计

## 快速开始
1. 将 `config.sample.js` 复制为 `config.js`，填入：
   ```js
   export const GOOGLE_MAPS_API_KEY = 'YOUR_MAPS_KEY';
   export const GOOGLE_OAUTH_CLIENT_ID = 'YOUR_OAUTH_CLIENT_ID';
   export const GOOGLE_SHEETS_SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID';
   export const GOOGLE_SHEETS_TAB_NAME = 'Clients'; // 可自定义
   ```
2. 在 [Google Cloud Console](https://console.cloud.google.com/) 中：
   - 为同一个项目启用 **Maps JavaScript API / Places API / Directions API / Geocoding API / Distance Matrix API**。
   - 启用 **Google Sheets API** 并在 “OAuth 同意屏幕” 中配置测试用户。
   - 创建 “Web application” 类型的 OAuth 2.0 Client ID，并将本地开发使用的来源（如 `http://localhost:5173`）加入授权 JavaScript 来源列表。
3. 创建一个 Google 表格，并与登录该应用的 Google 账号共享“编辑者”权限，拿到表格 ID（`https://docs.google.com/spreadsheets/d/<ID>/edit` 中的 `<ID>`）。
4. 使用 `python -m http.server 5173`（或任意本地 Dev Server）在 `http://localhost:5173` 访问 `index.html`，首次会弹出定位和 Google 登录授权，请允许后即可同步。

> ⚠️ 如果暂未配置 OAuth / Sheets，应用依旧可在本地浏览器存储行程，但不同设备之间不会同步。

## Google Sheets 字段
默认写入的工作表需要包含以下列：
`id | name | address | date | time | contact | placeId | lat | lng`

首次同步时应用会自动写入表头；如需自定义列顺序，请同时修改 `src/sheets.js` 中的 `HEADER` 常量。

## 使用说明
- 首页右上角或底部点击“添加日程”填写客户信息；保存时会提示“确认好哪个区了吗？”。
- 当日存在行程时，点击“出发”会按当前位置生成避收费路线，并在摘要区域提供导航按钮与复制功能。
- 当开启 Sheets 同步后，新增 / 编辑 / 删除会自动写入云端表格，断网时仍会先保存在本地，恢复后自动补同步。

## 技术要点
- 前端使用原生 ES Modules，核心数据仍保存在 `localStorage`，保证离线可用
- Google Maps Places Autocomplete + Geocoder 缓存经纬度，减少重复解析
- 使用 `navigator.geolocation` 获取起点，需 HTTPS 或 `http://localhost`
- Sheets 同步使用 Google Identity Services 获取 OAuth token，再通过 Sheets API 读写

## 部署建议
- 纯静态站点，可托管到 GitHub Pages / Vercel / Firebase Hosting 等平台
- 部署时请确保 `config.js` 未上传到公共仓库（`.gitignore` 已覆盖）
- 生产环境建议为正式域名配置 HTTPS，并在 OAuth 客户端中添加该域名

祝使用愉快！
