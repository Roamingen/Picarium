package dev.picarium.desktop;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * 选图（两个入口）：
 *
 * 1. 相册选择器（ACTION_PICK_IMAGES，Android 13+）：九宫格相册，上手快；
 *    但系统只给数字 id，拿不到真实文件名（导入名会是「1000000085」这类）。
 * 2. 系统「文件」选择器（ACTION_OPEN_DOCUMENT）：能拿到真实文件名，多选要长按。
 *
 * 调用线程会阻塞到用户选完或取消；选中的 URI 会立刻拷进 cache/import/，
 * 返回真实文件路径给 Rust（库里只认本地文件）。
 */
public class PickerBridge {
    public static final int REQ_PICK = 0x5B01;
    public static final int REQ_PICK_FILES = 0x5B02;
    public static Activity activity;
    private static CountDownLatch latch;
    private static List<Uri> picked;

    /** 相册选择器（Photo Picker，API 33+；更老的系统退回系统文件选择器）。 */
    public static String[] pickImages(Context ctx, int max) throws Exception {
        return pick(ctx, max, false);
    }

    /** 系统「文件」选择器（SAF）：能拿到真实文件名。 */
    public static String[] pickFiles(Context ctx) throws Exception {
        return pick(ctx, 100, true);
    }

    private static String[] pick(Context ctx, int max, boolean fromFiles) throws Exception {
        if (activity == null) throw new Exception("没有拿到 Activity");
        latch = new CountDownLatch(1);
        picked = null;

        final Intent intent;
        if (!fromFiles && Build.VERSION.SDK_INT >= 33) {
            intent = new Intent(MediaStore.ACTION_PICK_IMAGES);
            intent.putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, max);
        } else {
            intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.setType("image/*");
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        }
        final int req = fromFiles || Build.VERSION.SDK_INT < 33 ? REQ_PICK_FILES : REQ_PICK;
        activity.runOnUiThread(() -> activity.startActivityForResult(intent, req));

        if (!latch.await(300, TimeUnit.SECONDS)) throw new Exception("选图超时");
        if (picked == null || picked.isEmpty()) return new String[0];

        File dir = new File(activity.getCacheDir(), "import");
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("创建导入缓存目录失败");
        String[] out = new String[picked.size()];
        for (int i = 0; i < picked.size(); i++) {
            Uri uri = picked.get(i);
            File dst = MediaCopy.copy(activity, uri, dir, "pick-" + System.currentTimeMillis() + "-" + i);
            out[i] = dst.getAbsolutePath();
        }
        return out;
    }

    public static void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (latch == null) return;
        if (requestCode != REQ_PICK && requestCode != REQ_PICK_FILES) return;
        List<Uri> list = new ArrayList<>();
        if (resultCode == Activity.RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                for (int i = 0; i < data.getClipData().getItemCount(); i++) {
                    list.add(data.getClipData().getItemAt(i).getUri());
                }
            } else if (data.getData() != null) {
                list.add(data.getData());
            }
        }
        picked = list;
        latch.countDown();
    }

}
