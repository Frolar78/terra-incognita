// ============================================================
// db.js — persistance locale (IndexedDB uniquement)
// Stores :
//   cells      { h3, date, act }           clé : h3
//   activities { id, name, date, sport, distance, elev, coeff,
//                xp, newCells, poly }      clé : id
//   journal    { id auto, date, type, text }
//   meta       { key, value }              clé : key
// ============================================================
(function () {
  const DB_NAME = 'terra-incognita';
  const DB_VER = 1;
  let db = null;

  function open() {
    return new Promise((res, rej) => {
      const rq = indexedDB.open(DB_NAME, DB_VER);
      rq.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('cells'))
          d.createObjectStore('cells', { keyPath: 'h3' });
        if (!d.objectStoreNames.contains('activities'))
          d.createObjectStore('activities', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('journal'))
          d.createObjectStore('journal', { keyPath: 'id', autoIncrement: true });
        if (!d.objectStoreNames.contains('meta'))
          d.createObjectStore('meta', { keyPath: 'key' });
      };
      rq.onsuccess = () => { db = rq.result; res(db); };
      rq.onerror = () => rej(rq.error);
    });
  }

  function tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      const out = fn(s);
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }

  const DB = {
    async init() {
      await open();
      // Demande la persistance : évite qu'iOS/Android purge les données
      if (navigator.storage && navigator.storage.persist) {
        try { await navigator.storage.persist(); } catch (e) { /* sans gravité */ }
      }
    },

    get(store, key) {
      return new Promise((res, rej) => {
        const rq = db.transaction(store).objectStore(store).get(key);
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => rej(rq.error);
      });
    },

    getAll(store) {
      return new Promise((res, rej) => {
        const rq = db.transaction(store).objectStore(store).getAll();
        rq.onsuccess = () => res(rq.result || []);
        rq.onerror = () => rej(rq.error);
      });
    },

    getAllKeys(store) {
      return new Promise((res, rej) => {
        const rq = db.transaction(store).objectStore(store).getAllKeys();
        rq.onsuccess = () => res(rq.result || []);
        rq.onerror = () => rej(rq.error);
      });
    },

    put(store, val) { return tx(store, 'readwrite', (s) => s.put(val)); },

    bulkPut(store, arr) {
      return tx(store, 'readwrite', (s) => { for (const v of arr) s.put(v); });
    },

    add(store, val) { return tx(store, 'readwrite', (s) => s.add(val)); },

    clear(store) { return tx(store, 'readwrite', (s) => s.clear()); },

    async metaGet(key, def) {
      const r = await DB.get('meta', key);
      return r === undefined ? def : r.value;
    },
    metaSet(key, value) { return DB.put('meta', { key, value }); },

    // --- Export / import JSON --------------------------------
    async exportAll() {
      const [cells, activities, journal, meta] = await Promise.all([
        DB.getAll('cells'), DB.getAll('activities'),
        DB.getAll('journal'), DB.getAll('meta'),
      ]);
      const m = meta.filter((x) => !/token/i.test(x.key)); // jamais de secrets dans l'export
      return { app: 'terra-incognita', version: 1,
        exportDate: new Date().toISOString(),
        cells, activities, journal, meta: m };
    },

    async importAll(data) {
      if (!data || data.app !== 'terra-incognita') throw new Error('Fichier non reconnu');
      await DB.bulkPut('cells', data.cells || []);
      await DB.bulkPut('activities', data.activities || []);
      await DB.bulkPut('meta', data.meta || []);
      for (const j of (data.journal || [])) { delete j.id; await DB.add('journal', j); }
    },
  };

  window.TI.DB = DB;
})();
