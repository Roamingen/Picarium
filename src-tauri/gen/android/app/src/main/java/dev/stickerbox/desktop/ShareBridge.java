package dev.stickerbox.desktop;

import android.content.ContentResolver;
import android.content.Context;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;

/** 系统分享面板 / MediaStore 相册写入，供 Rust 侧通过 JNI 调用。 */
public class ShareBridge {

    public static void shareFiles(Context context, String[] paths, String mime) throws Exception {
        if (paths == null || paths.length == 0) throw new Exception("没有要分享的文件");
        String authority = context.getPackageName() + ".fileprovider";
        // 库根在 /data/data/<pkg>/StickerBox，不在 files/ 下；先拷到 cache/share 再交给 FileProvider。
        File shareDir = new File(context.getCacheDir(), "share");
        if (!shareDir.exists() && !shareDir.mkdirs()) throw new Exception("创建分享缓存目录失败");
        ArrayList<Uri> uris = new ArrayList<>();
        for (String p : paths) {
            File src = new File(p);
            if (!src.isFile()) throw new Exception("文件不存在：" + p);
            File dst = new File(shareDir, src.getName());
            copyFile(src, dst);
            uris.add(FileProvider.getUriForFile(context, authority, dst));
        }
        Intent intent;
        if (uris.size() == 1) {
            intent = new Intent(Intent.ACTION_SEND);
            intent.putExtra(Intent.EXTRA_STREAM, uris.get(0));
        } else {
            intent = new Intent(Intent.ACTION_SEND_MULTIPLE);
            intent.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
        }
        intent.setType(mime);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        Intent chooser = Intent.createChooser(intent, "分享到");
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(chooser);
    }

    private static void copyFile(File src, File dst) throws Exception {
        try (InputStream in = new FileInputStream(src); OutputStream out = new FileOutputStream(dst)) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
    }

    public static void saveToGallery(Context context, String path, String name, String mime) throws Exception {
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, name);
        values.put(MediaStore.Images.Media.MIME_TYPE, mime);
        if (Build.VERSION.SDK_INT >= 29) {
            values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/StickerBox");
            values.put(MediaStore.Images.Media.IS_PENDING, 1);
        }
        ContentResolver resolver = context.getContentResolver();
        Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new Exception("相册写入失败");
        try (OutputStream out = resolver.openOutputStream(uri);
             FileInputStream in = new FileInputStream(path)) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues done = new ContentValues();
            done.put(MediaStore.Images.Media.IS_PENDING, 0);
            resolver.update(uri, done, null, null);
        }
    }
}
