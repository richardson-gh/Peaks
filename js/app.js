(function () {
  'use strict';

  let peaks = [];
  let userLocation = null; // { lat, lon }
  let activeDetailId = null;
  let map = null;
  let markers = new Map(); // id -> Leaflet marker

  const el = (id) => document.getElementById(id);

  // ---------- Utilities ----------

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function formatDateTimeLocalInput(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function formatDisplayDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // ---------- Data loading ----------

  async function loadPeaks() {
    peaks = await PeaksDB.getAll();
    renderCount();
    renderList();
    renderMapMarkers();
  }

  function renderCount() {
    const visited = peaks.filter((p) => p.visited).length;
    el('peak-count').textContent = `${visited}/${peaks.length} visited`;
  }

  // ---------- List view ----------

  function getFilteredSortedPeaks() {
    const sortBy = el('sort-select').value;
    const filterBy = el('filter-select').value;

    let list = peaks.slice();
    if (filterBy === 'visited') list = list.filter((p) => p.visited);
    if (filterBy === 'unvisited') list = list.filter((p) => !p.visited);

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
          p._distance = p.lat != null && p.lon != null ? haversineKm(userLocation.lat, userLocation.lon, p.lat, p.lon) : Infinity;
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

    el('d-name').textContent = peak.name;
    el('d-relevance').textContent = peak.relevance || '';
    el('d-height').textContent = peak.height != null ? `${peak.height} m` : '—';
    el('d-gridref').textContent = peak.gridRef || '—';
    el('d-latlon').textContent = peak.lat != null && peak.lon != null ? `${peak.lat.toFixed(5)}, ${peak.lon.toFixed(5)}` : '—';
    el('d-status').textContent = peak.visited ? `Visited ${formatDisplayDate(peak.visitedAt)}` : 'Not visited';
    el('d-notes').value = peak.notes || '';
    el('d-visited').checked = !!peak.visited;
    el('d-visitedat').value = peak.visitedAt ? formatDateTimeLocalInput(new Date(peak.visitedAt)) : formatDateTimeLocalInput(new Date());
    toggleVisitedAtVisibility('d-visited', 'd-visitedat-wrap');

    el('detail-sheet').classList.remove('hidden');
  }

  function closeDetail() {
    el('detail-sheet').classList.add('hidden');
    activeDetailId = null;
  }

  function toggleVisitedAtVisibility(checkboxId, wrapId) {
    el(wrapId).classList.toggle('hidden', !el(checkboxId).checked);
  }

  async function saveDetail() {
    const peak = peaks.find((p) => p.id === activeDetailId);
    if (!peak) return;
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

    peaks.forEach((peak) => {
      if (peak.lat == null || peak.lon == null) return;
      const marker = L.circleMarker([peak.lat, peak.lon], {
        radius: 8,
        color: peak.visited ? '#1c7a41' : '#8f221c',
        fillColor: peak.visited ? '#2e9e5b' : '#d1453b',
        fillOpacity: 0.9,
        weight: 2,
      }).addTo(map);

      const statusText = peak.visited ? `Visited ${formatDisplayDate(peak.visitedAt)}` : 'Not visited';
      marker.bindPopup(
        `<strong>${escapeHtml(peak.name)}</strong><br>${escapeHtml(peak.relevance || '')}<br>${peak.height != null ? peak.height + ' m' : ''}<br>${statusText}<br><button data-open-id="${peak.id}" class="popup-open-btn">Details</button>`
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
    await PeaksDB.ensureSeeded();
    await loadPeaks();

    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    el('sort-select').addEventListener('change', renderList);
    el('filter-select').addEventListener('change', renderList);

    el('sheet-close').addEventListener('click', closeDetail);
    el('d-save').addEventListener('click', saveDetail);
    el('d-delete').addEventListener('click', deleteActivePeak);
    el('d-visited').addEventListener('change', () => toggleVisitedAtVisibility('d-visited', 'd-visitedat-wrap'));

    el('add-form').addEventListener('submit', handleAddSubmit);
    el('f-visited').addEventListener('change', () => toggleVisitedAtVisibility('f-visited', 'f-visitedat-wrap'));
    el('f-use-location').addEventListener('click', useCurrentLocationForForm);
    el('f-visitedat').value = formatDateTimeLocalInput(new Date());
    toggleVisitedAtVisibility('f-visited', 'f-visitedat-wrap');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
