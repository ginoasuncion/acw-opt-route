// sketch.js — route/marker bounds chooser ("min" or "max") + buffer,
// and Google Maps links that show official place names via googleMapsPlaceId
// NOTE: You do NOT need the client Places library for IDs now.
// Make sure your HTML includes a meta with your key, or the Maps script with ?key=...
//   <meta name="google-maps-api-key" content="YOUR_API_KEY">

// --- Config: bounds choice + buffer ---
const BOUNDS_MODE = 'min';      // 'min' = tighter of route vs markers; 'max' = larger (union)
const BOUNDS_BUFFER_M = 600;    // extra padding in meters added to chosen bounds

// --- Define places ---
const places = [
  { name: "079 | Stories", lat: 23.0353928, lon: 72.4947591 },
  { name: "Archer Art Gallery", lat: 23.04166188, lon: 72.55184877 },
  { name: "Arthshila Ahmedabad", lat: 23.029595, lon: 72.5372661 },
  { name: "Basera", lat: 23.03008, lon: 72.57936 },
  { name: "Conflictorium", lat: 23.03534, lon: 72.58649 },
  { name: "Darpana Academy", lat: 23.0477, lon: 72.57277 },
  { name: "Hutheesing Visual Art Centre", lat: 23.03724, lon: 72.54969 },
  { name: "Iram Art Gallery", lat: 23.02874, lon: 72.49185 },
  { name: "Kanoria Centre for Arts", lat: 23.0375, lon: 72.54908 },
  { name: "Kasturbhai Lalbhai Museum", lat: 23.05223, lon: 72.59307 },
  { name: "LD Museum Director Bunglow", lat: 23.03422, lon: 72.55094 },
  { name: "Mehnat Manzil: Museum of Work", lat: 22.99835, lon: 72.53732 },
  { name: "Samara Art Gallery", lat: 23.04347, lon: 72.55721 },
  { name: "Shreyas Foundation", lat: 23.01436, lon: 72.53993 },
  { name: "Studio Sangath / Vastushilpa Sangath LLP", lat: 23.04791, lon: 72.52645 }
];

let map, directionsService, directionsRenderer; // ⬅️ no placesService needed
let markers = [];
let hasExpanded = false;
let activeBounds = null;

// Fit control flags
let didInitialFit = false;
let didRouteFit = false;

// Track last computed selection (to decide whether to refit/zoom)
let lastSelectionKey = null;

/* ---------------- Helpers: API key (lazy) ---------------- */
function getApiKey() {
  // Prefer meta tag
  const meta = document.querySelector('meta[name="google-maps-api-key"]');
  if (meta?.content) return meta.content.trim();

  // Fallback: window global if you set it
  if (window.__GMAPS_API_KEY) return String(window.__GMAPS_API_KEY).trim();

  // Last resort: scan the Maps script URL
  const scripts = document.getElementsByTagName('script');
  for (const s of scripts) {
    if (s.src && s.src.includes('maps.googleapis.com/maps/api/js') && s.src.includes('key=')) {
      try {
        const url = new URL(s.src);
        const k = url.searchParams.get('key');
        if (k) return k.trim();
      } catch (_) {}
    }
  }
  return null;
}

/* ---------------- Helpers: layout / padding ---------------- */
function getSidebarWidth() {
  const sidebar = document.querySelector(".sidebar-wrapper");
  return sidebar ? sidebar.offsetWidth : Math.floor(window.innerWidth / 2);
}

function fitBoundsLeft(bounds) {
  map.fitBounds(bounds, {
    top: 50,
    bottom: 50,
    left: 50,
    right: getSidebarWidth() + 50
  });
}

function fitBoundsCentered(bounds) {
  map.fitBounds(bounds, {
    top: 50,
    bottom: 300, // leave space for bottom sheet on mobile
    left: 50,
    right: 50
  });
}

function fitBoundsResponsive(bounds) {
  if (window.innerWidth <= 328) fitBoundsCentered(bounds);
  else fitBoundsLeft(bounds);
}

function applyResponsivePadding() {
  const padding =
    window.innerWidth <= 328
      ? { top: 50, bottom: 300, left: 50, right: 50 }
      : { top: 50, bottom: 50, left: 50, right: getSidebarWidth() + 50 };
  map.setOptions({ padding });
}

function selectionKey(arr) {
  return arr.map(p => p.name).sort().join("|");
}

/* ---------------- Helpers: bounds math ---------------- */
function unionBounds(a, b) {
  if (!a) return b;
  if (!b) return a;
  const u = new google.maps.LatLngBounds(a.getSouthWest(), a.getNorthEast());
  u.union(b);
  return u;
}

function boundsArea(b) {
  if (!b) return 0;
  const sw = b.getSouthWest();
  const ne = b.getNorthEast();
  const dLat = Math.max(0, ne.lat() - sw.lat());
  const dLng = Math.max(0, ne.lng() - sw.lng());
  return dLat * dLng;
}

function expandBoundsByMeters(bounds, meters) {
  if (!bounds || !meters) return bounds;

  const ctr = bounds.getCenter();
  const lat = ctr.lat();
  const mPerDegLat = 111320; // ~ meters/degree latitude
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
    chosen = mode === 'max'
      ? unionBounds(routeBounds, markerBounds)
      : (boundsArea(routeBounds) <= boundsArea(markerBounds) ? routeBounds : markerBounds);
  } else {
    chosen = routeBounds || markerBounds; // whichever exists
  }
  return expandBoundsByMeters(chosen, bufferMeters);
}

/* ---------------- Place IDs (via Places API New) ----------------
   We request googleMapsPlaceId, which is the one that works in Maps URLs.
------------------------------------------------------------------*/
async function getPlaceIdFor(place) {
  if (place.googleMapsPlaceId) return place.googleMapsPlaceId;

  const API_KEY = getApiKey();
  if (!API_KEY) {
    console.warn('Missing API key; falling back to lat/lng for', place.name);
    return null;
  }

  const url = "https://places.googleapis.com/v1/places:searchText";
  const body = {
    textQuery: place.name,
    maxResultCount: 1,
    // Bias to Ahmedabad area to disambiguate
    locationBias: {
      circle: {
        center: { latitude: 23.03, longitude: 72.58 },
        radius: 30000
      }
    }
  };

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": API_KEY,
        // Ask explicitly for googleMapsPlaceId (the one used in URLs)
        "X-Goog-FieldMask": "places.googleMapsPlaceId,places.id,places.displayName"
      },
      body: JSON.stringify(body)
    });

    if (!resp.ok) throw new Error(`Places search HTTP ${resp.status}`);
    const data = await resp.json();
    const p = data?.places?.[0];

    if (p?.googleMapsPlaceId) {
      place.googleMapsPlaceId = p.googleMapsPlaceId;
      return place.googleMapsPlaceId;
    }

    // Optional fallback: if only internal ID returned, try details
    if (p?.id) {
      const detailsUrl = `https://places.googleapis.com/v1/places/${encodeURIComponent(p.id)}?fields=googleMapsPlaceId`;
      const det = await fetch(detailsUrl, { headers: { "X-Goog-Api-Key": API_KEY } });
      if (det.ok) {
        const dj = await det.json();
        if (dj.googleMapsPlaceId) {
          place.googleMapsPlaceId = dj.googleMapsPlaceId;
          return place.googleMapsPlaceId;
        }
      }
    }
  } catch (e) {
    console.warn("Place ID lookup failed for", place.name, e);
  }

  return null; // fall back to lat/lng if not found
}

async function ensurePlaceIds(arr) {
  for (const p of arr) {
    // eslint-disable-next-line no-await-in-loop
    await getPlaceIdFor(p);
  }
}

/* ---------------- Initialize map ---------------- */
function initMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    zoom: 1,
    center: { lat: 23.0353928, lng: 72.4947591 },
    gestureHandling: "greedy",
    mapTypeControl: false,
    fullscreenControl: false,
    streetViewControl: false,
    zoomControl: false,
    panControl: false,
    rotateControl: false,
    scaleControl: false,
    keyboardShortcuts: false,
    mapId: "ceb937821bc6d1ab66996a44",
  });

  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({
    map,
    suppressMarkers: true,
    preserveViewport: true, // we control zoom/fit ourselves
    polylineOptions: { strokeColor: "#9D2C21", strokeWeight: 5 }
  });

  // Sidebar UI
  const controlDiv = document.createElement("div");
  controlDiv.className = "places-control";
  controlDiv.innerHTML = `
    <div id="placesList"></div>
    <div class="panel-footer">
      <button id="computeBtn">COMPUTE ROUTE</button>
      <div class="footer-links">
        <a id="gmapLink" href="#" target="_blank"><span>OPEN IN GOOGLE MAPS</span></a>
        <a id="copyLink" href="#"><span>COPY LINK</span></a>
      </div>
    </div>`;

  const wrapperDiv = document.createElement("div");
  wrapperDiv.className = "sidebar-wrapper";
  wrapperDiv.appendChild(controlDiv);
  document.body.appendChild(wrapperDiv);

  // Ensure loader exists if not in HTML
  if (!document.getElementById("loader")) {
    const loader = document.createElement("div");
    loader.id = "loader";
    loader.style.display = "none";
    loader.style.position = "absolute";
    loader.style.inset = "0";
    loader.style.alignItems = "center";
    loader.style.justifyContent = "center";
    loader.style.zIndex = "3";
    loader.style.background = "rgba(255,255,255,0.45)";
    loader.innerHTML = `<div style="padding:10px 14px;border-radius:10px;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.1);font-weight:600">Computing route…</div>`;
    document.body.appendChild(loader);
  }

  const placesListDiv = controlDiv.querySelector("#placesList");

  // Add markers + checkboxes
  places.forEach((p, i) => {
    const marker = new google.maps.Marker({
      position: { lat: p.lat, lng: p.lon },
      map,
      title: p.name
    });
    markers.push(marker);

    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = i;
    cb.addEventListener("change", (e) => {
      if (!e.target.checked) markers[i].setLabel(null);
    });

    label.appendChild(cb);
    label.appendChild(document.createTextNode(" " + p.name));
    placesListDiv.appendChild(label);
  });

  // Initial fit (once), then padding-only on resize
  const bounds = new google.maps.LatLngBounds();
  places.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lon }));
  if (!didInitialFit) {
    fitBoundsResponsive(bounds);
    didInitialFit = true;
  }
  activeBounds = bounds;
  applyResponsivePadding();

  // Footer actions
  const computeBtn = controlDiv.querySelector("#computeBtn");
  const copyLink = controlDiv.querySelector("#copyLink");
  const gmapLink = controlDiv.querySelector("#gmapLink");
  const footer = controlDiv.querySelector(".panel-footer");

  computeBtn.addEventListener("click", async () => {
    await computeRouteByDistance();

    if (!hasExpanded) {
      footer.classList.add("computed");
      hasExpanded = true;
    }
  });

  copyLink.addEventListener("click", (e) => {
    e.preventDefault();
    if (gmapLink.href && gmapLink.href !== "#") {
      navigator.clipboard.writeText(gmapLink.href).then(() => {
        alert("Route link copied!");
      });
    } else {
      alert("No route to copy yet.");
    }
  });

  // On resize: adjust padding only, never re-fit
  window.addEventListener("resize", applyResponsivePadding);
}
window.initMap = initMap;

/* ---------------- Distance matrix + route build (legacy DM OK for now) ---------------- */
async function getDistanceMatrixChunked(selected) {
  const service = new google.maps.DistanceMatrixService();
  const n = selected.length;
  let matrix = Array.from({ length: n }, () => new Array(n).fill(Infinity));

  for (let i = 0; i < n; i++) {
    const origins = [{ lat: selected[i].lat, lng: selected[i].lon }];
    const destinations = selected.map(p => ({ lat: p.lat, lng: p.lon }));

    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve, reject) => {
      service.getDistanceMatrix(
        { origins, destinations, travelMode: google.maps.TravelMode.DRIVING },
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
  let order = [0];
  visited[0] = true;
  for (let i = 1; i < n; i++) {
    let last = order[order.length - 1];
    let next = -1;
    let minDist = Infinity;
    for (let j = 0; j < n; j++) {
      if (!visited[j] && distMatrix[last][j] < minDist) {
        minDist = distMatrix[last][j];
        next = j;
      }
    }
    order.push(next);
    visited[next] = true;
  }
  return order;
}

async function computeRouteByDistance() {
  showLoader(true);
  const selected = [];
  document.querySelectorAll("#placesList input:checked").forEach((cb) => {
    selected.push(places[parseInt(cb.value, 10)]);
  });
  if (selected.length < 2) {
    alert("Select at least 2 places.");
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
      { origin, destination, waypoints, optimizeWaypoints: false, travelMode: google.maps.TravelMode.DRIVING },
      async (result, status) => {
        showLoader(false);
        if (status === "OK") {
          directionsRenderer.setDirections(result);

          // Reset marker labels
          markers.forEach(m => m.setLabel(null));

          // Numbered labels on markers
          orderedPlaces.forEach((p, num) => {
            const markerIndex = places.findIndex(pp => pp.name === p.name);
            if (markerIndex !== -1) {
              markers[markerIndex].setLabel({
                text: `${num + 1}. ${p.name}`,
                color: "#fff",
                fontSize: "12px",
                fontWeight: "bold"
              });

              markers[markerIndex].addListener("click", () => {
                const infoWindow = new google.maps.InfoWindow({
                  content: `<strong>${num + 1}. ${p.name}</strong>`
                });
                infoWindow.open(map, markers[markerIndex]);
              });
            }
          });

          // A) Route bounds from result (tight to polyline)
          let routeBounds = null;
          if (result && result.routes && result.routes[0] && result.routes[0].bounds) {
            routeBounds = result.routes[0].bounds;
          }

          // B) Marker bounds from selected places (covers all stops)
          const markerBounds = (() => {
            const b = new google.maps.LatLngBounds();
            orderedPlaces.forEach((p) => b.extend({ lat: p.lat, lng: p.lon }));
            return b;
          })();

          // C) Choose "min" (tighter) or "max" (union), then add buffer in meters
          const chosen = chooseAndBufferBounds({
            routeBounds,
            markerBounds,
            mode: BOUNDS_MODE,
            bufferMeters: BOUNDS_BUFFER_M
          });

          activeBounds = chosen;

          // Zoom/fit: on first route OR if selection changed, refit (zoom in/out). Otherwise keep zoom.
          if (!didRouteFit || selKey !== lastSelectionKey) {
            fitBoundsResponsive(activeBounds);
            didRouteFit = true;
          } else {
            applyResponsivePadding();
          }
          lastSelectionKey = selKey;

          // 🔗 Build Google Maps link using **googleMapsPlaceId** so names appear
          await ensurePlaceIds(orderedPlaces);

          const toParam = (p) =>
            p.googleMapsPlaceId ? `place_id:${p.googleMapsPlaceId}` : `${p.lat},${p.lon}`;

          const originParam = toParam(orderedPlaces[0]);
          const destParam = toParam(orderedPlaces.at(-1));
          const waypointsParam = orderedPlaces.slice(1, -1).map(toParam).join("|");

          let gmapUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originParam)}&destination=${encodeURIComponent(destParam)}`;
          if (waypointsParam) gmapUrl += `&waypoints=${encodeURIComponent(waypointsParam)}`;
          gmapUrl += "&travelmode=driving";

          const gmapLink = document.getElementById("gmapLink");
          if (gmapLink) {
            gmapLink.href = gmapUrl;
            gmapLink.style.display = "inline-flex";
          }
          const footer = document.querySelector(".panel-footer");
          if (footer) footer.classList.add("computed");

        } else {
          alert("Directions request failed: " + status);
        }
      }
    );
  } catch (err) {
    showLoader(false);
    alert("Error building distance matrix: " + err);
  }
}

/* ---------------- Loader ---------------- */
function showLoader(show) {
  const el = document.getElementById("loader");
  if (el) el.style.display = show ? "flex" : "none";
}
