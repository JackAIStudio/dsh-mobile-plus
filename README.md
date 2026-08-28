# dsh-mobile-plus

独立的 DSH 手机远程插件：文字 + 图片。**不修改** `@linxin666/dsh-web-all` / `dsh-remote-web-ui`。

- **桌面侧栏底部「设置」同一行右侧**只放一枚 **手机远程 logo**（`currentColor` 描边：手机 + 遥控信号，跟宿主侧栏图标同一套语言；不显示中文、不用彩色方块；收起侧栏时仍单独成图标），点击弹出配对面板——面板 UI **1:1 移植 `@linxin666/dsh-web-all` 的「远程访问」面板**（`dsh-remote-web-ui` 的 `RemotePanel.tsx` + `remote.module.css`：设备配对卡片 + 公网/状态徽章、二维码有效至、手机/电脑配对链接、一次性令牌提示、公网/局域网二维码切换、停止/刷新二维码、已授权设备列表含取消配对），配对走自己的 `/mp/pair/*` 路由
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

客户端组件要进 `__DSH_BOOT__` 图，必须重启 `dsh web` 才生效。**不要自己重启正在跑的进程**（会中断其他会话）；告诉用户。

## 使用

1. 桌面侧栏底部「设置」右侧点手机远程 logo（或在电脑浏览器打开 http://127.0.0.1:3080/mp/setup）
2. 面板自动生成二维码 + 手机/电脑配对链接（「刷新二维码」可重发；「选择二维码指向的网络」可切公网/局域网）
3. 手机扫码或复制链接打开（可走杭州中转 `http://your-relay-host/mp/...`）
4. 进入「工作区」，选一个工作区，再选会话（或 `+ 新建会话`）。当前工作区/会话会写进地址栏（`#/ws/…/s/…`）并记住上次位置：刷新浏览器或从主屏幕重新打开 PWA，会回到刚才的会话，而不是工作区列表；会话或工作区已经不在了，则退到还能打开的那一层
5. 聊天页右上角 **设置**：模型（选模型 + 思考强度）、显示（工具调用 / 系统消息）、上下文占用、**账户额度**。额度芯片也出现在工作区/会话列表和输入框上方：DeepSeek 余额 + Grok 剩余额度，由主机代理本机 `dsh-deepseek-balance` / `dsh-grok-oauth`（密钥不进手机）；点开可看拆分与重置时间，一轮对话结束后自动刷新
6. 聊天输入框：输入文字 + 点「图片」选相册或拍照；**手机键盘换行键插入换行，点「发送」才提交**（电脑端仍是 Enter 发送、Shift+Enter 换行）；点发送后会话里立刻出现自己的气泡（发送中 / 已发送），不用等电脑把消息回写过来；点缩略图可全屏放大预览（即将发送的图用 1600px 原图，双击/捏合缩放，点一下关闭），点 × 可移除后再发送；输出中可以展开「深度思考」「工具调用」
7. 会话列表状态点与 Web 侧栏对齐（进行中蓝 / 等待琥珀 / 未读完成绿），并订阅与 PC 相同的 `events.host`（`host/session-status`）：电脑上开始/结束一轮，手机列表蓝点和聊天「正在输出」会跟着变；手机后台回来或 SSE 被中转缓冲时，会立刻重连并每 4s 用 `session.list` 对账，避免转圈卡死。任务规划默认收起成一行摘要，点标题栏展开/收起（完成勾、进行中转圈、待处理虚线圆）。规划条与 Web 同一生命周期：下一轮 `turn/start` 会清空上一轮清单，新的 `todo_write` 才显示新规划；直播更新时聊天页不再弹回顶部
8. 手机发来的图片会写入工作区的 `.dsh-mobile-inbox/`，最新一张为 `latest.jpg`，会话消息里带绝对路径以便模型 `read_image`

## 文件

- `index.js` — 主机端：`/mp` 路由（`pair/issue|accept|status|stop|revoke`）、`/mp/api/events.mux` + `/mp/api/events.host` SSE、配对 token、设备落盘（含在线判定）、图片落地、QR SVG（内嵌 Nayuki qrcodegen，MIT）、`quota.read`（loopback 代理 DeepSeek / Grok 额度）
- `client.js` — 浏览器端 bundle：侧栏「设置」行右侧的仅图标触发按钮 + 配对面板（`sidebar.footer.action` 槽位；面板为 dsh-web-all 远程访问面板的移植）
- `public/app.html` + `public/app.js` — 手机页：老插件 `mobile-styles.ts` 样式原样拷贝 + **`messages.ts`（EventFolder 增量折叠 + seq 水位线 + 幂等替换）与 `mux.ts`（SSE 停滞检测 + 自适应轮询回落 + 按会话水位线去重）的 1:1 移植** + 图片功能（唯一扩展：用户消息携带 data-URI 缩略图，待发/已发图可点进全屏预览）
- `public/setup.html` — 桌面配对页（含二维码）
- `public/logo.svg`、`qrcodegen.js` — 品牌 logo 与 QR 编码器

## 性能行为（与老插件一致 + 图片瘦身）

- 聊天打开只拉一次 30 条尾部历史；此后每条 live 帧由 EventFolder **增量折叠**，不再整段重拉
- SSE 静默超过 ~12s（或报错）时 MuxClient 自动切到普通 HTTP 轮询（3s 起步，空轮询退避到 60s，按会话 seq 水位线去重），不丢帧也不重复
- 会话进行中状态走 `/mp/api/events.host`（与 Web 侧栏同一条 `host/session-status`）；另有 4s `session.list` 对账 + 回到前台时重连 SSE，避免手机中转把结束帧吃掉后蓝点一直转
- **图片双版本**：手机发图时同时生成完整原图（≤1600px JPEG，写入工作区 `.dsh-mobile-inbox/`，模型按路径 `read_image` 识别——精度不变）与 320px 缩略图（只给界面预览 / 历史传输，每张 ~25KB vs 之前 ~530KB），会话历史加载大幅变快；注入说明会要求 Agent 读原图、忽略缩略图，工具失败或纯文本模型须如实说明、不得编造
