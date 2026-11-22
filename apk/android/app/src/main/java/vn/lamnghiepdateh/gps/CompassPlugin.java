package vn.lamnghiepdateh.gps;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.view.Surface;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * La bàn đọc trực tiếp cảm biến xoay (rotation vector) của điện thoại.
 * Phát sự kiện "heading" (độ, 0 = Bắc từ) khoảng 10 lần/giây.
 * Máy để nằm: hướng của cạnh trên. Máy cầm dựng đứng: hướng của camera sau.
 */
@CapacitorPlugin(name = "Compass")
public class CompassPlugin extends Plugin implements SensorEventListener {
    private SensorManager sm;
    private Sensor sensor;
    private boolean running = false;
    private long lastEmit = 0;
    private final float[] rot = new float[9];
    private final float[] remap = new float[9];
    private final float[] ori = new float[3];
    private int accuracy = 3;

    @Override
    public void load() {
        sm = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        if (sm != null) {
            sensor = sm.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
            if (sensor == null) sensor = sm.getDefaultSensor(Sensor.TYPE_GEOMAGNETIC_ROTATION_VECTOR);
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (sensor == null) { call.reject("Máy không có cảm biến la bàn"); return; }
        if (!running) { sm.registerListener(this, sensor, SensorManager.SENSOR_DELAY_UI); running = true; }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (running) { sm.unregisterListener(this); running = false; }
        call.resolve();
    }

    @Override
    protected void handleOnPause() { if (running) sm.unregisterListener(this); }

    @Override
    protected void handleOnResume() { if (running && sensor != null) sm.registerListener(this, sensor, SensorManager.SENSOR_DELAY_UI); }

    @Override
    public void onSensorChanged(SensorEvent e) {
        long now = System.currentTimeMillis();
        if (now - lastEmit < 100) return;
        lastEmit = now;
        SensorManager.getRotationMatrixFromVector(rot, e.values);
        // Độ nghiêng: rot[8] = cos(góc giữa trục Z máy và phương thẳng đứng)
        boolean upright = Math.abs(rot[8]) < 0.5f;
        int axisX = SensorManager.AXIS_X, axisY = SensorManager.AXIS_Y;
        if (upright) { axisX = SensorManager.AXIS_X; axisY = SensorManager.AXIS_Z; }
        SensorManager.remapCoordinateSystem(rot, axisX, axisY, remap);
        SensorManager.getOrientation(remap, ori);
        double deg = Math.toDegrees(ori[0]);
        // bù theo chiều xoay màn hình
        int r = Surface.ROTATION_0;
        try {
            WindowManager wm = (WindowManager) getContext().getSystemService(Context.WINDOW_SERVICE);
            r = wm.getDefaultDisplay().getRotation();
        } catch (Exception ignored) {}
        if (r == Surface.ROTATION_90) deg += 90; else if (r == Surface.ROTATION_180) deg += 180; else if (r == Surface.ROTATION_270) deg += 270;
        deg = (deg % 360 + 360) % 360;
        JSObject d = new JSObject();
        d.put("heading", deg);
        d.put("accuracy", accuracy);
        d.put("upright", upright);
        notifyListeners("heading", d);
    }

    @Override
    public void onAccuracyChanged(Sensor s, int acc) { accuracy = acc; }
}
