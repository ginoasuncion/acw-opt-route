// sketch.js — Auto-load CSV (name,address,latitude,longitude,place_id) + routing + Maps link
// Uses "Name, Address" in the URL path; forces DRIVING via query params AND /data=!3e0.

/* ---------------- Config ---------------- */
const BOUNDS_MODE = 'min';      // 'min' = tighter; 'max' = union route/markers
const BOUNDS_BUFFER_M = 600;    // meters padding around chosen bounds
const PIN_LABEL_SIZE_SELECTED = '16px';
const PIN_LABEL_SIZE_ROUTE = '18px';

/** Brand palette + no basemap labels (venue text comes from your pins only). */
const ACW_MAP_STYLES = [
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#2B7787' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#CEAD2C' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#CEAD2C' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#CEAD2C' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#CEAD2C' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#CEAD2C' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#d9c23a' }] },

  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.medical', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.school', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.government', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.place_of_worship', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.attraction', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },

  { featureType: 'all', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'all', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'all', elementType: 'labels.text', stylers: [{ visibility: 'off' }] },
];

/* ---------------- State ---------------- */
let places = []; // filled from CSV
let map, directionsService, directionsRenderer;
let markers = [];
let hasExpanded = false;
let activeBounds = null;
let didInitialFit = false;
let didRouteFit = false;
let lastSelectionKey = null;

/* ---------------- CSV helpers ---------------- */
function getCsvUrl() {
  // Priority: <meta name="venues-csv">, then window.__VENUES_CSV_URL
  const meta = document.querySelector('meta[name="venues-csv"]');
  if (meta?.content) return meta.content.trim();
  if (window.__VENUES_CSV_URL) return String(window.__VENUES_CSV_URL).trim();
  return null;
}

function parseCSV(text) {
  // Robust CSV parser handling quotes, commas, newlines
  const rows = [];
  let i = 0, field = '', row = [], inside = false;
  while (i < text.length) {
    const ch = text[i];
    if (inside) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inside = false; i++; continue;
      }
      field += ch; i++; continue;
    } else {
      if (ch === '"') { inside = true; i++; continue; }
      if (ch === ',') { row.push(field); field = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += ch; i++;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  if (!rows.length) return [];
  const headers = rows[0].map(h => String(h || '').trim());
  const norm = headers.map(h => h.toLowerCase().replace(/\s+/g, '_'));

  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const obj = {};
    const arr = rows[r];
    for (let c = 0; c < norm.length; c++) obj[norm[c]] = String(arr[c] ?? '').trim();
    out.push(obj);
  }
  return out;
}

function mapCsvRowToPlace(row) {
  const pick = (...keys) => {
    for (const k of keys) if (row[k] != null && String(row[k]).trim() !== '') return String(row[k]).trim();
    return '';
  };
  const name = pick('name', 'venue_name', 'title', 'label');
  const address = pick('address', 'addr');
  const latStr = pick('latitude', 'lat', 'y');
  const lonStr = pick('longitude', 'lon', 'lng', 'x');
  const pid = pick('place_id', 'googlemapsplaceid', 'google_maps_place_id', 'google_place_id', 'gmaps_place_id');

  const lat = parseFloat(latStr);
  const lon = parseFloat(lonStr);
  if (!name || Number.isNaN(lat) || Number.isNaN(lon)) return null;

  return { name, address, lat, lon, googleMapsPlaceId: pid || '' };
}

async function loadPlacesFromCsvUrl(url) {
  // Cache-bust to avoid stale files during iterations
  const bust = url.includes('?') ? `${url}&_=${Date.now()}` : `${url}?_=${Date.now()}`;
  const resp = await fetch(bust, { credentials: 'include' });
  if (!resp.ok) throw new Error(`CSV HTTP ${resp.status}`);
  const text = await resp.text();
  const rows = parseCSV(text);
  const mapped = rows.map(mapCsvRowToPlace).filter(Boolean);
  return sortPlacesByName(mapped);
}

function sortPlacesByName(arr) {
  return [...arr].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function blackPinIcon() {
  return {
    path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z',
    fillColor: '#000000',
    fillOpacity: 1,
    strokeWeight: 0,
    scale: 1.45,
    anchor: new google.maps.Point(12, 22),
    labelOrigin: new google.maps.Point(12, 42),
  };
}

function setMarkerVenueLabel(marker, text, fontSize = PIN_LABEL_SIZE_SELECTED) {
  if (!text) {
    marker.setLabel(null);
    return;
  }
  marker.setLabel({
    text,
    color: '#000000',
    fontSize,
    fontWeight: '500',
  });
}

function syncMarkerLabelsFromSelection() {
  markers.forEach((m, i) => {
    const cb = document.querySelector(`#placesList input[type="checkbox"][value="${i}"]`);
    if (cb?.checked) setMarkerVenueLabel(m, places[i].name);
    else setMarkerVenueLabel(m, null);
  });
}

/* ---------------- Layout helpers ---------------- */
function getSidebarWidth() {
  const el = document.querySelector(".sidebar-wrapper");
  return el ? el.offsetWidth : Math.floor(window.innerWidth / 2);
}
function fitBoundsLeft(bounds) {
  map.fitBounds(bounds, { top: 50, bottom: 50, left: 50, right: getSidebarWidth() + 50 });
}
function fitBoundsCentered(bounds) {
  map.fitBounds(bounds, { top: 50, bottom: 300, left: 50, right: 50 });
}
function fitBoundsResponsive(bounds) {
  if (window.innerWidth <= 600) fitBoundsCentered(bounds);
  else fitBoundsLeft(bounds);
}
function applyResponsivePadding() {
  const padding = window.innerWidth <= 600
    ? { top: 50, bottom: 300, left: 50, right: 50 }
    : { top: 50, bottom: 50, left: 50, right: getSidebarWidth() + 50 };
  map.setOptions({ padding });
}
function selectionKey(arr) {
  return arr.map(p => p.name).sort().join('|');
}

/* ---------------- Bounds helpers ---------------- */
function unionBounds(a, b) {
  if (!a) return b;
  if (!b) return a;
  const u = new google.maps.LatLngBounds(a.getSouthWest(), a.getNorthEast());
  u.union(b);
  return u;
}
function boundsArea(b) {
  if (!b) return 0;
  const sw = b.getSouthWest(), ne = b.getNorthEast();
  return Math.max(0, ne.lat() - sw.lat()) * Math.max(0, ne.lng() - sw.lng());
}
function expandBoundsByMeters(bounds, meters) {
  if (!bounds || !meters) return bounds;
  const lat = bounds.getCenter().lat();
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((lat * Math.PI) / 180);
  const dLat = meters / mPerDegLat;
  const dLng = meters / mPerDegLng;
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  return new google.maps.LatLngBounds(
    new google.maps.LatLng(sw.lat() - dLat, sw.lng() - dLng),
    new google.maps.LatLng(ne.lat() + dLat, ne.lng() + dLng)
  );
}
function chooseAndBufferBounds({ routeBounds, markerBounds, mode = 'min', bufferMeters = 0 }) {
  let chosen;
  if (routeBounds && markerBounds) {
    chosen = (mode === 'max') ? unionBounds(routeBounds, markerBounds)
      : (boundsArea(routeBounds) <= boundsArea(markerBounds) ? routeBounds : markerBounds);
  } else {
    chosen = routeBounds || markerBounds;
  }
  return expandBoundsByMeters(chosen, bufferMeters);
}

/* ---------------- UI helpers ---------------- */
function clearMarkers() {
  markers.forEach(m => m.setMap(null));
  markers = [];
}
function populateFromPlaces() {
  const list = document.getElementById('placesList');
  list.innerHTML = '';
  clearMarkers();

  if (!places.length) {
    list.innerHTML = `<div style="opacity:.8">No places loaded yet.</div>`;
    return;
  }

  places.forEach((p, i) => {
    const marker = new google.maps.Marker({
      position: { lat: p.lat, lng: p.lon },
      map,
      title: p.name,
      icon: blackPinIcon(),
    });
    markers.push(marker);

    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = i;
    cb.addEventListener('change', syncMarkerLabelsFromSelection);
    label.appendChild(cb);
    const nameSpan = document.createElement('span');
    nameSpan.className = 'venue-name';
    nameSpan.textContent = p.name;
    label.appendChild(nameSpan);
    list.appendChild(label);
  });

  const b = new google.maps.LatLngBounds();
  places.forEach(p => b.extend({ lat: p.lat, lng: p.lon }));
  activeBounds = b;
  fitBoundsResponsive(b);
  didInitialFit = true;
}

/* ---------------- Initialize ---------------- */
function initMap() {
  map = new google.maps.Map(document.getElementById('map'), {
    zoom: 3,
    center: { lat: 23.0353928, lng: 72.4947591 },
    gestureHandling: 'greedy',
    mapTypeControl: false, fullscreenControl: false, streetViewControl: false,
    zoomControl: false, panControl: false, rotateControl: false, scaleControl: false,
    keyboardShortcuts: false,
    styles: ACW_MAP_STYLES,
  });

  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({
    map, suppressMarkers: true, preserveViewport: true,
    polylineOptions: { strokeColor: '#000000', strokeWeight: 5 }
  });

  // Sidebar (silent auto-load; fallback to file picker)
  const controlDiv = document.createElement('div');
  controlDiv.className = 'places-control';
  controlDiv.innerHTML = `
    <div id="fallbackPicker" style="padding:10px;display:none">
      <input id="csvInput" type="file" accept=".csv" />
    </div>
    <div id="placesList"></div>
    <div class="panel-footer">
      <button id="computeBtn">COMPUTE ROUTE</button>
      <div class="footer-links">
        <a id="gmapLink" href="#" target="_blank"><span>GOOGLE MAPS</span></a>
        <a id="copyLink" href="#"><span>COPY LINK</span></a>
      </div>
    </div>`;
  const wrapper = document.createElement('div');
  wrapper.className = 'sidebar-wrapper';
  wrapper.appendChild(controlDiv);
  document.body.appendChild(wrapper);

  // Loader
  if (!document.getElementById('loader')) {
    const loader = document.createElement('div');
    loader.id = 'loader';
    Object.assign(loader.style, {
      display: 'none', position: 'absolute', inset: '0',
      alignItems: 'center', justifyContent: 'center', zIndex: '3',
      background: 'rgba(255,255,255,0.45)'
    });
    loader.innerHTML = `<div style="padding:10px 14px;border-radius:10px;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.1);font-weight:600">Computing route…</div>`;
    document.body.appendChild(loader);
  }

  // Attempt auto-load CSV (silent)
  (async () => {
    const url = getCsvUrl();
    if (!url) {
      enableFallbackPicker(controlDiv);
      populateFromPlaces();
      return;
    }
    try {
      places = await loadPlacesFromCsvUrl(url);
      didRouteFit = false;
      lastSelectionKey = null;
      populateFromPlaces();
    } catch (e) {
      console.error(e);
      enableFallbackPicker(controlDiv);
      populateFromPlaces();
    }
  })();

  // Footer actions
  const computeBtn = controlDiv.querySelector('#computeBtn');
  const copyLink = controlDiv.querySelector('#copyLink');
  const gmapLink = controlDiv.querySelector('#gmapLink');
  const footer = controlDiv.querySelector('.panel-footer');

  computeBtn.addEventListener('click', async () => {
    await computeRouteByDistance();
    if (!hasExpanded) { footer.classList.add('computed'); hasExpanded = true; }
  });

  copyLink.addEventListener('click', (e) => {
    e.preventDefault();
    if (gmapLink.href && gmapLink.href !== '#') {
      navigator.clipboard.writeText(gmapLink.href).then(() => alert('Route link copied!'));
    } else {
      alert('No route to copy yet.');
    }
  });

  window.addEventListener('resize', applyResponsivePadding);
}
window.initMap = initMap;

function enableFallbackPicker(root) {
  const picker = root.querySelector('#fallbackPicker');
  const input = root.querySelector('#csvInput');
  picker.style.display = 'block';
  input.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = parseCSV(String(reader.result || ''));
        const mapped = rows.map(mapCsvRowToPlace).filter(Boolean);
        places = sortPlacesByName(mapped);
        didRouteFit = false;
        lastSelectionKey = null;
        populateFromPlaces();
      } catch (err) {
        alert('Could not parse CSV. Ensure headers: name,address,latitude,longitude,place_id');
        console.error(err);
      }
    };
    reader.readAsText(file);
  });
}

/* ---------------- Distance matrix + simple NN TSP ---------------- */
async function getDistanceMatrixChunked(selected) {
  const service = new google.maps.DistanceMatrixService();
  const n = selected.length;
  const matrix = Array.from({ length: n }, () => new Array(n).fill(Infinity));
  for (let i = 0; i < n; i++) {
    const origins = [{ lat: selected[i].lat, lng: selected[i].lon }];
    const destinations = selected.map(p => ({ lat: p.lat, lng: p.lon }));
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve, reject) => {
      service.getDistanceMatrix(
        { origins, destinations, travelMode: google.maps.TravelMode.DRIVING }, // DRIVING
        (res, status) => {
          if (status === "OK") {
            res.rows[0].elements.forEach((el, j) => {
              matrix[i][j] = el.status === "OK" ? el.distance.value : Infinity;
            });
            resolve();
          } else reject(status);
        }
      );
    });
  }
  return matrix;
}
function tspNearestNeighbor(distMatrix) {
  const n = distMatrix.length;
  const visited = new Array(n).fill(false);
  const order = [0];
  visited[0] = true;
  for (let i = 1; i < n; i++) {
    let last = order[order.length - 1];
    let next = -1;
    let minDist = Infinity;
    for (let j = 0; j < n; j++) {
      if (!visited[j] && distMatrix[last][j] < minDist) {
        minDist = distMatrix[last][j]; next = j;
      }
    }
    order.push(next); visited[next] = true;
  }
  return order;
}

/* ---------------- Route + Maps link (Name, Address + DRIVING + !3e0) ---------------- */
async function computeRouteByDistance() {
  showLoader(true);
  const selected = [];
  document.querySelectorAll('#placesList input:checked').forEach(cb => {
    selected.push(places[parseInt(cb.value, 10)]);
  });
  if (selected.length < 2) {
    alert('Select at least 2 places.');
    showLoader(false);
    return;
  }

  const selKey = selectionKey(selected);

  try {
    const distances = await getDistanceMatrixChunked(selected);
    const order = tspNearestNeighbor(distances);
    const orderedPlaces = order.map(i => selected[i]);

    const origin = { lat: orderedPlaces[0].lat, lng: orderedPlaces[0].lon };
    const destination = { lat: orderedPlaces.at(-1).lat, lng: orderedPlaces.at(-1).lon };
    const waypoints = orderedPlaces.slice(1, -1).map(p => ({
      location: { lat: p.lat, lng: p.lon }, stopover: true
    }));

    directionsService.route(
      {
        origin,
        destination,
        waypoints,
        optimizeWaypoints: false,
        travelMode: google.maps.TravelMode.DRIVING // DRIVING
      },
      (result, status) => {
        showLoader(false);
        if (status !== 'OK') { alert('Directions request failed: ' + status); return; }

        directionsRenderer.setDirections(result);

        // Numbered labels below pin for selected stops only
        markers.forEach(m => setMarkerVenueLabel(m, null));
        orderedPlaces.forEach((p, num) => {
          const idx = places.findIndex(pp => pp.name === p.name);
          if (idx !== -1) {
            setMarkerVenueLabel(markers[idx], `${num + 1}. ${p.name}`, PIN_LABEL_SIZE_ROUTE);
          }
        });

        // Fit bounds
        const routeBounds = result?.routes?.[0]?.bounds || null;
        const markerBounds = (() => {
          const b = new google.maps.LatLngBounds();
          orderedPlaces.forEach(p => b.extend({ lat: p.lat, lng: p.lon }));
          return b;
        })();
        activeBounds = chooseAndBufferBounds({ routeBounds, markerBounds, mode: BOUNDS_MODE, bufferMeters: BOUNDS_BUFFER_M });
        if (!didRouteFit || selKey !== lastSelectionKey) { fitBoundsResponsive(activeBounds); didRouteFit = true; }
        else { applyResponsivePadding(); }
        lastSelectionKey = selKey;

        // ---------- Build Google Maps URL using "Name, Address" + DRIVING + !3e0 ----------
        const enc = encodeURIComponent;
        const label = (p) => p.address && p.address.length ? `${p.name}, ${p.address}` : p.name;

        const pathSegments = [
          label(orderedPlaces[0]),
          ...orderedPlaces.slice(1, -1).map(label),
          label(orderedPlaces.at(-1))
        ].map(enc).join('/');

        // Base path
        let url = `https://www.google.com/maps/dir/${pathSegments}`;

        // Insert the driving mode flag used by many Maps UIs
        // This mirrors the ".../data=!3e0" pattern you shared.
        url += `/data=!3e0`;

        // Redundant but explicit DRIVING params to cover variations of Maps UIs
        const params = new URLSearchParams({
          travelmode: 'driving', // modern
          dirflg: 'd'            // legacy
        });

        // Companion place IDs for precise pins (does not change displayed names)
        const originId = orderedPlaces[0].googleMapsPlaceId?.trim();
        const destId   = orderedPlaces.at(-1).googleMapsPlaceId?.trim();
        const wpIdsArr = orderedPlaces.slice(1, -1).map(p => (p.googleMapsPlaceId || '').trim());

        if (originId) params.set('origin_place_id', originId);
        if (destId)   params.set('destination_place_id', destId);
        if (wpIdsArr.some(id => !!id)) params.set('waypoint_place_ids', wpIdsArr.join('|'));

        const qs = params.toString();
        if (qs) url += `?${qs}`;

        const gmapLink = document.getElementById('gmapLink');
        if (gmapLink) { gmapLink.href = url; gmapLink.style.display = 'inline-flex'; }
        const footer = document.querySelector('.panel-footer');
        if (footer) footer.classList.add('computed');
        // -----------------------------------------------------------------------------------
      }
    );
  } catch (err) {
    showLoader(false);
    alert('Error building distance matrix: ' + err);
  }
}

/* ---------------- Loader ---------------- */
function showLoader(show) {
  const el = document.getElementById('loader');
  if (el) el.style.display = show ? 'flex' : 'none';
}
