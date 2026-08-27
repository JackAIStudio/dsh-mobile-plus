# dsh-mobile-plus

独立的 DSH 手机远程插件：文字 + 图片。**不修改** `@linxin666/dsh-web-all` / `dsh-remote-web-ui`。

- **桌面左下角**只放一枚 **手机远程 logo**（`currentColor` 描边：手机 + 遥控信号，跟宿主侧栏图标同一套语言；不显示中文、不用彩色方块），点击弹出配对面板——面板 UI **1:1 移植 `@linxin666/dsh-web-all` 的「远程访问」面板**（`dsh-remote-web-ui` 的 `RemotePanel.tsx` + `remote.module.css`：设备配对卡片 + 公网/状态徽章、二维码有效至、手机/电脑配对链接、一次性令牌提示、公网/局域网二维码切换、停止/刷新二维码、已授权设备列表含取消配对），配对走自己的 `/mp/pair/*` 路由
- **手机页 `/mp/`** 的 UI 是**老插件手机端的 1:1 移植**：同样式（mobileCss 整份拷贝）、同样的「工作区 → 会话 → 聊天」流程、同款 markdown 渲染、深色模式切换、目录浏览器新建工作区——**唯一区别是聊天输入框多了「图片」按钮**（相册/拍照，压缩后随文字一起发送）
- 本机配对页：http://127.0.0.1:3080/mp/setup
- 原来的 `/m/` 仍由旧插件提供，两边可并存对比

## 安装

```sh
# 开发机
dsh plugin --profile web add link:$HOME/Documents/dshspace/plugins/dsh-mobile-plus

# 新电脑
dsh plugin --profile web add github:JackAIStudio/dsh-mobile-plus
```

然后重启 `dsh web`（客户端组件要进 `__DSH_BOOT__` 图，必须重启）。

## 使用

1. 桌面左下角点手机远程 logo（或在电脑浏览器打开 http://127.0.0.1:3080/mp/setup）
2. 面板自动生成二维码 + 手机/电脑配对链接（「刷新二维码」可重发；「选择二维码指向的网络」可切公网/局域网）
3. 手机扫码或复制链接打开（可走杭州中转 `http://your-relay-host/mp/...`）
4. 进入「工作区」，选一个工作区，再选会话（或 `+ 新建会话`）
5. 聊天输入框上方 chips：**「模型」**（选模型 + 思考强度，老插件 ModelSheet 移植：分组目录、跟随模型默认/各级 effort，`session.selectModel` 提交）、「显示」（工具调用 / 系统消息开关）
6. 聊天输入框：输入文字 + 点「图片」选相册或拍照，发送；输出中可以展开「深度思考」「工具调用」
7. 手机发来的图片会写入工作区的 `.dsh-mobile-inbox/`，最新一张为 `latest.jpg`，会话消息里带绝对路径以便模型 `read_image`

## 文件

- `index.js` — 主机端：`/mp` 路由（`pair/issue|accept|status|stop|revoke`）、配对 token、设备落盘（含在线判定）、图片落地、QR SVG（内嵌 Nayuki qrcodegen，MIT）
- `client.js` — 浏览器端 bundle：左下角仅图标触发按钮 + 配对面板（`sidebar.footer.action` 槽位；面板为 dsh-web-all 远程访问面板的移植）
- `public/app.html` + `public/app.js` — 手机页：老插件 `mobile-styles.ts` 样式原样拷贝 + **`messages.ts`（EventFolder 增量折叠 + seq 水位线 + 幂等替换）与 `mux.ts`（SSE 停滞检测 + 自适应轮询回落 + 按会话水位线去重）的 1:1 移植** + 图片功能（唯一扩展：用户消息携带 data-URI 缩略图）
- `public/setup.html` — 桌面配对页（含二维码）
- `public/logo.svg`、`qrcodegen.js` — 品牌 logo 与 QR 编码器

## 性能行为（与老插件一致 + 图片瘦身）

- 聊天打开只拉一次 30 条尾部历史；此后每条 live 帧由 EventFolder **增量折叠**，不再整段重拉
- SSE 静默超过 ~12s（或报错）时 MuxClient 自动切到普通 HTTP 轮询（3s 起步，空轮询退避到 60s，按会话 seq 水位线去重），不丢帧也不重复
- **图片双版本**：手机发图时同时生成完整原图（≤1600px JPEG，写入工作区 `.dsh-mobile-inbox/`，模型按路径 `read_image` 识别——精度不变）与 320px 缩略图（进会话内容/历史传输，每张 ~25KB vs 之前 ~530KB），会话历史加载大幅变快；内容中会注明「缩略图，以 read_image 原图为准」
