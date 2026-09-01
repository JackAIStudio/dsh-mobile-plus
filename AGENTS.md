<!-- dsh-mobile-plus-architecture -->
# 代码架构与模块化规范（Agent 必读）

本项目已完成原生 ESM 零构建（Zero-Build）模块化重构。为保持 Agent 高效推理、极速编辑与代码可维护性，所有 Agent 改动必须严格遵守以下规则：

## 1. 零单文件膨胀原则（Strict File Size Limits）
- **单文件上限**：任何单个 `.js` 或 `.css` 文件严禁超过 **300 行**。
- **禁止堆砌**：新增功能、新弹窗、新工具函数必须新建独立的子模块文件，严禁直接在现有文件末尾无脑追加。
- **入口极简**：`index.js`（后端入口，< 50 行）和 `public/js/app.js`（前端入口，< 150 行）仅做依赖装配与生命周期初始化，禁止塞入具体业务逻辑。

## 2. 目录职责划分（严格按模块归位）
- **前端骨架 (`public/app.html`)**：
  - 必须保持为极简骨架（< 50 行），**绝对禁止在 HTML 中写内联 `<style>` 或内联脚本**。
- **前端样式 (`public/css/`)**：
  - 新增样式必须放入对应的 CSS 子模块（如 `chat.css`、`composer.css`、`sheets.css` 等），或新建模块并在 `public/css/app.css` 中 `@import` 引入。
- **前端逻辑 (`public/js/`)**：
  - `state/`：全局状态（`state.js`）、路由解析与页面跳转（`route.js`）。
  - `net/`：`/mp/api` RPC（`rpc.js`）、SSE 长连接 Mux（`mux.js`）、DeepSeek/Grok 额度（`quota.js`）、待处理与状态灯（`pending.js`）。
  - `chat/`：输入框 Composer（`composer.js`）、消息折叠 Fold（`fold.js`）、出件箱 Outbox（`outbox.js`）、附件上传 Upload（`upload.js`）、审批流 Approvals（`approvals.js`）、Slash 菜单（`slash.js`）。
  - `ui/`：Markdown 解析器（`markdown.js`）、Todo 任务规划面板（`todo.js`）、图片手势缩放 Lightbox（`lightbox.js`）、抽屉弹窗 Sheets（`sheets.js`）、各主页面视图（`ui/views/`）。
  - `utils/`：纯工具函数（`dom.js`、`time.js`、`storage.js`、`scroll.js`、`notify.js`）。
- **后端服务 (`lib/`)**：
  - 鉴权与设备管理放 `lib/auth.js`，通用路由注册放 `lib/routes.js`，宿主 RPC 代理与历史裁剪放 `lib/rpc.js`，附件存储放 `lib/upload.js`，目录安全遍历放 `lib/fs-browser.js`。

## 3. 原生 ESM 与依赖规范
- 本项目为 **Zero-Build 原生 ESM**（零编译构建）。所有前端 `import` 必须带显式 `.js` 扩展名（如 `import { el } from '../utils/dom.js'`）。
- 新增函数必须显式 `export`，并在调用方精确 `import`，严禁隐式全局变量。

## 4. 修改后必须自检
- 任何 JS 改动后，必须运行 `find . -name "*.js" -not -path "*/.*" -not -path "*/node_modules/*" -exec node --check {} +` 进行语法与导入验证，确保零语法报错。
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
- 目录列举已经自己 `readdir`：native 选择器只出现在本机 Mac/Windows loopback，Linux/云上不要假设有它，也不要退回 `host.listDirectory`
- 动配对、绑定、二维码、cookie、`trustedHost` 时，同时想三条拓扑：本机 loopback、局域网、公网/云主机

给人看的安装说明在 `README.md`。不要把某台云的 IP、SSH 或盘符写进本文件。
