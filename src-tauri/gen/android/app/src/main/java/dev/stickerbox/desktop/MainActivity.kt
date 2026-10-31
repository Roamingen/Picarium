package dev.stickerbox.desktop

import android.content.Intent
import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding

class MainActivity : TauriActivity() {
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
