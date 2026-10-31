package dev.stickerbox.desktop

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
    // targetSdk 35+ 强制 edge-to-edge：WebView 会画到状态栏/导航栏底下，
    // 这里把系统栏高度补成 padding，页面就不用自己猜安全区。
    val root = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      v.updatePadding(top = bars.top, bottom = bars.bottom)
      insets
    }
    ViewCompat.requestApplyInsets(root)
  }
}
