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
