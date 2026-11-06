/*
 * Classic-script boot watchdog. It is not part of the ES module graph, so it
 * still runs when a module in that graph fails to load (stale service worker,
 * dropped connection, a bad deploy). Left alone, that failure is an empty
 * #root with no text and no button — the phone app looks dead.
 *
 * Two jobs:
 *  - report a script that never arrived (error event on the module tag);
 *  - after a grace period, say the app did not start and offer a reload.
 * The fallback markup in app.html is already tappable on its own; this only
 * replaces its hint with the actual reason and hides it once the app paints.
 */
(function () {
  var GRACE_MS = 8000
  var fallback = document.getElementById('boot-fallback')
  var hint = document.getElementById('boot-fallback-text')
  var reload = document.querySelector('.mobile-fallback-link:not(.is-primary)')
  if (!fallback || !hint) return

  function show(text) {
    if (!document.getElementById('boot-fallback')) return
    hint.textContent = text
    hint.className = 'mobile-error'
    hint.setAttribute('role', 'alert')
    if (reload) reload.textContent = '重新加载'
  }

  var started = false
  function appPainted() {
    if (document.getElementById('boot-fallback') === null) started = true
    return started
  }

  var timer = setTimeout(function () {
    if (appPainted()) return
    show('应用没有启动。可能是网络中断，或页面资源没有加载完整。')
  }, GRACE_MS)

  window.addEventListener('error', function (event) {
    var target = event.target
    if (!target || target.tagName !== 'SCRIPT') return
    if (target.src && target.src.indexOf('/mp/js/app.js') === -1) return
    clearTimeout(timer)
    show('启动脚本没有加载成功，请检查网络后重新加载。')
  }, true)

  window.addEventListener('unhandledrejection', function () {
    if (appPainted()) return
    show('应用启动时出错，请重新加载。')
  })
})()
