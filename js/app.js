(function () {
  'use strict';

  let peaks = [];
  let userLocation = null; // { lat, lon }
  let activeDetailId = null;
  let map = null;
  let markers = new Map(); // id -> Leaflet marker
  let pendingDbImport = null; // parsed peaks array awaiting overwrite/merge choice

  const el = (id) => document.getElementById(id);

  // ---------- Utilities ----------

  function formatDateTimeLocalInput(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function formatDisplayDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function googleMapsUrl(lat, lon) {
    return `https://www.google.com/maps?q=${lat},${lon}`;
  }

  function osMapsUrl(lat, lon) {
    return `https://explore.osmaps.com/?lat=${lat}&lon=${lon}&zoom=17`;
  }

  function parseCollectionsInput(text) {
    return text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // ---------- Data loading ----------

  async function loadPeaks() {
    peaks = await PeaksDB.getAll();
    renderCount();
    renderCollectionOptions();
    renderOnboarding();
    renderList();
    renderMapMarkers();
    renderBundledCollections();
    renderManageCollections();
  }

  // ---------- Onboarding (first run, empty database) ----------

  const ONBOARDING_DISMISSED_KEY = 'peaks-onboarding-dismissed';

  function renderOnboarding() {
    const showOnboarding = peaks.length === 0 && !localStorage.getItem(ONBOARDING_DISMISSED_KEY);
    el('onboarding').classList.toggle('hidden', !showOnboarding);
    document.querySelector('#view-list .toolbar').classList.toggle('hidden', showOnboarding);
    el('peak-list').classList.toggle('hidden', showOnboarding);
    if (!showOnboarding) return;

    const listEl = el('onboarding-collections-list');
    listEl.innerHTML = '';
    PeaksDB.listBundledCollections().forEach(({ name }) => {
      const li = document.createElement('li');
      li.className = 'onboarding-item';
      const label = document.createElement('label');
      label.className = 'form-check';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = name;
      checkbox.checked = true;
      const span = document.createElement('span');
      span.textContent = name;
      label.appendChild(checkbox);
      label.appendChild(span);
      li.appendChild(label);
      listEl.appendChild(li);
    });
  }

  async function handleOnboardingAdd() {
    const checked = Array.from(document.querySelectorAll('#onboarding-collections-list input:checked')).map((cb) => cb.value);
    for (const name of checked) {
      try {
        await PeaksDB.importBundledCollection(name);
      } catch (err) {
        console.error(`Failed to import "${name}"`, err);
      }
    }
    await loadPeaks();
  }

  function handleOnboardingSkip() {
    localStorage.setItem(ONBOARDING_DISMISSED_KEY, '1');
    renderOnboarding();
  }

  function renderCount() {
    const visited = peaks.filter((p) => p.visited).length;
    el('peak-count').textContent = `${visited}/${peaks.length} visited`;
  }

  function renderCollectionOptions() {
    const sel = el('collection-select');
    const current = sel.value || 'all';
    const names = Array.from(new Set(peaks.flatMap((p) => p.collections || []))).sort((a, b) => a.localeCompare(b));
    sel.innerHTML = '<option value="all">All collections</option>';
    names.forEach((name) => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
    if (names.includes(current)) sel.value = current;
  }

  // ---------- List view ----------

  function getFilteredSortedPeaks() {
    const sortBy = el('sort-select').value;
    const filterBy = el('filter-select').value;
    const collectionBy = el('collection-select').value;

    let list = peaks.slice();
    if (filterBy === 'visited') list = list.filter((p) => p.visited);
    if (filterBy === 'unvisited') list = list.filter((p) => !p.visited);
    if (collectionBy !== 'all') list = list.filter((p) => (p.collections || []).includes(collectionBy));

    if (sortBy === 'name') {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === 'height') {
      list.sort((a, b) => (b.height || 0) - (a.height || 0));
    } else if (sortBy === 'relevance') {
      list.sort((a, b) => (a.relevance || '').localeCompare(b.relevance || ''));
    } else if (sortBy === 'visited') {
      list.sort((a, b) => {
        if (!a.visitedAt && !b.visitedAt) return 0;
        if (!a.visitedAt) return 1;
        if (!b.visitedAt) return -1;
        return new Date(b.visitedAt) - new Date(a.visitedAt);
      });
    } else if (sortBy === 'distance') {
      if (userLocation) {
        list.forEach((p) => {
          p._distance = p.lat != null && p.lon != null ? OSGB.haversineKm(userLocation.lat, userLocation.lon, p.lat, p.lon) : Infinity;
        });
        list.sort((a, b) => a._distance - b._distance);
      } else {
        list.sort((a, b) => a.name.localeCompare(b.name));
      }
    }
    return list;
  }

  function renderList() {
    const listEl = el('peak-list');
    const hint = el('distance-hint');
    const sortBy = el('sort-select').value;

    if (sortBy === 'distance' && !userLocation) {
      hint.textContent = 'Finding your location…';
      hint.classList.remove('hidden');
      requestLocation().then(() => renderList());
    } else {
      hint.classList.add('hidden');
    }

    const list = getFilteredSortedPeaks();
    listEl.innerHTML = '';

    list.forEach((peak) => {
      const li = document.createElement('li');
      li.className = 'peak-item';
      li.dataset.id = peak.id;

      const dot = document.createElement('span');
      dot.className = `status-dot ${peak.visited ? 'visited' : 'unvisited'}`;

      const main = document.createElement('div');
      main.className = 'peak-main';
      const name = document.createElement('div');
      name.className = 'peak-name';
      name.textContent = peak.name;
      const meta = document.createElement('div');
      meta.className = 'peak-meta';
      const relevance = document.createElement('span');
      relevance.textContent = peak.relevance || '';
      meta.appendChild(relevance);
      if (sortBy === 'distance' && Number.isFinite(peak._distance)) {
        const dist = document.createElement('span');
        dist.className = 'peak-distance';
        dist.textContent = `${peak._distance.toFixed(1)} km away`;
        meta.appendChild(dist);
      }
      main.appendChild(name);
      main.appendChild(meta);

      const height = document.createElement('div');
      height.className = 'peak-height';
      height.textContent = peak.height != null ? `${peak.height} m` : '';

      li.appendChild(dot);
      li.appendChild(main);
      li.appendChild(height);
      li.addEventListener('click', () => openDetail(peak.id));
      listEl.appendChild(li);
    });
  }

  function requestLocation() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        el('distance-hint').textContent = 'Geolocation not available on this device.';
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          userLocation = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          resolve(userLocation);
        },
        () => {
          el('distance-hint').textContent = 'Location permission denied — showing alphabetical order instead.';
          el('distance-hint').classList.remove('hidden');
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });
  }

  // ---------- Detail sheet ----------

  function openDetail(id) {
    const peak = peaks.find((p) => p.id === id);
    if (!peak) return;
    activeDetailId = id;

    el('d-name').value = peak.name || '';
    el('d-relevance').value = peak.relevance || '';
    el('d-height').value = peak.height != null ? peak.height : '';
    el('d-gridref').value = peak.gridRef || '';
    el('d-lat').value = peak.lat != null ? peak.lat : '';
    el('d-lon').value = peak.lon != null ? peak.lon : '';
    el('d-collections').value = (peak.collections || []).join(', ');
    el('d-status').textContent = peak.visited ? `Visited ${formatDisplayDate(peak.visitedAt)}` : 'Not visited';
    el('d-notes').value = peak.notes || '';
    el('d-visited').checked = !!peak.visited;
    el('d-visitedat').value = peak.visitedAt ? formatDateTimeLocalInput(new Date(peak.visitedAt)) : formatDateTimeLocalInput(new Date());
    toggleVisitedAtVisibility('d-visited', 'd-visitedat-wrap');
    updateDetailMapLinks();

    el('detail-sheet').classList.remove('hidden');
  }

  function updateDetailMapLinks() {
    const lat = el('d-lat').value ? Number(el('d-lat').value) : null;
    const lon = el('d-lon').value ? Number(el('d-lon').value) : null;
    const googleLink = el('d-google-maps-link');
    const osLink = el('d-os-maps-link');
    const hasCoords = lat != null && lon != null && !Number.isNaN(lat) && !Number.isNaN(lon);
    googleLink.classList.toggle('disabled', !hasCoords);
    osLink.classList.toggle('disabled', !hasCoords);
    googleLink.href = hasCoords ? googleMapsUrl(lat, lon) : '#';
    osLink.href = hasCoords ? osMapsUrl(lat, lon) : '#';
  }

  function closeDetail() {
    el('detail-sheet').classList.add('hidden');
    activeDetailId = null;
  }

  function toggleVisitedAtVisibility(checkboxId, wrapId) {
    el(wrapId).classList.toggle('hidden', !el(checkboxId).checked);
  }

  function recalcDetailLatLon() {
    const gridRef = el('d-gridref').value.trim();
    if (!gridRef) return;
    const coords = window.OSGB.gridRefToLatLon(gridRef);
    if (coords) {
      el('d-lat').value = coords.lat.toFixed(6);
      el('d-lon').value = coords.lon.toFixed(6);
      updateDetailMapLinks();
    }
  }

  async function saveDetail() {
    const peak = peaks.find((p) => p.id === activeDetailId);
    if (!peak) return;
    const name = el('d-name').value.trim();
    if (!name) return;

    peak.name = name;
    peak.relevance = el('d-relevance').value.trim();
    peak.height = el('d-height').value ? Number(el('d-height').value) : null;
    peak.gridRef = el('d-gridref').value.trim() || null;
    peak.lat = el('d-lat').value ? Number(el('d-lat').value) : null;
    peak.lon = el('d-lon').value ? Number(el('d-lon').value) : null;
    peak.collections = parseCollectionsInput(el('d-collections').value);
    peak.notes = el('d-notes').value;
    peak.visited = el('d-visited').checked;
    peak.visitedAt = peak.visited ? new Date(el('d-visitedat').value).toISOString() : null;
    await PeaksDB.put(peak);
    closeDetail();
    await loadPeaks();
  }

  async function deleteActivePeak() {
    if (activeDetailId == null) return;
    const peak = peaks.find((p) => p.id === activeDetailId);
    if (!confirm(`Delete "${peak ? peak.name : 'this peak'}"? This can't be undone.`)) return;
    await PeaksDB.remove(activeDetailId);
    closeDetail();
    await loadPeaks();
  }

  // ---------- Add form ----------

  async function handleAddSubmit(evt) {
    evt.preventDefault();
    const name = el('f-name').value.trim();
    if (!name) return;

    let lat = el('f-lat').value ? Number(el('f-lat').value) : null;
    let lon = el('f-lon').value ? Number(el('f-lon').value) : null;
    const gridRef = el('f-gridref').value.trim();

    if ((lat == null || lon == null) && gridRef) {
      const coords = window.OSGB.gridRefToLatLon(gridRef);
      if (coords) {
        lat = Number(coords.lat.toFixed(6));
        lon = Number(coords.lon.toFixed(6));
      }
    }

    const visited = el('f-visited').checked;

    const peak = {
      name,
      relevance: el('f-relevance').value.trim(),
      height: el('f-height').value ? Number(el('f-height').value) : null,
      gridRef: gridRef || null,
      lat,
      lon,
      collections: parseCollectionsInput(el('f-collections').value),
      notes: el('f-notes').value.trim(),
      visited,
      visitedAt: visited ? new Date(el('f-visitedat').value).toISOString() : null,
    };

    await PeaksDB.add(peak);
    el('add-form').reset();
    toggleVisitedAtVisibility('f-visited', 'f-visitedat-wrap');
    await loadPeaks();
    switchView('list');
  }

  function useCurrentLocationForForm() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      el('f-lat').value = pos.coords.latitude.toFixed(6);
      el('f-lon').value = pos.coords.longitude.toFixed(6);
    });
  }

  // ---------- Map view ----------

  function initMap() {
    map = L.map('map', { zoomControl: true }).setView([53.0, -2.0], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
  }

  function renderMapMarkers() {
    if (!map) return;
    markers.forEach((m) => map.removeLayer(m));
    markers.clear();

    const visible = getFilteredSortedPeaks();
    visible.forEach((peak) => {
      if (peak.lat == null || peak.lon == null) return;
      const marker = L.circleMarker([peak.lat, peak.lon], {
        radius: 8,
        color: peak.visited ? '#1c7a41' : '#8f221c',
        fillColor: peak.visited ? '#2e9e5b' : '#d1453b',
        fillOpacity: 0.9,
        weight: 2,
      }).addTo(map);

      const statusText = peak.visited ? `Visited ${formatDisplayDate(peak.visitedAt)}` : 'Not visited';
      const mapLinks = `<a href="${googleMapsUrl(peak.lat, peak.lon)}" target="_blank" rel="noopener">Google Maps</a> &middot; <a href="${osMapsUrl(peak.lat, peak.lon)}" target="_blank" rel="noopener">OS Maps</a>`;
      marker.bindPopup(
        `<strong>${escapeHtml(peak.name)}</strong><br>${escapeHtml(peak.relevance || '')}<br>${peak.height != null ? peak.height + ' m' : ''}<br>${statusText}<br>${mapLinks}<br><button data-open-id="${peak.id}" class="popup-open-btn">Details</button>`
      );
      marker.on('popupopen', () => {
        const btn = document.querySelector(`[data-open-id="${peak.id}"]`);
        if (btn) btn.addEventListener('click', () => openDetail(peak.id));
      });
      markers.set(peak.id, marker);
    });
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ---------- Data: bundled collections (no upload needed) ----------

  function renderBundledCollections() {
    const listEl = el('bundled-collections-list');
    if (!listEl) return;
    const known = new Set(peaks.flatMap((p) => p.collections || []));
    const bundled = PeaksDB.listBundledCollections();
    listEl.innerHTML = '';

    bundled.forEach(({ name }) => {
      const li = document.createElement('li');
      li.className = 'bundled-item';

      const info = document.createElement('div');
      info.className = 'bundled-info';
      const title = document.createElement('div');
      title.className = 'bundled-name';
      title.textContent = name;
      const status = document.createElement('div');
      status.className = 'hint';
      status.textContent = known.has(name) ? 'Already in your database' : 'Not yet added';
      info.appendChild(title);
      info.appendChild(status);

      li.dataset.collectionName = name;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-secondary';
      btn.textContent = known.has(name) ? 'Re-import' : 'Import';
      btn.addEventListener('click', () => importBundled(name));

      li.appendChild(info);
      li.appendChild(btn);
      listEl.appendChild(li);
    });
  }

  async function importBundled(name) {
    let message;
    try {
      const result = await PeaksDB.importBundledCollection(name);
      message = `${result.added} new peaks added, ${result.merged} matched peaks you already have.`;
    } catch (err) {
      message = `Could not import: ${err.message}`;
    }
    await loadPeaks();
    const row = document.querySelector(`.bundled-item[data-collection-name="${CSS.escape(name)}"]`);
    if (row) row.querySelector('.hint').textContent = message;
  }

  // ---------- Data: manage / delete collections ----------

  function renderManageCollections() {
    const listEl = el('manage-collections-list');
    if (!listEl) return;
    const counts = {};
    peaks.forEach((p) => (p.collections || []).forEach((c) => (counts[c] = (counts[c] || 0) + 1)));
    const names = Object.keys(counts).sort((a, b) => a.localeCompare(b));
    listEl.innerHTML = '';

    if (names.length === 0) {
      const li = document.createElement('li');
      li.className = 'hint';
      li.textContent = 'No collections yet.';
      listEl.appendChild(li);
      return;
    }

    names.forEach((name) => {
      const count = counts[name];
      const li = document.createElement('li');
      li.className = 'bundled-item';

      const info = document.createElement('div');
      info.className = 'bundled-info';
      const title = document.createElement('div');
      title.className = 'bundled-name';
      title.textContent = name;
      const status = document.createElement('div');
      status.className = 'hint';
      status.textContent = `${count} peak${count === 1 ? '' : 's'}`;
      info.appendChild(title);
      info.appendChild(status);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-danger';
      btn.textContent = 'Delete collection';
      btn.addEventListener('click', () => handleDeleteCollection(name));

      li.appendChild(info);
      li.appendChild(btn);
      listEl.appendChild(li);
    });
  }

  async function handleDeleteCollection(name) {
    const confirmed = confirm(
      `Delete the collection "${name}"? Peaks only in this collection will be removed entirely; peaks also in other collections will just be untagged.`
    );
    if (!confirmed) return;
    const result = await PeaksDB.deleteCollection(name);
    await loadPeaks();
    el('manage-collections-status').textContent = `"${name}": removed ${result.deleted} peak(s), untagged ${result.updated} peak(s) still in other collections.`;
  }

  // ---------- Data: export ----------

  async function exportDatabase() {
    const data = await PeaksDB.exportDatabase();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `peaks-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ---------- Data: import database (overwrite / merge) ----------

  function readFileAsJson(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(JSON.parse(reader.result));
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  async function handleImportDbFileChange(evt) {
    const file = evt.target.files[0];
    if (!file) return;
    const statusEl = el('import-db-status');
    statusEl.textContent = '';
    try {
      const data = await readFileAsJson(file);
      const importPeaks = Array.isArray(data) ? data : data.peaks;
      if (!Array.isArray(importPeaks)) throw new Error('No peaks array found in file');
      pendingDbImport = importPeaks;
      el('import-db-count').textContent = importPeaks.length;
      el('import-db-choice').classList.remove('hidden');
    } catch (err) {
      statusEl.textContent = `Could not read that file: ${err.message}`;
      pendingDbImport = null;
    }
  }

  function cancelDbImport() {
    pendingDbImport = null;
    el('import-db-choice').classList.add('hidden');
    el('import-db-file').value = '';
  }

  async function runDbImport(mode) {
    if (!pendingDbImport) return;
    const statusEl = el('import-db-status');
    const result = await PeaksDB.importDatabase(pendingDbImport, mode);
    el('import-db-choice').classList.add('hidden');
    el('import-db-file').value = '';
    pendingDbImport = null;
    statusEl.textContent =
      mode === 'overwrite'
        ? `Database overwritten with ${result.added} peaks.`
        : `Merged: ${result.added} new peaks added, ${result.merged} matched existing peaks.`;
    await loadPeaks();
  }

  // ---------- Data: import a collection ----------

  async function handleImportCollectionFileChange(evt) {
    const file = evt.target.files[0];
    if (!file) return;
    const statusEl = el('import-collection-status');
    statusEl.textContent = '';
    try {
      const data = await readFileAsJson(file);
      const collectionName = data.collection;
      const collectionPeaks = data.peaks;
      if (!collectionName || !Array.isArray(collectionPeaks)) {
        throw new Error('Expected an object with "collection" and "peaks" fields');
      }
      const result = await PeaksDB.importCollection(collectionName, collectionPeaks);
      statusEl.textContent = `Imported "${collectionName}": ${result.added} new peaks added, ${result.merged} matched peaks you already have.`;
      el('import-collection-file').value = '';
      await loadPeaks();
    } catch (err) {
      statusEl.textContent = `Could not import that file: ${err.message}`;
    }
  }

  // ---------- View switching ----------

  function switchView(name) {
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('view-active'));
    el(`view-${name}`).classList.add('view-active');
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('tab-active', b.dataset.view === name));
    if (name === 'map') {
      if (!map) initMap();
      renderMapMarkers();
      setTimeout(() => map.invalidateSize(), 50);
    }
  }

  // ---------- Init ----------

  async function init() {
    await loadPeaks();

    el('onboarding-add-btn').addEventListener('click', handleOnboardingAdd);
    el('onboarding-skip-btn').addEventListener('click', handleOnboardingSkip);
    el('show-standard-collections-btn').addEventListener('click', () => {
      el('bundled-collections-list').classList.toggle('hidden');
    });

    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    el('sort-select').addEventListener('change', renderList);
    el('filter-select').addEventListener('change', () => {
      renderList();
      renderMapMarkers();
    });
    el('collection-select').addEventListener('change', () => {
      renderList();
      renderMapMarkers();
    });

    el('sheet-close').addEventListener('click', closeDetail);
    el('d-save').addEventListener('click', saveDetail);
    el('d-delete').addEventListener('click', deleteActivePeak);
    el('d-recalc').addEventListener('click', recalcDetailLatLon);
    el('d-lat').addEventListener('input', updateDetailMapLinks);
    el('d-lon').addEventListener('input', updateDetailMapLinks);
    el('d-visited').addEventListener('change', () => toggleVisitedAtVisibility('d-visited', 'd-visitedat-wrap'));

    el('add-form').addEventListener('submit', handleAddSubmit);
    el('f-visited').addEventListener('change', () => toggleVisitedAtVisibility('f-visited', 'f-visitedat-wrap'));
    el('f-use-location').addEventListener('click', useCurrentLocationForForm);
    el('f-visitedat').value = formatDateTimeLocalInput(new Date());
    toggleVisitedAtVisibility('f-visited', 'f-visitedat-wrap');

    el('export-db-btn').addEventListener('click', exportDatabase);
    el('import-db-file').addEventListener('change', handleImportDbFileChange);
    el('import-db-merge').addEventListener('click', () => runDbImport('merge'));
    el('import-db-overwrite').addEventListener('click', () => runDbImport('overwrite'));
    el('import-db-cancel').addEventListener('click', cancelDbImport);
    el('import-collection-file').addEventListener('change', handleImportCollectionFileChange);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
