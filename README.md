# dsh-mobile-plus

独立的 DSH 手机远程插件：在手机上连正在跑 `dsh web` 的那台宿主，发文字和文件。

宿主可以是 macOS / Windows / Linux 桌面，也可以是无 GUI 的云主机。不修改 `@linxin666/dsh-web-all`。

## 安装

```sh
dsh plugin --profile web add github:JackAIStudio/dsh-mobile-plus
```

装完后**重启 `dsh web`**，侧栏底部「设置」右侧才会出现手机远程图标。不要去杀正在跑的宿主进程；告诉正在用它的人，让他们自己重启。

## 配对

配对页只允许 **本机 loopback** 打开（`pair/issue` 同样）。这是安全边界，不是「只能在个人电脑上用」。

1. 桌面：点侧栏手机远程图标，或在这台宿主的浏览器打开 `http://127.0.0.1:<dsh端口>/mp/setup`。
2. 云主机：先 SSH 把 `dsh web` 端口打回你笔记本的 `127.0.0.1`，再打开上面的配对页。
3. 扫码或打开链接。一次性令牌（二维码 / 配对链接）**2 小时内有效**；任一端配对成功后另一条链接立刻失效。
4. 配对成功后，设备 cookie `mp_device` 有效期 **1 年**（每次打开 `/mp/` 会续期）。设备在服务端 **7 天无访问** 才会被忘掉。
5. 进入工作区 → 会话 → 聊天。回形针可传相册或文件（单文件 20MB，一次最多 5 个），文件落到该工作区的 `.dsh-mobile-inbox/`，会话里只带宿主上的真实路径。

未配置公网地址时，二维码只指向本机 `127.0.0.1`。手机要从公网连上，必须自己配 `publicBaseUrl`。

## 公网地址

插件**不内置任何中转**。把你自己的域名、反代或云主机地址写进宿主配置：

```yaml
- id: dsh-mobile-plus
  config:
    publicBaseUrl: https://dsh.example.com
```

常见两种宿主：

| 宿主 | 配对页怎么开 | `publicBaseUrl` |
|---|---|---|
| 桌面 Mac / Windows | 本机浏览器直接开 loopback | 可选。要给 4G 手机用时，填你自己的反代 / 隧道 |
| 云主机 Linux | SSH 把端口打回 127.0.0.1 再开 | 填这台云自己的 HTTPS 域名。云上的 DSH 就是宿主，不必再套别人的中转 |

改配置或插件代码后需要重启 `dsh web`。

## 安全

配对成功的手机接近这台宿主上的 DSH：列目录、建工作区、读写会话、跑斜杠命令、上传文件、看账户额度。把它当成第二块屏幕，而不是「只能发一句聊天」。

- `setup` / `pair/issue` / `pair/stop` / `pair/revoke` 仅 loopback。
- 设备 cookie 和界面上的设备 id 分开；未配对的公网请求拿不到设备列表。
- 公网请走 HTTPS。不要把未加固的 `dsh web` 端口直接暴露到互联网。
- 额度接口只在宿主 loopback 上读 DeepSeek / Grok 插件，密钥不进手机。

## 许可证

[Apache License 2.0](./LICENSE)。二维码编码来自 [Nayuki qrcodegen](https://www.nayuki.io/page/qr-code-generator-library)（MIT），见 [NOTICE](./NOTICE)。
