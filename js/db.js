/**
 * IndexedDB wrapper for the peaks database.
 *
 * Each peak has a `collections` array (a peak may belong to more than one
 * collection). Nothing is seeded automatically: on an empty database the
 * app prompts the user to choose which bundled collections (data/*.json)
 * to add. Users can also import additional collections, or import/export
 * a full database backup, at any time.
 */
(function (global) {
  'use strict';

  const DB_NAME = 'peaks-db';
  const DB_VERSION = 3;
  const STORE = 'peaks';

  const DEFAULT_COLLECTIONS = [
    { name: 'English county tops', file: 'data/english-county-tops.json' },
    { name: 'Welsh county tops', file: 'data/welsh-county-tops.json' },
    { name: 'Scottish county tops', file: 'data/scottish-county-tops.json' },
    { name: 'Munro mountains', file: 'data/munro-mountains.json' },
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
        if (event.oldVersion < 3) {
          const cursorReq = store.openCursor();
          cursorReq.onsuccess = (e) => {
            const cursor = e.target.result;
            if (!cursor) return;
            const rec = cursor.value;
            let changed = false;
            // Legacy (pre-collections) records: assume they came from the
            // original single default collection.
            if (!Array.isArray(rec.collections)) {
              rec.collections = ['English county tops'];
              changed = true;
            }
            // Legacy records predating per-collection relevance tracking:
            // attribute their current relevance string to their first
            // collection, so a later collection deletion can clean it up.
            if (!rec.relevanceByCollection) {
              rec.relevanceByCollection = rec.collections.length > 0 && rec.relevance ? { [rec.collections[0]]: rec.relevance } : {};
              changed = true;
            }
            if (changed) cursor.update(rec);
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

  // The relevance label shown for a peak is derived from whichever
  // collections contributed to it, so removing a collection also removes
  // its label rather than leaving stale text behind.
  function computeRelevance(peak) {
    const map = peak.relevanceByCollection;
    if (map && Object.keys(map).length > 0) {
      return Object.values(map).filter(Boolean).join('; ');
    }
    return peak.relevance || '';
  }

  // Remove a collection: peaks that belong only to it are deleted; peaks
  // that also belong to other collections just lose this collection's tag
  // (and its contribution to the relevance label).
  async function deleteCollection(name) {
    const all = await getAll();
    let deleted = 0;
    let updated = 0;
    for (const peak of all) {
      if (!Array.isArray(peak.collections) || !peak.collections.includes(name)) continue;
      const remaining = peak.collections.filter((c) => c !== name);
      if (remaining.length === 0) {
        await remove(peak.id);
        deleted++;
      } else {
        peak.collections = remaining;
        if (peak.relevanceByCollection && Object.prototype.hasOwnProperty.call(peak.relevanceByCollection, name)) {
          delete peak.relevanceByCollection[name];
          peak.relevance = computeRelevance(peak);
        }
        await put(peak);
        updated++;
      }
    }
    return { deleted, updated };
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
      relevanceByCollection: raw.relevanceByCollection || {},
    };
  }

  // Merge a collection's peaks into the database: peaks matching an existing
  // summit get the collection name added to their `collections` array, and
  // its relevance label recorded under that collection's key (so deleting
  // the collection later can remove just its own contribution); unmatched
  // peaks are inserted as new records. Always additive.
  async function importCollection(collectionName, peaksArray) {
    const existing = await getAll();
    let added = 0;
    let merged = 0;
    for (const incoming of peaksArray) {
      const match = findMatch(existing, incoming);
      if (match) {
        match.collections = Array.isArray(match.collections) ? match.collections : [];
        match.relevanceByCollection = match.relevanceByCollection || {};
        let changed = false;
        if (!match.collections.includes(collectionName)) {
          match.collections.push(collectionName);
          changed = true;
        }
        if (incoming.relevance && match.relevanceByCollection[collectionName] !== incoming.relevance) {
          match.relevanceByCollection[collectionName] = incoming.relevance;
          changed = true;
        }
        const newRelevance = computeRelevance(match);
        if (newRelevance !== match.relevance) {
          match.relevance = newRelevance;
          changed = true;
        }
        if (changed) await put(match);
        merged++;
      } else {
        const newPeak = normalizeNewPeak(incoming, [collectionName]);
        newPeak.relevanceByCollection = incoming.relevance ? { [collectionName]: incoming.relevance } : {};
        const id = await add(newPeak);
        newPeak.id = id;
        existing.push(newPeak);
        added++;
      }
    }
    return { added, merged };
  }

  // Import one of the collections bundled with the app (data/*.json) by
  // name, with no file upload needed.
  async function importBundledCollection(name) {
    const entry = DEFAULT_COLLECTIONS.find((c) => c.name === name);
    if (!entry) throw new Error(`Unknown bundled collection: ${name}`);
    const res = await fetch(entry.file);
    if (!res.ok) throw new Error(`Could not load ${entry.file}`);
    const data = await res.json();
    return importCollection(data.collection || entry.name, data.peaks || []);
  }

  function listBundledCollections() {
    return DEFAULT_COLLECTIONS.map((c) => ({ ...c }));
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
        match.relevanceByCollection = match.relevanceByCollection || {};
        const incomingMap = incoming.relevanceByCollection || {};
        for (const [key, val] of Object.entries(incomingMap)) {
          if (val && match.relevanceByCollection[key] !== val) {
            match.relevanceByCollection[key] = val;
            changed = true;
          }
        }
        const newRelevance = computeRelevance(match);
        if (newRelevance !== match.relevance) {
          match.relevance = newRelevance;
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
    deleteCollection,
    computeRelevance,
    importCollection,
    importBundledCollection,
    listBundledCollections,
    exportDatabase,
    importDatabase,
  };
})(window);
