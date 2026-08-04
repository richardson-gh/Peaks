/**
 * IndexedDB wrapper for the peaks database.
 *
 * Each peak has a `collections` array (a peak may belong to more than one
 * collection). On first run, the default collections (data/*.json) are
 * imported automatically. Users can also import additional collections,
 * or import/export a full database backup, at any time.
 */
(function (global) {
  'use strict';

  const DB_NAME = 'peaks-db';
  const DB_VERSION = 2;
  const STORE = 'peaks';

  const DEFAULT_COLLECTIONS = [
    { name: 'English county tops', file: 'data/english-county-tops.json' },
    { name: 'Welsh county tops', file: 'data/welsh-county-tops.json' },
    { name: 'Scottish county tops', file: 'data/scottish-county-tops.json' },
  ];

  const MATCH_RADIUS_KM = 0.2;

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (event) => {
        const db = req.result;
        const tx = req.transaction;
        let store;
        if (!db.objectStoreNames.contains(STORE)) {
          store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('name', 'name', { unique: false });
          store.createIndex('visited', 'visited', { unique: false });
        } else {
          store = tx.objectStore(STORE);
        }
        if (event.oldVersion < 2) {
          // Legacy (pre-collections) records: assume they came from the
          // original single default collection.
          const cursorReq = store.openCursor();
          cursorReq.onsuccess = (e) => {
            const cursor = e.target.result;
            if (!cursor) return;
            const rec = cursor.value;
            if (!Array.isArray(rec.collections)) {
              rec.collections = ['English county tops'];
              cursor.update(rec);
            }
            cursor.continue();
          };
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

  function clear() {
    return tx('readwrite').then(
      (store) =>
        new Promise((resolve, reject) => {
          const req = store.clear();
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        })
    );
  }

  // Find an existing peak representing the same real-world summit as
  // `incoming`. Requires a matching grid reference, or coordinates within
  // MATCH_RADIUS_KM of each other — matching on name alone is unsafe, since
  // unrelated hills (e.g. multiple "Beacon Hill"s) commonly share a name.
  function findMatch(existingList, incoming) {
    const incomingGridRef = (incoming.gridRef || '').trim().toUpperCase();
    return existingList.find((p) => {
      const gridRef = (p.gridRef || '').trim().toUpperCase();
      if (incomingGridRef && gridRef && incomingGridRef === gridRef) return true;
      if (p.lat != null && p.lon != null && incoming.lat != null && incoming.lon != null) {
        return global.OSGB.haversineKm(p.lat, p.lon, incoming.lat, incoming.lon) <= MATCH_RADIUS_KM;
      }
      return false;
    });
  }

  function normalizeNewPeak(raw, collections) {
    return {
      name: raw.name,
      relevance: raw.relevance || '',
      height: raw.height != null && raw.height !== '' ? Number(raw.height) : null,
      gridRef: raw.gridRef || null,
      lat: raw.lat != null && raw.lat !== '' ? Number(raw.lat) : null,
      lon: raw.lon != null && raw.lon !== '' ? Number(raw.lon) : null,
      notes: raw.notes || '',
      visited: !!raw.visited,
      visitedAt: raw.visited && raw.visitedAt ? raw.visitedAt : null,
      collections: collections,
    };
  }

  // Combine two relevance labels (e.g. "Kent Top" + "Greater London Top" ->
  // "Kent Top; Greater London Top"), skipping blanks and exact duplicates.
  function mergeRelevance(existingRelevance, incomingRelevance) {
    const existingParts = (existingRelevance || '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    const incomingTrimmed = (incomingRelevance || '').trim();
    if (!incomingTrimmed) return existingRelevance || '';
    if (existingParts.some((p) => p.toLowerCase() === incomingTrimmed.toLowerCase())) {
      return existingRelevance || '';
    }
    return existingParts.length ? `${existingParts.join('; ')}; ${incomingTrimmed}` : incomingTrimmed;
  }

  // Merge a collection's peaks into the database: peaks matching an existing
  // summit get the collection name added to their `collections` array (and
  // their relevance label joined on, if different); unmatched peaks are
  // inserted as new records. Always additive.
  async function importCollection(collectionName, peaksArray) {
    const existing = await getAll();
    let added = 0;
    let merged = 0;
    for (const incoming of peaksArray) {
      const match = findMatch(existing, incoming);
      if (match) {
        match.collections = Array.isArray(match.collections) ? match.collections : [];
        let changed = false;
        if (!match.collections.includes(collectionName)) {
          match.collections.push(collectionName);
          changed = true;
        }
        const mergedRelevance = mergeRelevance(match.relevance, incoming.relevance);
        if (mergedRelevance !== match.relevance) {
          match.relevance = mergedRelevance;
          changed = true;
        }
        if (changed) await put(match);
        merged++;
      } else {
        const newPeak = normalizeNewPeak(incoming, [collectionName]);
        const id = await add(newPeak);
        newPeak.id = id;
        existing.push(newPeak);
        added++;
      }
    }
    return { added, merged };
  }

  async function ensureDefaultCollectionsSeeded() {
    const existing = await getAll();
    const known = new Set(existing.flatMap((p) => p.collections || []));
    for (const { name, file } of DEFAULT_COLLECTIONS) {
      if (known.has(name)) continue;
      try {
        const res = await fetch(file);
        if (!res.ok) continue;
        const data = await res.json();
        await importCollection(data.collection || name, data.peaks || []);
      } catch (err) {
        console.error(`Failed to load default collection "${name}"`, err);
      }
    }
  }

  async function exportDatabase() {
    const all = await getAll();
    return {
      type: 'peaks-db-export',
      exportedAt: new Date().toISOString(),
      peaks: all.map(({ id, ...rest }) => rest),
    };
  }

  // mode: 'overwrite' replaces the whole database; 'merge' adds/merges into it.
  async function importDatabase(peaksArray, mode) {
    if (mode === 'overwrite') {
      await clear();
      for (const raw of peaksArray) {
        await add(normalizeNewPeak(raw, Array.isArray(raw.collections) ? raw.collections : []));
      }
      return { added: peaksArray.length, merged: 0, mode };
    }

    const existing = await getAll();
    let added = 0;
    let merged = 0;
    for (const incoming of peaksArray) {
      const match = findMatch(existing, incoming);
      if (match) {
        let changed = false;
        const incomingCollections = Array.isArray(incoming.collections) ? incoming.collections : [];
        for (const c of incomingCollections) {
          if (!match.collections.includes(c)) {
            match.collections.push(c);
            changed = true;
          }
        }
        const mergedRelevance = mergeRelevance(match.relevance, incoming.relevance);
        if (mergedRelevance !== match.relevance) {
          match.relevance = mergedRelevance;
          changed = true;
        }
        if (!match.visited && incoming.visited) {
          match.visited = true;
          match.visitedAt = incoming.visitedAt || new Date().toISOString();
          changed = true;
        }
        if (!match.notes && incoming.notes) {
          match.notes = incoming.notes;
          changed = true;
        }
        if (changed) await put(match);
        merged++;
      } else {
        const newPeak = normalizeNewPeak(incoming, Array.isArray(incoming.collections) ? incoming.collections : []);
        const id = await add(newPeak);
        newPeak.id = id;
        existing.push(newPeak);
        added++;
      }
    }
    return { added, merged, mode };
  }

  global.PeaksDB = {
    openDb,
    getAll,
    count,
    add,
    put,
    remove,
    clear,
    importCollection,
    ensureDefaultCollectionsSeeded,
    exportDatabase,
    importDatabase,
  };
})(window);
