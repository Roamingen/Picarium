package dev.stickerbox.desktop

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding

class MainActivity : TauriActivity() {
  // 返回键不交给 WebView 的历史（那套只能整页回退），改成问前端：
  // window.__sbBack() 有层（弹层/多选/预览/分组详情）就收一层并返回 true，
  // 没有层返回 false，这时才真的退出 App。
  private var web: WebView? = null
  private var backCallback: OnBackPressedCallback? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    PickerBridge.activity = this
    // 别的 App「分享到 StickerBox」时，先把图片收进 cache/inbox/
    InboxBridge.capture(this, intent)
    // targetSdk 35+ 强制 edge-to-edge：WebView 会画到状态栏/导航栏底下，
    // 这里把系统栏高度补成 padding，页面就不用自己猜安全区。
    val root = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      // 键盘弹出时把 WebView 也顶上去，否则底部弹层的输入框会被键盘盖住。
      // targetSdk 35 下 adjustResize 不再自动生效，只能用 IME inset 自己补。
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      v.updatePadding(top = bars.top, bottom = maxOf(bars.bottom, ime.bottom))
      insets
    }
    ViewCompat.requestApplyInsets(root)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    web = webView
    // 手机端不需要系统滚动条：WebView 会画一条贯穿全屏的细条，且和页面内容无关。
    webView.isVerticalScrollBarEnabled = false
    webView.isHorizontalScrollBarEnabled = false
    webView.scrollBarStyle = WebView.SCROLLBARS_INSIDE_OVERLAY
    if (backCallback != null) return
    val cb = object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val w = web
        if (w == null) return finish()
        w.evaluateJavascript("(window.__sbBack && window.__sbBack()) ? '1' : '0'") { r ->
          // 前端手里没有可收的层，再交回系统：关掉本回调后重新走默认返回。
          if (r != "\"1\"") {
            this.isEnabled = false
            onBackPressedDispatcher.onBackPressed()
            this.isEnabled = true
          }
        }
      }
    }
    backCallback = cb
    onBackPressedDispatcher.addCallback(this, cb)
  }

  override fun onDestroy() {
    backCallback = null
    web = null
    super.onDestroy()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    InboxBridge.capture(this, intent)
  }

  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    PickerBridge.onActivityResult(requestCode, resultCode, data)
  }
}
