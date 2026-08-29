# dsh-mobile-plus

独立的 DSH 手机远程插件：文字 + 文件。**不修改** `@linxin666/dsh-web-all` / `dsh-remote-web-ui`。宿主：macOS / Windows / Linux（含云主机）。

- **桌面侧栏底部「设置」同一行右侧**只放一枚 **手机远程 logo**（`currentColor` 描边：手机 + 遥控信号，跟宿主侧栏图标同一套语言；不显示中文、不用彩色方块；收起侧栏时仍单独成图标），点击弹出配对面板——面板 UI **1:1 移植 `@linxin666/dsh-web-all` 的「远程访问」面板**（`dsh-remote-web-ui` 的 `RemotePanel.tsx` + `remote.module.css`：设备配对卡片 + 公网/状态徽章、二维码有效至、手机/电脑配对链接、一次性令牌提示、公网/局域网二维码切换、停止/刷新二维码、已授权设备列表含取消配对），配对走自己的 `/mp/pair/*` 路由
- **手机页 `/mp/`** 的 UI 是**老插件手机端的 1:1 移植**：同样式（mobileCss 整份拷贝）、同样的「工作区 → 会话 → 聊天」流程、同款 markdown 渲染、深色模式切换、目录浏览器新建工作区——**唯一区别是聊天输入框多了回形针附件按钮**（相册 / 文件，上传到主机工作区后只把路径发给 Agent）
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
4. 进入「工作区」，选一个工作区，再选会话（或 `+ 新建会话`）。若电脑装着 `dsh-today`，工作区页眉右侧会多一颗日历 logo，点一下打开当天的 `days/YYYY-MM-DD`。还没从主屏幕打开时，页眉另有一颗分享图标：点开才显示「Safari 分享 → 添加到主屏幕」的步骤（HTTPS 才能当独立 App；Android Chrome 若支持安装提示会直接给安装按钮）。当前工作区/会话会写进地址栏（`#/ws/…/s/…`）并记住上次位置：刷新浏览器或从主屏幕重新打开 PWA，会回到刚才的会话，而不是工作区列表；会话或工作区已经不在了，则退到还能打开的那一层
5. 聊天页右上角 **设置**：模型（选模型 + 思考强度）、显示（工具调用 / 系统消息）、上下文占用、**账户额度**。额度芯片也出现在工作区/会话列表和输入框上方：DeepSeek 余额 + Grok 剩余额度，由主机代理本机 `dsh-deepseek-balance` / `dsh-grok-oauth`（密钥不进手机）；点开可看拆分与重置时间，一轮对话结束后自动刷新
6. 聊天输入框：输入文字 + 点回形针选「相册」或「文件」（单文件 20MB，一次最多 5 个）；**手机键盘换行键插入换行，点「发送」才提交**（电脑端仍是 Enter 发送、Shift+Enter 换行）；点发送后会话里立刻出现自己的气泡（发送中 / 已发送），不用等电脑把消息回写过来；图片可点缩略图全屏预览，其它文件显示文件名卡片，点 × 可移除；输出中可以展开「深度思考」「工具调用」
7. 会话列表状态点与 Web 侧栏对齐（进行中蓝 / 等待琥珀 / 未读完成绿），并订阅与 PC 相同的 `events.host`（`host/session-status`）：电脑上开始/结束一轮，手机列表蓝点和聊天「正在输出」会跟着变；手机后台回来或 SSE 被中转缓冲时，会立刻重连并每 4s 用 `session.list` 对账，避免转圈卡死。任务规划默认收起成一行摘要，点标题栏展开/收起（完成勾、进行中转圈、待处理虚线圆）。规划条与 Web 同一生命周期：下一轮 `turn/start` 会清空上一轮清单，新的 `todo_write` 才显示新规划；直播更新时聊天页不再弹回顶部
8. 手机发来的文件经 `/mp/api/mobile.upload` 写入工作区 `.dsh-mobile-inbox/`（保留原文件名；HEIC 在 macOS 上转成 jpeg），会话消息只带主机回传的真实路径，不指定 Agent 用哪个工具

## 文件

- `index.js` — 主机端：`/mp` 路由（`pair/issue|accept|status|stop|revoke`）、`/mp/api/events.mux` + `/mp/api/events.host` SSE、`/mp/api/mobile.upload` 二进制上传、配对 token、设备落盘（含在线判定）、QR SVG（内嵌 Nayuki qrcodegen，MIT）、`quota.read`（loopback 代理 DeepSeek / Grok 额度）。新建工作区的目录列举在宿主挂了 native OS 选择器（本机 loopback Mac/Windows 的默认组合）时由插件自己 `readdir`，不依赖 `host.listDirectory` 的 browse 能力
- `client.js` — 浏览器端 bundle：侧栏「设置」行右侧的仅图标触发按钮 + 配对面板（`sidebar.footer.action` 槽位；面板为 dsh-web-all 远程访问面板的移植）
- `public/app.html` + `public/app.js` — 手机页：老插件 `mobile-styles.ts` 样式原样拷贝 + **`messages.ts`（EventFolder 增量折叠 + seq 水位线 + 幂等替换）与 `mux.ts`（SSE 停滞检测 + 自适应轮询回落 + 按会话水位线去重）的 1:1 移植** + 附件功能（回形针 → 相册/文件，二进制上传，提示词只带路径）
- `public/setup.html` — 桌面配对页（含二维码）
- `public/logo.svg`、`qrcodegen.js` — 品牌 logo 与 QR 编码器

## 性能行为（与老插件一致 + 附件走独立上传）

- 聊天打开只拉一次 30 条尾部历史；此后每条 live 帧由 EventFolder **增量折叠**，不再整段重拉
- SSE 静默超过 ~12s（或报错）时 MuxClient 自动切到普通 HTTP 轮询（3s 起步，空轮询退避到 60s，按会话 seq 水位线去重），不丢帧也不重复
- 会话进行中状态走 `/mp/api/events.host`（与 Web 侧栏同一条 `host/session-status`）；另有 4s `session.list` 对账 + 回到前台时重连 SSE，避免手机中转把结束帧吃掉后蓝点一直转
- **附件不进 session.prompt 字节**：文件经独立二进制通道落到 `.dsh-mobile-inbox/`，prompt 只追加路径；界面预览用本地 object URL，不作为模型输入。历史里仍可能出现旧版图片缩略图，读取时会继续瘦身
