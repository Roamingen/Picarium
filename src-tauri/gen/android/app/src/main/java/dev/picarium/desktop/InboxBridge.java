package dev.picarium.desktop;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * 别的 App「分享到 StickerBox」：把 intent 里的图片拷进 cache/inbox/，
 * Rust 侧启动时调用 takePaths() 取走（取走后清空，避免重复导入）。
 */
public class InboxBridge {
    private static final List<String> pending = new ArrayList<>();

    public static synchronized void capture(Context context, Intent intent) {
        android.util.Log.i("StickerBoxInbox", "capture intent=" + intent);
        if (intent == null) return;
        String action = intent.getAction();
        android.util.Log.i("StickerBoxInbox", "action=" + action);
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return;

        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri one = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (one != null) uris.add(one);
        } else {
            ArrayList<Uri> many = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (many != null) uris.addAll(many);
        }
        // 也兼容 ClipData 形式
        ClipData clip = intent.getClipData();
        if (uris.isEmpty() && clip != null) {
            for (int i = 0; i < clip.getItemCount(); i++) uris.add(clip.getItemAt(i).getUri());
        }
        if (uris.isEmpty()) return;

        File dir = new File(context.getCacheDir(), "inbox");
        if (!dir.exists() && !dir.mkdirs()) return;
        for (Uri uri : uris) {
            try {
                File dst = MediaCopy.copy(context, uri, dir, "in-" + System.currentTimeMillis() + "-" + pending.size());
                synchronized (InboxBridge.class) {
                    pending.add(dst.getAbsolutePath());
                }
            } catch (Exception e) {
                android.util.Log.w("StickerBoxInbox", "read " + uri + " failed", e);
            }
        }
    }

    /** Rust 取走待处理的图片路径，并清空列表。 */
    public static synchronized String[] takePaths() {
        String[] out = pending.toArray(new String[0]);
        pending.clear();
        return out;
    }

    public static synchronized int count() {
        return pending.size();
    }

}
