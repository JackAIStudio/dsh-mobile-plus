# dsh-mobile-plus 安卓壳

只做一件事：给 `/mp/` 页面套一个实现了 WebView 两个必需钩子的宿主。

页面本身**不从 APK 里加载**，还是从你那台 DSH 宿主现取。所以改 `public/` 下的代码，
在手机上刷新一下页面就生效 —— 跟用浏览器时一样快，不用重装 APK。

## 为什么需要它

小米浏览器把网页「添加到桌面」后，打开的是 `com.android.browser/.webapps.pwa.PWAActivity`。
那个窗口没实现 WebView 的 `onShowFileChooser` 和 `onPermissionRequest`，于是：

- 回形针点了没任何反应（连页面上可见的原生 `<input type="file">` 都点不开）；
- `getUserMedia` 直接 `NotAllowedError`，拍照不可用。

同一份页面在普通标签页里两个功能都正常。这是外壳的缺陷，页面代码补不了。
Chrome / Edge 的 PWA 没有这个问题。

## 构建

需要 JDK 17+ 和 Android SDK（`compileSdk 36`）。

```sh
cd android
./gradlew :app:assembleDebug
```

APK 落在 `app/build/outputs/apk/debug/app-debug.apk`。

默认地址是 `https://dev.mac.followjack.cn/mp/`。换一个：

```sh
./gradlew :app:assembleDebug -PdshUrl=https://dsh.example.com/mp/
```

也可以装完之后再改，不用重新编译：

```sh
adb shell am start -n com.jackai.dshmobile/.MainActivity -e url https://your-host/mp/
```

地址记在 `SharedPreferences` 里，下次启动沿用。

**下拉不是刷新**：聊天里往下拖是翻阅更早的消息，到顶再拖会自动加载上一页。
壳里不再有 `SwipeRefreshLayout`（它只看 WebView 自己能不能滚，而这一页的滚动在
`.chat-scroll` 里，于是任何位置下拉都会被判成刷新）。要刷新前端走 **设置 → 刷新前端页面**；
debug 包另外开了 WebView 调试，可以在 `chrome://inspect` 里对页面执行
`location.reload()`，改 `public/` 时的热重载照样很快。

## 装到手机

```sh
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

小米 / Redmi 上 `adb install` 可能被拦成 `INSTALL_FAILED_USER_RESTRICTED`：

1. 设置 → 更多设置 → 开发者选项 → 打开 **USB 安装**；
2. 安装时会弹「USB 安装提示」，点 **继续安装**。

## 这台机器上的两处本地配置（都不进仓库）

- `local.properties` —— `sdk.dir`，由 Android Studio / 命令行生成。
- `proxy.properties` —— 只在本机需要代理拉 Maven 时才有。`settings.gradle.kts`
  检测到它就把里面的 `systemProp.*` 塞进系统属性；没有就跳过。别的机器不用建。

两者都在 `.gitignore` 里。

## 代码在哪

`app/src/main/java/com/jackai/dshmobile/MainActivity.kt`，一个文件。要点：

- `onShowFileChooser` 不直接开选择器，而是先弹一个三选一：**拍照 / 相册 / 文件**。
  手机上的回形针就该这样，直接跳到文件管理器会少掉前两条路。页面只接受图片时
  （`accept="image/*"`）才给拍照和相册，否则直接给文件。
- **拍照**走 `ACTION_IMAGE_CAPTURE` + `FileProvider`，照片写进
  `cacheDir/captures/`，再把那个 `content://` uri 交给页面。
- **相册**走 `ACTION_PICK_IMAGES`，落到系统的照片选择器（小米上是「安全访问」
  那个），不需要存储权限；旧机型自动退回文档选择器且只筛图片。
- **文件**走 `ACTION_OPEN_DOCUMENT`，自己拼 `Intent`，**不要**直接用
  `FileChooserParams.createIntent()`：Android 13+ 会路由到系统照片选择器，它回
  `RESULT_OK` 但 `parseResult` 解出 0 个 URI，表现为「选完什么都没发生」。
- 面板被划掉也要调 `onReceiveValue(null)`，否则页面那边一直挂着等回调。
- `onPermissionRequest` 把页面请求映射成运行时相机/麦克风权限，授予后再
  `request.grant(...)`；否则 WebView 侧一直是 `NotAllowedError`。
- 非本站链接交给系统浏览器，避免困在没有地址栏的 WebView 里。
- `ACTION_PICK_IMAGES` / 相机是否可用靠 `packageManager.queryIntentActivities`
  探测，所以清单里带了 `<queries>`；Android 11+ 不声明就查不到。
