/* IndexedDB lưu trữ offline */
(function () {
  const NAME = 'lndateh-gps', VER = 1;
  const STORES = ['features', 'photos', 'forms', 'tiles', 'files', 'kv'];
  let dbp;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(NAME, VER);
      r.onupgradeneeded = () => STORES.forEach(s => { if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let out; const r = fn(s);
      if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  const DB = {
    get: (s, k) => tx(s, 'readonly', st => st.get(k)),
    put: (s, k, v) => tx(s, 'readwrite', st => st.put(v, k)),
    del: (s, k) => tx(s, 'readwrite', st => st.delete(k)),
    keys: (s) => tx(s, 'readonly', st => st.getAllKeys()),
    all: (s) => tx(s, 'readonly', st => st.getAll()),
    count: (s) => tx(s, 'readonly', st => st.count()),
    clear: (s) => tx(s, 'readwrite', st => st.clear()),
    async putMany(s, entries) {
      const db = await open();
      return new Promise((res, rej) => {
        const t = db.transaction(s, 'readwrite'); const st = t.objectStore(s);
        entries.forEach(([k, v]) => st.put(v, k));
        t.oncomplete = res; t.onerror = () => rej(t.error);
      });
    }
  };
  window.DB = DB;
})();
