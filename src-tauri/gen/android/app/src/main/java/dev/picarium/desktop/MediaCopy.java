package dev.picarium.desktop;

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
        // 文件名优先用系统给的原始名字（相册/分享面板都带 DISPLAY_NAME），
        // 拿不到再退回调用方的前缀，避免库里出现 pick-1753... 这种名字
        String base = displayName(ctx, uri);
        if (base == null || base.isEmpty()) base = prefix;
        base = sanitize(base);
        File dst = unique(dir, base, ext);
        if (!tmp.renameTo(dst)) {
            tmp.delete();
            throw new IOException("重命名失败");
        }
        return dst;
    }

    private static String displayName(Context ctx, Uri uri) {
        String name = queryName(ctx, uri);
        // 相册选择器（Photo Picker）有时把 DISPLAY_NAME 填成纯数字 id，
        // 这种名字对用户没意义，换成对应的 MediaStore URI 再查一次真实文件名
        if (isUselessName(name, uri.getLastPathSegment())) {
            try {
                Uri media = android.provider.MediaStore.getMediaUri(ctx, uri);
                if (media != null) {
                    String real = queryName(ctx, media);
                    if (!isUselessName(real, media.getLastPathSegment())) name = real;
                }
            } catch (Exception ignored) {
            }
        }
        return name;
    }

    private static String queryName(Context ctx, Uri uri) {
        try (android.database.Cursor c = ctx.getContentResolver().query(
                uri, new String[]{android.provider.OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                if (i >= 0) return c.getString(i);
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    /** 空名，或者名字就是 URI 末尾那串数字 id，都算没拿到真实文件名。 */
    private static boolean isUselessName(String name, String lastSegment) {
        if (name == null || name.isEmpty()) return true;
        String base = name.replaceAll("\\.[A-Za-z0-9]{1,5}$", "");
        return lastSegment != null && !lastSegment.isEmpty() && base.equals(lastSegment);
    }

    /** 去掉扩展名和文件系统不认的字符，过长截断。 */
    private static String sanitize(String name) {
        String base = name.replaceAll("\\.[A-Za-z0-9]{1,5}$", "");
        base = base.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (base.isEmpty()) base = "image";
        if (base.length() > 60) base = base.substring(0, 60).trim();
        return base;
    }

    /** 同一批里可能有重名（同一张图选两次），加序号避免互相覆盖。 */
    private static File unique(File dir, String base, String ext) {
        File f = new File(dir, base + ext);
        int i = 1;
        while (f.exists()) {
            f = new File(dir, base + " (" + (i++) + ")" + ext);
        }
        return f;
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
