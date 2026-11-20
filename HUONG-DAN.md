# LN DaTeh GPS — Hướng dẫn triển khai và sử dụng

Ứng dụng thu thập dữ liệu không gian ngoài thực địa của Công ty TNHH MTV Lâm nghiệp Đạ Tẻh.
Ứng dụng được làm dưới dạng **PWA (ứng dụng web cài đặt được)**:
- Chạy trên Android và iPhone.
- Cài ra màn hình chính như một ứng dụng thường.
- Dùng được khi **không có mạng** sau lần mở đầu tiên.

## 1. Cấu trúc thư mục

| Tệp | Chức năng |
|---|---|
| `index.html` | Ứng dụng di động |
| `mbtiles-tool.html` | Công cụ biên tập MBTiles chạy trên máy tính |
| `js/crs.js` | Hệ tọa độ VN2000: 63 tỉnh (kinh tuyến trục theo TT 973/2001/TT-TCĐC), múi 3°, UTM 48/49 |
| `js/app.js` | Toàn bộ chức năng của ứng dụng |
| `vendor/` | Thư viện kèm sẵn (Leaflet, proj4, sql.js, SheetJS, QR…), không cần Internet |

## 2. Đưa ứng dụng lên mạng để cài vào điện thoại

Điện thoại chỉ cho phép dùng GPS, camera và chế độ offline khi ứng dụng chạy qua **HTTPS**. Có 3 cách, cách nào cũng miễn phí:

1. **GitHub Pages**: tạo kho mã trên GitHub → tải toàn bộ thư mục lên → Settings → Pages → chọn nhánh `main`. Ứng dụng có địa chỉ dạng `https://<ten>.github.io/ln-dateh-gps/`.
2. **Netlify Drop** (https://app.netlify.com/drop): kéo cả thư mục `ln-dateh-gps` vào trang. Sau vài giây là có đường link.
3. **Máy chủ nội bộ của Công ty**: chép thư mục lên web server có chứng chỉ HTTPS.

**Cài vào điện thoại:**
- Android: mở đường link bằng Chrome → menu ⋮ → **Cài đặt ứng dụng**.
- iPhone: mở bằng Safari → nút Chia sẻ → **Thêm vào MH chính**.

## 3. Chức năng chính

- **Định vị**: tọa độ VN2000 hoặc WGS84, sai số, độ cao, tốc độ. Hình nón trên bản đồ chỉ hướng nhìn thực tế, lấy theo la bàn số.
- **Tạo đối tượng**:
  - Điểm thường, điểm mốc, điểm kiểm tra.
  - Đường và vùng: chạm trên bản đồ, lấy đỉnh tại vị trí GPS, hoặc bật chế độ **🚶 Tự động** để đi quanh lô, máy tự thêm đỉnh.
- **Đo nhanh**: chiều dài, chu vi, diện tích (m² và ha). Diện tích được tính trên mặt phẳng chiếu VN2000 đang chọn.
- **Tracklog**: ghi song song trong lúc vẽ điểm, đường, vùng. Dữ liệu được lưu liên tục nên khi máy tắt đột ngột vẫn ghi tiếp được.
- **Thuộc tính và ảnh**:
  - Có 4 mẫu biểu dựng sẵn: Điều tra lô rừng, Vi phạm lâm luật, PCCCR – Điểm cháy, Tuần tra BVR.
  - Ảnh chụp được đóng dấu thời gian, tọa độ VN2000, hướng chụp và tên người đo, dùng làm chứng cứ hiện trường.
- **Mẫu biểu tự định nghĩa**: chia sẻ cho cả tổ qua **mã QR** hoặc qua file `.json`.
- **Điểm mốc**:
  - Nhập từ Excel/CSV (có file mẫu), tìm kiếm, dẫn đường tới điểm.
  - Nhập tay danh sách tọa độ góc thửa trên sổ đỏ để kiểm tra vị trí trích lục. Ứng dụng tự nối các điểm thành vùng.
- **Chuyển đổi tọa độ**: từng điểm hoặc hàng loạt.
- **Mở file**: GPX, KML, GeoJSON, MBTiles (raster và vector). Với MBTiles vector, chạm vào đối tượng để xem thuộc tính.
- **Xuất file**: GeoJSON (có thể kèm ảnh), KML, GPX, Excel (có cột X/Y VN2000). Chia sẻ thẳng sang Zalo, Gmail, Drive, Messenger.
- **Bản đồ nền**:
  - OpenTopoMap (có đường bình độ), Esri vệ tinh, Mapbox (cần token), hoặc nền XYZ tùy chỉnh.
  - Tải vùng đang xem về máy để dùng offline.
- **Ảnh vệ tinh Sentinel-2 và Landsat 8/9**: tìm ảnh theo khung bản đồ, khoảng ngày và tỷ lệ mây. Có hai tổ hợp màu:
  - Màu tự nhiên.
  - Hồng ngoại: phát hiện mất rừng, vết cháy.
- **La bàn số** và **giao hội điểm** theo phương vị và khoảng cách.
- **Sao lưu / phục hồi**: toàn bộ dữ liệu và ảnh trong 1 file.

## 4. Công cụ MBTiles trên máy tính (`mbtiles-tool.html`)

- **Xem và sửa**:
  - Mở file `.mbtiles`, sửa metadata, xóa từng mức zoom, cập nhật bounds, lưu lại.
  - Bấm vào đối tượng vector để xem thuộc tính.
- **GeoJSON → MBTiles vector**: chuyển đường bình độ, ranh giới tiểu khu/khoảnh/lô, bản đồ hiện trạng rừng… thành MBTiles. Thuộc tính được giữ nguyên.
  - Nhận dữ liệu ở cả WGS84 và VN2000; công cụ tự chuyển hệ.
  - Quy trình: trong QGIS, xuất shapefile ra GeoJSON → tạo MBTiles bằng công cụ này → chép file sang điện thoại → mở trong ứng dụng.
- **Tải nền → MBTiles raster**: đóng gói bản đồ nền của khu vực thành 1 file để chép sang nhiều máy.

## 5. Giới hạn hiện tại và hướng nâng cấp

1. **Ghi tracklog khi tắt màn hình**: trình duyệt trên một số máy Android/iPhone tạm dừng GPS khi tắt màn hình. Hiện ứng dụng giữ màn hình luôn sáng trong lúc ghi. Muốn ghi nền hoàn toàn thì phải đóng gói thành **APK bằng Capacitor** và thêm plugin định vị nền. Phần lõi của ứng dụng dùng lại được nguyên vẹn.
2. **Kho dữ liệu bình độ toàn quốc dựng sẵn**: ứng dụng chưa kèm dữ liệu này. Có thể tự tạo:
   - Lấy DEM miễn phí (SRTM 30 m / Copernicus DEM).
   - Dùng QGIS (Raster → Extraction → Contour) để sinh đường bình độ.
   - Chuyển sang MBTiles bằng công cụ ở mục 4.
3. **Điều khoản sử dụng bản đồ nền**: Google, Mapbox, OSM và Esri đều hạn chế việc tải bản đồ về hàng loạt. Đơn vị chỉ nên tải vùng nhỏ phục vụ công tác, hoặc dùng nguồn bản đồ đơn vị có quyền sử dụng.
4. **Kinh tuyến trục VN2000**: đang theo 63 tỉnh, thành cũ. Sau khi sáp nhập tỉnh năm 2025, cần chọn đúng kinh tuyến trục mà hồ sơ địa chính hoặc hồ sơ lâm nghiệp đang dùng. Ví dụ: Lâm Đồng cũ 107°45′, Đắk Nông cũ và Bình Thuận cũ 108°30′.
5. **Bảo mật dữ liệu**: dữ liệu chỉ lưu trong máy, không gửi lên máy chủ nào. Cần sao lưu định kỳ (Menu → Sao lưu).

## 6. Cập nhật phiên bản (bản APK)

- Từ bản ký số chính thức trở đi, mọi bản APK đều ký bằng khóa cố định của Công ty, **cài đè trực tiếp, không mất dữ liệu**.
- Khi có bản mới, ứng dụng hiện thanh thông báo "Có phiên bản mới" → bấm **Cập nhật** → tải về → **Mở** → **Cập nhật**. Có thể kiểm tra thủ công: Menu → 🔄 Kiểm tra cập nhật.
- Khóa ký số (`lndateh-release.jks` + mật khẩu) do Công ty quản lý như tài liệu mật; mất khóa thì mọi máy phải gỡ ra cài lại.
