/**
 * IndexedDB wrapper for the peaks database.
 * On first run (no existing database), seeds it with the 48 English
 * ceremonial county tops.
 */
(function (global) {
  'use strict';

  const DB_NAME = 'peaks-db';
  const DB_VERSION = 1;
  const STORE = 'peaks';

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (event) => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('name', 'name', { unique: false });
          store.createIndex('visited', 'visited', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(storeMode) {
    return openDb().then((db) => db.transaction(STORE, storeMode).objectStore(STORE));
  }

  function getAll() {
    return tx('readonly').then(
      (store) =>
        new Promise((resolve, reject) => {
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        })
    );
  }

  function count() {
    return tx('readonly').then(
      (store) =>
        new Promise((resolve, reject) => {
          const req = store.count();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        })
    );
  }

  function add(peak) {
    return tx('readwrite').then(
      (store) =>
        new Promise((resolve, reject) => {
          const req = store.add(peak);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        })
    );
  }

  function put(peak) {
    return tx('readwrite').then(
      (store) =>
        new Promise((resolve, reject) => {
          const req = store.put(peak);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        })
    );
  }

  function remove(id) {
    return tx('readwrite').then(
      (store) =>
        new Promise((resolve, reject) => {
          const req = store.delete(id);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        })
    );
  }

  async function ensureSeeded() {
    const existing = await count();
    if (existing > 0) return;
    const seedPeaks = global.SEED_PEAKS();
    const store = await tx('readwrite');
    await Promise.all(
      seedPeaks.map(
        (peak) =>
          new Promise((resolve, reject) => {
            const req = store.add(peak);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
          })
      )
    );
  }

  global.PeaksDB = { openDb, getAll, add, put, remove, ensureSeeded, count };
})(window);
