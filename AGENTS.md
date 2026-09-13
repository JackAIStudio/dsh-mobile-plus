<!-- dsh-mobile-plus-architecture -->
# 代码架构与模块化规范（Agent 必读）

本项目已完成原生 ESM 零构建（Zero-Build）模块化重构。为保持 Agent 高效推理、极速编辑与代码可维护性，所有 Agent 改动必须严格遵守以下规则：

## 1. 零单文件膨胀原则（Strict File Size Limits）
- **新增文件上限**：任何新增的 `.js` / `.css` 文件不得超过 **300 行**。
- **存量超标只许减小**：`public/css/sheets.css`、`public/js/chat/fold.js`、`client.js`、`public/js/net/mux.js`、`public/css/composer.css`、`public/css/lists.css`、`public/css/header.css` 都已突破上限，改动时只许拆不许继续涨。`qrcodegen.js` 是 vendored 生成物，豁免。
- **禁止堆砌**：新增功能、新弹窗、新工具函数必须新建独立的子模块文件，严禁直接在现有文件末尾无脑追加。
- **入口极简**：`index.js`（后端入口）与 `public/js/app.js`（手机页面入口）仅做依赖装配与生命周期初始化，禁止塞入具体业务逻辑；`client.js`（宿主 GUI 注入的客户端 bundle）同理，新 UI 不要继续往里堆。

## 2. 目录职责划分（新代码该放哪）
- **目录树是唯一事实源**：动手前先 `ls` 对应目录，本节只写最容易放错的地方。
- **前端骨架 (`public/app.html`)**：必须保持为极简骨架，**绝对禁止在 HTML 中写内联 `<style>` 或内联脚本**。
- **新样式** → `public/css/` 下新建子模块，并在 `public/css/app.css` 里 `@import` 引入。
- **新弹窗 / 抽屉** → `public/js/ui/sheets/` 下新建子模块，再从聚合入口 `public/js/ui/sheets.js` 导出。
- **新视图** → `public/js/ui/views/` 下新建子模块，并在总调度器 `public/js/ui/views/render.js` 里注册。
- **前端其余归位**：网络 RPC 与 SSE → `public/js/net/`；状态与路由 → `public/js/state/`；聊天交互 → `public/js/chat/`；纯工具函数 → `public/js/utils/`。
- **后端服务** → `lib/` 按职责拆文件（鉴权 `auth.js`、路由 `routes.js`、RPC 代理 `rpc.js`、附件 `upload.js`、目录遍历 `fs-browser.js`），新逻辑禁止塞进 `index.js`。

## 3. 原生 ESM 与依赖规范
- **适用范围是 `public/` 下的一切**：本项目前端为 **Zero-Build 原生 ESM**（零编译构建），所有 `import` 必须带显式 `.js` 扩展名（如 `import { el } from '../utils/dom.js'`）。
- 新增函数必须显式 `export`，并在调用方精确 `import`，严禁隐式全局变量。
- **例外：`client.js` 不是 ESM**。它是宿主 GUI 注入的 classic script（`window.__ModuleLoader__.load` + `require('react')`），不要给它套用上面的 import 规则。

## 4. 修改后必须自检
- 任何 JS 改动后，必须运行 `find . -name "*.js" -not -path "*/.*" -not -path "*/node_modules/*" -exec node --check {} +` 确保零语法报错。注意：`node --check` 只验语法，不解析 `import`，不代表模块能加载。
- **手机 UI 改动要用 browser-skill 在浏览器里真验**：动了 `public/` 下的 html/css/js，或改了会让前端渲染变化的 RPC 返回 → 用 browser-skill 以**竖屏视口**打开 `http://127.0.0.1:<端口>/mp/`（loopback 免配对，就是手机页面本身）走一遍。只有 `node --check` 通过或 curl 200 不算完成。
- **`client.js` 改动验的不是 `/mp/`**，而是宿主 GUI 本身：在浏览器里确认侧栏图标与配对面板渲染正常、点击有反应。它属于宿主 bundle，可能刷新页面或重启宿主才生效。
<!-- /dsh-mobile-plus-architecture -->

# 运行宿主

本插件跟的是 DSH 宿主（跑 `dsh web` 的那台机器），不是当前对话所在的 Mac。

一等公民：macOS 桌面、Windows 桌面、Linux（含无 GUI 的云主机）。

改代码时：

- 不要把当前会话的 `/Users/...`、`~/Documents`、`127.0.0.1:3080`、`open` / `pbcopy` / `osascript` 写进产品逻辑
- `process.platform` 只分 `win32` 与 POSIX；没有 Darwin API 就不要写 `darwin` 分支
- 路径走 `node:path` / 已有的 `fullyQualifiedPath`；Linux 大小写敏感
- setup / `pair/issue` 的 loopback-only 是安全边界，不是「产品只跑在个人 PC」。云主机上常见做法是 SSH 把端口打回 loopback 再开配对页
- `publicBaseUrl` 是配置，默认中转不是唯一部署；云主机上的 DSH 自己就是宿主
- 目录列举是「宿主原生选择器优先、自己 `readdir` 兜底」：`lib/rpc.js` 先试 `api.host.listDirectory`，只有宿主返回 `directory-picker-unavailable` 才落到 `lib/fs-browser.js` 的 `listHostDirectory`。原生选择器只存在于本机 Mac/Windows loopback，Linux / 云上必须保证兜底路径可用
- 动配对、绑定、二维码、cookie、`trustedHost` 时，同时想三条拓扑：本机 loopback、局域网、公网/云主机

给人看的安装说明在 `README.md`。不要把某台云的 IP、SSH 或盘符写进本文件。
