package vn.lamnghiepdateh.gps;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * Lưu ảnh JPEG vào Bộ sưu tập (Pictures/LN DaTeh GPS).
 * Android 10+: dùng MediaStore, không cần quyền; ảnh vẫn còn khi gỡ ứng dụng.
 */
@CapacitorPlugin(name = "Gallery")
public class GalleryPlugin extends Plugin {
    private static final String ALBUM = "LN DaTeh GPS";

    @PluginMethod
    public void saveImage(PluginCall call) {
        String data = call.getString("data");
        String name = call.getString("fileName", "LNDT_" + System.currentTimeMillis());
        if (data == null) { call.reject("Thiếu dữ liệu ảnh"); return; }
        int comma = data.indexOf(',');
        if (comma >= 0) data = data.substring(comma + 1);
        byte[] bytes;
        try { bytes = Base64.decode(data, Base64.DEFAULT); } catch (Exception e) { call.reject("Dữ liệu ảnh lỗi"); return; }
        if (!name.toLowerCase().endsWith(".jpg")) name = name + ".jpg";
        try {
            String saved;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver cr = getContext().getContentResolver();
                ContentValues v = new ContentValues();
                v.put(MediaStore.Images.Media.DISPLAY_NAME, name);
                v.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                v.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/" + ALBUM);
                v.put(MediaStore.Images.Media.DATE_TAKEN, System.currentTimeMillis());
                v.put(MediaStore.Images.Media.IS_PENDING, 1);
                Uri uri = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new Exception("Không tạo được tệp ảnh");
                try (OutputStream os = cr.openOutputStream(uri)) { os.write(bytes); }
                v.clear();
                v.put(MediaStore.Images.Media.IS_PENDING, 0);
                cr.update(uri, v, null, null);
                saved = uri.toString();
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), ALBUM);
                if (!dir.exists()) dir.mkdirs();
                File f = new File(dir, name);
                try (FileOutputStream os = new FileOutputStream(f)) { os.write(bytes); }
                MediaScannerConnection.scanFile(getContext(), new String[]{f.getAbsolutePath()}, new String[]{"image/jpeg"}, null);
                saved = f.getAbsolutePath();
            }
            JSObject r = new JSObject();
            r.put("uri", saved);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Lỗi lưu ảnh: " + e.getMessage());
        }
    }
}
