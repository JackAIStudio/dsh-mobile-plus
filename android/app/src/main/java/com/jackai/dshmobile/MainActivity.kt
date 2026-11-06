package com.jackai.dshmobile

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import android.util.Log
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebView.setWebContentsDebuggingEnabled
import android.webkit.WebViewClient
import android.webkit.WebResourceError
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider

/**
 * Native shell for the dsh-mobile-plus page.
 *
 * The page is *not* bundled: it is loaded from the DSH host over HTTP, so every
 * edit under `public/` still takes effect on the next refresh — the same
 * hot-reload loop the PWA had, because nothing here ships the UI.
 *
 * What the shell adds is the part a browser PWA window cannot guarantee on
 * Android. Both hooks below are host responsibilities that Xiaomi's browser
 * skips in its installed-PWA activity
 * (`com.android.browser/.webapps.pwa.PWAActivity`):
 *
 *  - `onShowFileChooser` — without it `<input type="file">` fires its click and
 *    then nothing at all happens.
 *  - `onPermissionRequest` — without it `getUserMedia` rejects immediately with
 *    NotAllowedError, so camera capture is dead too.
 *
 * Where swipe-to-refresh went. The shell used to wrap the WebView in a
 * SwipeRefreshLayout. That widget decides on `canChildScrollUp()`, i.e. "can the
 * WebView itself still scroll up?" — and this page pins `body` and scrolls an
 * inner `.chat-scroll`, so the WebView never scrolls and the layout believed
 * every downward swipe was a refresh, including a reader navigating back
 * through the conversation. Pulling down is now a page gesture: at the top of
 * a chat it loads older messages, and reload lives in Settings → 刷新前端页面.
 * Debug builds get WebView debugging instead (see setupDebugTools).
 */
class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPermissionRequest: PermissionRequest? = null
    private var pendingCameraUri: Uri? = null

    private val fileChooserLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = filePathCallback ?: return@registerForActivityResult
            filePathCallback = null
            val uris = readChooserResult(result.resultCode, result.data)
            Log.d(TAG, "file chooser result=${result.resultCode} uris=${uris?.size ?: 0}")
            callback.onReceiveValue(uris)
        }

    /** The photo picker hands back one uri, or several when multi-select. */
    private val galleryLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = filePathCallback ?: return@registerForActivityResult
            filePathCallback = null
            val uris = readChooserResult(result.resultCode, result.data)
            Log.d(TAG, "gallery result=${result.resultCode} uris=${uris?.size ?: 0}")
            callback.onReceiveValue(uris)
        }

    /** Camera reports success, and the photo is already at pendingCameraUri. */
    private val cameraLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = filePathCallback ?: return@registerForActivityResult
            filePathCallback = null
            val uri = pendingCameraUri
            pendingCameraUri = null
            val took = result.resultCode == Activity.RESULT_OK && uri != null
            Log.d(TAG, "camera result=${result.resultCode} uri=$uri took=$took")
            callback.onReceiveValue(if (took) arrayOf(uri!!) else null)
        }

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
            val request = pendingPermissionRequest ?: return@registerForActivityResult
            pendingPermissionRequest = null
            val allow = granted.values.all { it }
            Log.d(TAG, "page permission request granted=$allow $granted")
            if (allow) request.grant(request.resources) else request.deny()
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(
            webView,
            ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            // The page gates some layout on the shell's UA; keep it honest.
            userAgentString = "$userAgentString DshMobileShell/${BuildConfig.VERSION_NAME}"
        }

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean {
                // Keep the app's own origin inside the shell; hand anything else
                // (OAuth, docs, mail links) to the system so it is not trapped
                // in a WebView with no address bar.
                val target = request.url
                if (target.host == Uri.parse(loadTarget()).host) return false
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, target))
                    true
                } catch (e: Exception) {
                    Log.w(TAG, "cannot hand off $target", e)
                    false
                }
            }

            override fun onPageFinished(view: WebView, url: String?) {
                CookieManager.getInstance().flush()
            }

            // A blank WebView has no address bar and no reload button: the
            // shell must render its own way back when the host is unreachable
            // or a subresource failed. Only the main frame gets the notice;
            // the page handles its own module failures in boot-watch.js.
            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError,
            ) {
                if (!request.isForMainFrame) return
                Log.w(TAG, "main frame failed: ${request.url} ${error.errorCode} ${error.description}")
                showLoadFailure(error.description?.toString().orEmpty())
            }
        }

        // The shell draws no chrome, so the address is changed from outside:
        //     adb shell am start -n com.jackai.dshmobile/.MainActivity \
        //         -e url https://host/mp/
        // Doing it this way keeps the page's own long-press (text selection and
        // paste) intact and needs no cooperation from the frontend.
        intent?.getStringExtra(EXTRA_URL)?.trim()?.takeIf { it.isNotEmpty() }?.let { url ->
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_URL, url).apply()
        }

        webView.webChromeClient = object : WebChromeClient() {
            // ——— the two hooks this shell exists for ———

            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                showAttachSheet(params)
                return true
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                // The page only asks for camera/mic when the user taps capture.
                val wanted = request.resources.filter {
                    it == PermissionRequest.RESOURCE_VIDEO_CAPTURE ||
                        it == PermissionRequest.RESOURCE_AUDIO_CAPTURE
                }
                if (wanted.isEmpty()) {
                    request.deny()
                    return
                }
                pendingPermissionRequest?.deny()
                pendingPermissionRequest = request
                val manifestPerms = wanted.map {
                    if (it == PermissionRequest.RESOURCE_VIDEO_CAPTURE) {
                        android.Manifest.permission.CAMERA
                    } else {
                        android.Manifest.permission.RECORD_AUDIO
                    }
                }.toTypedArray()
                permissionLauncher.launch(manifestPerms)
            }
        }

        setupDebugTools()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        webView.loadUrl(loadTarget())
    }

    /**
     * The attach button on a phone should offer the three sources people expect
     * — camera, photo library, files — the way iOS and the browser do. Going
     * straight to the document picker skips two of them.
     */
    private fun showAttachSheet(params: WebChromeClient.FileChooserParams) {
        val wantsImage = params.acceptTypes.isEmpty() ||
            params.acceptTypes.any { it.startsWith("image/") }
        val labels = buildList {
            if (wantsImage && canHandle(Intent(MediaStore.ACTION_IMAGE_CAPTURE))) {
                add(SOURCE_CAMERA)
            }
            if (wantsImage) add(SOURCE_GALLERY)
            add(SOURCE_FILES)
        }
        AlertDialog.Builder(this)
            .setItems(labels.toTypedArray()) { _, which ->
                when (labels[which]) {
                    SOURCE_CAMERA -> launchCamera()
                    SOURCE_GALLERY -> launchGallery(params)
                    else -> launchFiles(params)
                }
            }
            .setOnCancelListener {
                // Dismissing the sheet is a cancel: WebView must be told, or the
                // page waits on the callback forever.
                filePathCallback?.onReceiveValue(null)
                filePathCallback = null
            }
            .show()
    }

    private fun canHandle(intent: Intent): Boolean =
        packageManager.queryIntentActivities(intent, 0).isNotEmpty()

    /** Camera writes into a uri we own, and that uri is what the page receives. */
    private fun launchCamera() {
        val dir = java.io.File(cacheDir, "captures").apply { mkdirs() }
        val photo = java.io.File(dir, "dsh-${System.currentTimeMillis()}.jpg")
        val uri = FileProvider.getUriForFile(this, "$packageName.files", photo)
        pendingCameraUri = uri
        val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
            putExtra(MediaStore.EXTRA_OUTPUT, uri)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        try {
            cameraLauncher.launch(intent)
        } catch (e: Exception) {
            Log.w(TAG, "camera failed to launch", e)
            pendingCameraUri = null
            filePathCallback?.onReceiveValue(null)
            filePathCallback = null
        }
    }

    /** 相册: the system photo picker, which needs no storage permission. */
    private fun launchGallery(params: WebChromeClient.FileChooserParams) {
        val intent = Intent(MediaStore.ACTION_PICK_IMAGES).apply {
            type = "image/*"
            if (params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
                putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, 10)
            }
        }
        if (!canHandle(intent)) {
            launchFiles(params, "image/*")
            return
        }
        try {
            galleryLauncher.launch(intent)
        } catch (e: Exception) {
            Log.d(TAG, "photo picker unavailable, falling back", e)
            launchFiles(params, "image/*")
        }
    }

    /** 文件: the document picker, honouring whatever the input asked for. */
    private fun launchFiles(params: WebChromeClient.FileChooserParams, forceType: String? = null) {
        try {
            fileChooserLauncher.launch(buildChooserIntent(params, forceType))
        } catch (e: Exception) {
            Log.w(TAG, "file chooser failed to launch", e)
            filePathCallback?.onReceiveValue(null)
            filePathCallback = null
        }
    }

    /**
     * Ask the system document picker directly rather than relying on
     * `FileChooserParams.createIntent()`. On Android 13+ that resolves to the
     * photo picker, whose result shape `parseResult` does not always unpack:
     * it comes back RESULT_OK with zero URIs and the attachment silently
     * vanishes.
     */
    private fun buildChooserIntent(
        params: WebChromeClient.FileChooserParams,
        forceType: String? = null,
    ): Intent {
        val mimeTypes = params.acceptTypes
            ?.filter { it.isNotBlank() && it != "*/*" }
            .orEmpty()
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            putExtra(
                Intent.EXTRA_ALLOW_MULTIPLE,
                params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE,
            )
            when {
                forceType != null -> type = forceType
                mimeTypes.isEmpty() -> type = "*/*"
                mimeTypes.size == 1 -> type = mimeTypes.first()
                else -> {
                    type = "*/*"
                    putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes.toTypedArray())
                }
            }
        }
        return Intent.createChooser(intent, null)
    }

    /** Unpack whatever the picker returned: a single uri, or a multi-select set. */
    private fun readChooserResult(resultCode: Int, data: Intent?): Array<Uri>? {
        if (resultCode != Activity.RESULT_OK || data == null) return null
        data.clipData?.let { clip ->
            if (clip.itemCount > 0) {
                return Array(clip.itemCount) { index -> clip.getItemAt(index).uri }
            }
        }
        return data.data?.let { arrayOf(it) }
    }

    /**
     * Editing `public/` used to mean "pull down and the shell reloads". That
     * gesture now belongs to the conversation, so hot reload moves to
     * `chrome://inspect`: attach to the page and run `location.reload()` from
     * the console. Debug only - a release build exposes nothing.
     */
    private fun setupDebugTools() {
        if (BuildConfig.DEBUG) setWebContentsDebuggingEnabled(true)
    }

    private fun loadTarget(): String {
        val stored = getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_URL, null)
        return stored ?: BuildConfig.DEFAULT_URL
    }

    /** The page could not be fetched at all; offer reload and the offline page. */
    private fun showLoadFailure(detail: String) {
        val message = if (detail.isBlank()) {
            "连不上正在运行的 DSH。请确认电脑端已启动。"
        } else {
            "连不上正在运行的 DSH。\n$detail"
        }
        val html = """
            <!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
            <style>
            body{margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
            gap:12px;padding:32px;box-sizing:border-box;text-align:center;background:#f3f5f9;color:#1c2333;
            font:16px/1.5 -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif}
            p{margin:0;color:#64748b;white-space:pre-wrap}button{min-width:132px;height:40px;padding:0 18px;
            border:0;border-radius:10px;background:#2f6fed;color:#fff;font:inherit;font-weight:600}
            </style></head><body><p>$message</p><button onclick="location.reload()">重新加载</button></body></html>
        """.trimIndent()
        webView.loadDataWithBaseURL(loadTarget(), html, "text/html", "utf-8", null)
    }

    override fun onPause() {
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onDestroy() {
        filePathCallback?.onReceiveValue(null)
        filePathCallback = null
        pendingPermissionRequest?.deny()
        pendingPermissionRequest = null
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "DshShell"
        private const val PREFS = "dsh_shell"
        private const val KEY_URL = "page_url"
        private const val EXTRA_URL = "url"

        // Same three sources the phone UI offers elsewhere: 拍照 / 相册 / 文件.
        private const val SOURCE_CAMERA = "拍照"
        private const val SOURCE_GALLERY = "相册"
        private const val SOURCE_FILES = "文件"
    }
}
