/* LN DaTeh GPS - Hệ tọa độ VN2000 (TT 973/2001/TT-TCĐC) */
(function () {
  const TOWGS84 = '-191.90441429,-39.30318279,-111.45032835,-0.00928836,0.01975479,-0.00427372,0.252906278';
  const tm = (lon0, k) => `+proj=tmerc +lat_0=0 +lon_0=${lon0} +k=${k} +x_0=500000 +y_0=0 +ellps=WGS84 +towgs84=${TOWGS84} +units=m +no_defs`;
  const dm = (d, m) => d + m / 60;

  // Kinh tuyến trục theo tỉnh (63 tỉnh, thành cũ - TT 973/2001), múi 3°, k = 0.9999
  const PROV = [
    ['Lâm Đồng', 107, 45], ['Đắk Nông', 108, 30], ['Bình Thuận', 108, 30], ['Đồng Nai', 107, 45],
    ['An Giang', 104, 45], ['Bà Rịa - Vũng Tàu', 107, 45], ['Bạc Liêu', 105, 0], ['Bắc Giang', 107, 0],
    ['Bắc Kạn', 106, 30], ['Bắc Ninh', 105, 30], ['Bến Tre', 105, 45], ['Bình Dương', 105, 45],
    ['Bình Định', 108, 15], ['Bình Phước', 106, 15], ['Cà Mau', 104, 30], ['Cao Bằng', 105, 45],
    ['Cần Thơ', 105, 0], ['Đà Nẵng', 107, 45], ['Đắk Lắk', 108, 30], ['Điện Biên', 103, 0],
    ['Đồng Tháp', 105, 0], ['Gia Lai', 108, 30], ['Hà Giang', 105, 30], ['Hà Nam', 105, 0],
    ['Hà Nội', 105, 0], ['Hà Tĩnh', 105, 30], ['Hải Dương', 105, 30], ['Hải Phòng', 105, 45],
    ['Hậu Giang', 105, 0], ['Hòa Bình', 106, 0], ['Hưng Yên', 105, 30], ['Khánh Hòa', 108, 15],
    ['Kiên Giang', 104, 30], ['Kon Tum', 107, 30], ['Lai Châu', 103, 0], ['Lạng Sơn', 107, 15],
    ['Lào Cai', 104, 45], ['Long An', 105, 45], ['Nam Định', 105, 30], ['Nghệ An', 104, 45],
    ['Ninh Bình', 105, 0], ['Ninh Thuận', 108, 15], ['Phú Thọ', 104, 45], ['Phú Yên', 108, 30],
    ['Quảng Bình', 106, 0], ['Quảng Nam', 107, 45], ['Quảng Ngãi', 108, 0], ['Quảng Ninh', 107, 45],
    ['Quảng Trị', 106, 15], ['Sóc Trăng', 105, 30], ['Sơn La', 104, 0], ['Tây Ninh', 105, 30],
    ['Thái Bình', 105, 30], ['Thái Nguyên', 106, 30], ['Thanh Hóa', 105, 0], ['Thừa Thiên Huế', 107, 0],
    ['Tiền Giang', 105, 45], ['TP. Hồ Chí Minh', 105, 45], ['Trà Vinh', 105, 30], ['Tuyên Quang', 106, 0],
    ['Vĩnh Long', 105, 30], ['Vĩnh Phúc', 105, 0], ['Yên Bái', 104, 45]
  ];

  const LIST = [];
  LIST.push({ id: 'WGS84', name: 'WGS84 - Kinh/Vĩ độ (độ thập phân)', geo: true, def: '+proj=longlat +datum=WGS84 +no_defs' });
  LIST.push({ id: 'WGS84DMS', name: 'WGS84 - Kinh/Vĩ độ (độ° phút\' giây")', geo: true, dms: true, def: '+proj=longlat +datum=WGS84 +no_defs' });
  PROV.forEach(([n, d, m]) => {
    const id = 'VN3_' + n.replace(/[^A-Za-z0-9]/g, '') + '_' + d + m;
    LIST.push({ id, name: `VN2000 ${n} (KTT ${d}°${String(m).padStart(2, '0')}', múi 3°)`, def: tm(dm(d, m), 0.9999), lon0: dm(d, m) });
  });
  [102, 105, 108, 111].forEach(l => LIST.push({ id: 'VN3Z_' + l, name: `VN2000 múi 3° KTT ${l}° (k=0.9999)`, def: tm(l, 0.9999), lon0: l }));
  LIST.push({ id: 'VNUTM48', name: 'VN2000 UTM múi 48 (KTT 105°, 6°)', def: tm(105, 0.9996), lon0: 105 });
  LIST.push({ id: 'VNUTM49', name: 'VN2000 UTM múi 49 (KTT 111°, 6°)', def: tm(111, 0.9996), lon0: 111 });
  LIST.push({ id: 'UTM48N', name: 'WGS84 UTM 48N', def: '+proj=utm +zone=48 +datum=WGS84 +units=m +no_defs', lon0: 105 });
  LIST.push({ id: 'UTM49N', name: 'WGS84 UTM 49N', def: '+proj=utm +zone=49 +datum=WGS84 +units=m +no_defs', lon0: 111 });

  const BY = {};
  LIST.forEach(c => { BY[c.id] = c; proj4.defs(c.id, c.def); });
  const DEFAULT = LIST.find(c => c.name.startsWith('VN2000 Lâm Đồng')).id;

  function toDMS(v, pos, neg) {
    const s = v < 0 ? neg : pos; v = Math.abs(v);
    let d = Math.floor(v), m = Math.floor((v - d) * 60), sec = ((v - d) * 60 - m) * 60;
    if (sec >= 59.995) { sec = 0; m++; } if (m >= 60) { m = 0; d++; }
    return `${d}°${String(m).padStart(2, '0')}'${sec.toFixed(2).padStart(5, '0')}"${s}`;
  }
  function parseDMS(str) {
    if (typeof str === 'number') return str;
    str = String(str).trim().replace(',', '.');
    if (/^-?\d+(\.\d+)?$/.test(str)) return parseFloat(str);
    const neg = /[SWsw-]/.test(str);
    const n = str.match(/\d+(\.\d+)?/g); if (!n) return NaN;
    const v = (+n[0]) + (+(n[1] || 0)) / 60 + (+(n[2] || 0)) / 3600;
    return neg ? -v : v;
  }

  // Từ WGS84 (lng, lat) sang hệ c. Trả về {a, b, la, lb}: VN quy ước X = Bắc (Northing), Y = Đông (Easting)
  function fromWGS(id, lng, lat) {
    const c = BY[id];
    if (c.geo) {
      return c.dms ? { a: toDMS(lat, 'N', 'S'), b: toDMS(lng, 'E', 'W'), la: 'Vĩ độ', lb: 'Kinh độ' }
        : { a: lat.toFixed(7), b: lng.toFixed(7), la: 'Vĩ độ', lb: 'Kinh độ' };
    }
    const [e, n] = proj4('WGS84', id, [lng, lat]);
    return { a: n.toFixed(2), b: e.toFixed(2), la: 'X (Bắc)', lb: 'Y (Đông)', x: n, y: e };
  }
  // Sang WGS84 từ X(Bắc), Y(Đông) hoặc Vĩ độ, Kinh độ
  function toWGS(id, a, b) {
    const c = BY[id];
    if (c.geo) return { lat: parseDMS(a), lng: parseDMS(b) };
    a = parseFloat(String(a).replace(',', '.')); b = parseFloat(String(b).replace(',', '.'));
    const [lng, lat] = proj4(id, 'WGS84', [b, a]);
    return { lat, lng };
  }
  // Tọa độ phẳng (m) để tính diện tích chính xác theo hệ đang dùng
  function planar(id, lng, lat) {
    let c = BY[id];
    if (!c || c.geo) c = BY[DEFAULT];
    return proj4('WGS84', c.id, [lng, lat]);
  }

  window.CRS = { LIST, BY, DEFAULT, fromWGS, toWGS, planar, toDMS, parseDMS };
})();
