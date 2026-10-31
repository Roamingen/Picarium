package dev.stickerbox.desktop;

import android.content.Context;
import android.net.Uri;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * 把 content:// 图片拷进 App 缓存，并按文件头判断真实扩展名。
 *
 * Android 的相册/分享 URI 往往不带扩展名（content://media/...），
 * 只按 URI 猜会把 PNG 存成 .jpg，库里解码缩略图就会失败。
 */
public class MediaCopy {
    public static File copy(Context ctx, Uri uri, File dir, String prefix) throws IOException {
        File tmp = new File(dir, prefix + ".tmp");
        try (InputStream in = ctx.getContentResolver().openInputStream(uri);
             FileOutputStream out = new FileOutputStream(tmp)) {
            if (in == null) throw new IOException("无法打开图片");
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
        String ext = sniff(tmp);
        File dst = new File(dir, prefix + ext);
        if (!tmp.renameTo(dst)) {
            tmp.delete();
            throw new IOException("重命名失败");
        }
        return dst;
    }

    private static String sniff(File f) {
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] b = new byte[12];
            int n = in.read(b);
            if (n >= 8 && (b[0] & 0xFF) == 0x89 && (b[1] & 0xFF) == 'P'
                    && (b[2] & 0xFF) == 'N' && (b[3] & 0xFF) == 'G') return ".png";
            if (n >= 6 && (b[0] & 0xFF) == 'G' && (b[1] & 0xFF) == 'I' && (b[2] & 0xFF) == 'F') return ".gif";
            if (n >= 12 && (b[0] & 0xFF) == 'R' && (b[1] & 0xFF) == 'I' && (b[2] & 0xFF) == 'F'
                    && (b[3] & 0xFF) == 'F' && (b[8] & 0xFF) == 'W') return ".webp";
            if (n >= 3 && (b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8) return ".jpg";
        } catch (IOException ignored) {
        }
        return ".jpg";
    }
}
