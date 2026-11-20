/* Đọc MBTiles (raster & vector) bằng sql.js + lớp Leaflet hiển thị, truy vấn thuộc tính */
(function () {
  let SQLp;
  function sql() {
    if (!SQLp) SQLp = initSqlJs({ locateFile: f => (window.VENDOR_PATH || 'vendor/') + f });
    return SQLp;
  }

  async function gunzipIfNeeded(u8) {
    if (u8[0] === 0x1f && u8[1] === 0x8b) {
      const ds = new DecompressionStream('gzip');
      const buf = await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer();
      return new Uint8Array(buf);
    }
    return u8;
  }

  async function open(buffer, name) {
    const SQL = await sql();
    const db = new SQL.Database(new Uint8Array(buffer));
    const meta = {};
    try {
      const r = db.exec('SELECT name, value FROM metadata');
      if (r[0]) r[0].values.forEach(([k, v]) => meta[k] = v);
    } catch (e) { }
    let format = (meta.format || '').toLowerCase();
    let zr = db.exec('SELECT MIN(zoom_level), MAX(zoom_level) FROM tiles');
    const minz = zr[0] ? zr[0].values[0][0] : 0, maxz = zr[0] ? zr[0].values[0][1] : 18;
    if (!format) {
      const t = db.exec('SELECT tile_data FROM tiles LIMIT 1');
      if (t[0]) {
        const b = t[0].values[0][0];
        if (b[0] === 0x89) format = 'png'; else if (b[0] === 0xff) format = 'jpg';
        else if (b[0] === 0x52) format = 'webp'; else format = 'pbf';
      }
    }
    let vlayers = [];
    if (meta.json) { try { vlayers = (JSON.parse(meta.json).vector_layers || []).map(l => l.id); } catch (e) { } }
    let bounds = null;
    if (meta.bounds) { const b = meta.bounds.split(',').map(Number); if (b.length === 4) bounds = [[b[1], b[0]], [b[3], b[2]]]; }
    const stmt = db.prepare('SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?');
    return {
      name: name || meta.name || 'MBTiles', db, meta, format, minz, maxz, bounds, vlayers,
      getTile(z, x, y) {
        const ty = (1 << z) - 1 - y; // TMS
        stmt.bind([z, x, ty]);
        let d = null;
        if (stmt.step()) d = stmt.get()[0];
        stmt.reset();
        return d;
      },
      close() { try { stmt.free(); db.close(); } catch (e) { } }
    };
  }

  const PALETTE = ['#c0392b', '#2471a3', '#1e8449', '#b9770e', '#7d3c98', '#117a65', '#a04000', '#5d6d7e'];

  function makeLayer(mb, opts) {
    opts = Object.assign({ maxNativeZoom: mb.maxz, minNativeZoom: Math.max(0, mb.minz), maxZoom: 22, opacity: 1 }, opts || {});
    const isVector = mb.format === 'pbf' || mb.format === 'mvt';
    const colorOf = {};
    const colorFor = n => colorOf[n] || (colorOf[n] = PALETTE[Object.keys(colorOf).length % PALETTE.length]);

    const Layer = L.GridLayer.extend({
      createTile(coords, done) {
        const size = this.getTileSize();
        if (!isVector) {
          const img = document.createElement('img');
          img.alt = '';
          const d = mb.getTile(coords.z, coords.x, coords.y);
          if (d) {
            const url = URL.createObjectURL(new Blob([d], { type: 'image/' + (mb.format === 'jpg' ? 'jpeg' : mb.format) }));
            img.onload = () => { URL.revokeObjectURL(url); done(null, img); };
            img.onerror = () => done(null, img);
            img.src = url;
          } else setTimeout(() => done(null, img), 0);
          return img;
        }
        const c = document.createElement('canvas');
        c.width = size.x; c.height = size.y;
        const d = mb.getTile(coords.z, coords.x, coords.y);
        if (!d) { setTimeout(() => done(null, c), 0); return c; }
        gunzipIfNeeded(d).then(u8 => {
          const vt = new VT.VectorTile(new VT.Pbf(u8));
          const ctx = c.getContext('2d');
          const feats = [];
          Object.keys(vt.layers).forEach(ln => {
            const lyr = vt.layers[ln];
            const col = colorFor(ln);
            for (let i = 0; i < lyr.length; i++) {
              const f = lyr.feature(i);
              const sc = size.x / f.extent;
              const geom = f.loadGeometry();
              ctx.strokeStyle = col; ctx.fillStyle = col;
              const props = f.properties;
              const isMajor = props && (props.major || (props.elev || props.ELEV || props.height || props.contour) % 50 === 0);
              ctx.lineWidth = isMajor ? 1.8 : 1;
              if (f.type === 1) {
                geom.forEach(r => r.forEach(p => { ctx.beginPath(); ctx.arc(p.x * sc, p.y * sc, 3, 0, 7); ctx.fill(); }));
              } else {
                ctx.beginPath();
                geom.forEach(r => r.forEach((p, j) => j ? ctx.lineTo(p.x * sc, p.y * sc) : ctx.moveTo(p.x * sc, p.y * sc)));
                if (f.type === 3) { ctx.globalAlpha = 0.18; ctx.fill(); ctx.globalAlpha = 1; }
                ctx.stroke();
              }
              feats.push({ layer: ln, type: f.type, props, geom: geom.map(r => r.map(p => [p.x * sc, p.y * sc])) });
            }
          });
          c._feats = feats;
          done(null, c);
        }).catch(e => done(e, c));
        return c;
      }
    });
    const layer = new Layer(opts);
    layer.mb = mb;
    layer.isVector = isVector;
    // Truy vấn thuộc tính tại điểm (vector)
    layer.query = function (latlng, map) {
      if (!isVector) return [];
      const z = Math.min(Math.round(map.getZoom()), mb.maxz);
      const ts = 256;
      const p = map.project(latlng, z);
      const key = Math.floor(p.x / ts) + ':' + Math.floor(p.y / ts) + ':' + z;
      const t = this._tiles[key];
      if (!t || !t.el._feats) return [];
      const scale = Math.pow(2, map.getZoom() - z);
      const px = p.x - Math.floor(p.x / ts) * ts, py = p.y - Math.floor(p.y / ts) * ts;
      const tol = 6 / scale;
      const hits = [];
      t.el._feats.forEach(f => {
        let best = Infinity, inside = false;
        f.geom.forEach(ring => {
          for (let i = 0; i < ring.length; i++) {
            const a = ring[i], b = ring[i + 1] || (f.type === 3 ? ring[0] : null);
            if (!b) { best = Math.min(best, Math.hypot(a[0] - px, a[1] - py)); continue; }
            best = Math.min(best, segDist(px, py, a, b));
            if (f.type === 3 && ((a[1] > py) !== (b[1] > py)) && px < (b[0] - a[0]) * (py - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
          }
        });
        if (best <= tol || inside) hits.push({ layer: f.layer, props: f.props, d: inside ? tol : best });
      });
      return hits.sort((a, b) => a.d - b.d).slice(0, 5);
    };
    return layer;
  }
  function segDist(px, py, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = dx * dx + dy * dy;
    let t = l ? ((px - a[0]) * dx + (py - a[1]) * dy) / l : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
  }

  // Tạo MBTiles mới (raster từ ảnh tile hoặc vector từ GeoJSON)
  async function create(meta) {
    const SQL = await sql();
    const db = new SQL.Database();
    db.run('CREATE TABLE metadata (name text, value text); CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob); CREATE UNIQUE INDEX tile_index on tiles (zoom_level, tile_column, tile_row);');
    const st = db.prepare('INSERT INTO metadata VALUES (?,?)');
    Object.keys(meta).forEach(k => st.run([k, String(meta[k])]));
    st.free();
    return db;
  }

  window.MBT = { open, makeLayer, create, sql };
})();
