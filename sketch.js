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

let map, directionsService, directionsRenderer;
let markers = [];

// --- Initialize map ---
function initMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    zoom: 13,
    center: { lat: 23.0353928, lng: 72.4947591 },
    gestureHandling: "greedy",
    mapTypeControl: false,
    fullscreenControl: false,
    streetViewControl: false,
    zoomControl: false,
    // ✅ If you have a Map ID with custom styling, add here:
    mapId: "ceb937821bc6d1ab66996a44"
  });

  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({
    map,
    suppressMarkers: true,
    polylineOptions: { strokeColor: "#9D2C21", strokeWeight: 5 }
  });

  // Sidebar UI
  const controlDiv = document.createElement("div");
  controlDiv.className = "places-control";
  controlDiv.innerHTML = `
    <div id="placesList"></div>
    <button id="computeBtn">Curate Route</button>
    <a id="gmapLink" href="#" target="_blank" style="display:none;">Open in Google Maps</a>
    <a id="copyLink" href="#" style="display:none;">Copy Route Link</a>
  `;
  map.controls[google.maps.ControlPosition.RIGHT_TOP].push(controlDiv);

  const placesListDiv = controlDiv.querySelector("#placesList");

  // Add markers + checkboxes
  const bounds = new google.maps.LatLngBounds();
  places.forEach((p, i) => {
    const marker = new google.maps.Marker({
      position: { lat: p.lat, lng: p.lon },
      map,
      title: p.name
    });
    markers.push(marker);
    bounds.extend({ lat: p.lat, lng: p.lon });

    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = i;
    cb.addEventListener("change", (e) => {
      if (!e.target.checked) marker.setLabel(null);
    });

    label.appendChild(cb);
    label.appendChild(document.createTextNode(" " + p.name));
    placesListDiv.appendChild(label);
  });

  // Fit bounds & shift left for sidebar
  map.fitBounds(bounds);
  map.panBy(-150, 0);

  controlDiv.querySelector("#computeBtn").addEventListener("click", computeRouteByDistance);
}
window.initMap = initMap;

// --- Distance-based route computation ---
async function computeRouteByDistance() {
  showLoader(true);
  const selected = [];
  document.querySelectorAll("#placesList input:checked").forEach((cb) => {
    selected.push(places[parseInt(cb.value)]);
  });
  if (selected.length < 2) {
    alert("Select at least 2 places.");
    showLoader(false);
    return;
  }

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
      (result, status) => {
        showLoader(false);
        if (status === "OK") {
          directionsRenderer.setDirections(result);

          // Reset markers
          markers.forEach(m => m.setLabel(null));
          const infoWindow = new google.maps.InfoWindow();

          // Numbered markers + info window
          orderedPlaces.forEach((p, num) => {
            const markerIndex = places.findIndex(pp => pp.name === p.name);
            markers[markerIndex].setLabel({
              text: String(num + 1),
              color: "#fff",
              fontSize: "12px",
              fontWeight: "bold"
            });
            markers[markerIndex].addListener("click", () => {
              infoWindow.setContent(`<strong>${num + 1}. ${p.name}</strong>`);
              infoWindow.open(map, markers[markerIndex]);
            });
          });

          // Google Maps link
          const originStr = `${orderedPlaces[0].lat},${orderedPlaces[0].lon}`;
          const destStr = `${orderedPlaces.at(-1).lat},${orderedPlaces.at(-1).lon}`;
          const waypointsStr = orderedPlaces.slice(1, -1).map(p => `${p.lat},${p.lon}`).join("|");
          let gmapUrl = `https://www.google.com/maps/dir/?api=1&origin=${originStr}&destination=${destStr}`;
          if (waypointsStr) gmapUrl += `&waypoints=${waypointsStr}`;
          gmapUrl += "&travelmode=driving";

          const gmapLink = document.getElementById("gmapLink");
          gmapLink.href = gmapUrl;
          gmapLink.style.display = "block";

          // ✅ Copy link button
          const copyLink = document.getElementById("copyLink");
          copyLink.style.display = "block";
          copyLink.onclick = (e) => {
            e.preventDefault();
            navigator.clipboard.writeText(gmapUrl).then(() => {
              copyLink.textContent = "Copied!";
              setTimeout(() => (copyLink.textContent = "Copy Route Link"), 1500);
            });
          };

          // Fit bounds again after route
          const bounds = new google.maps.LatLngBounds();
          orderedPlaces.forEach(p => bounds.extend({ lat: p.lat, lng: p.lon }));
          map.fitBounds(bounds);
          map.panBy(-150, 0);
        } else alert("Directions request failed: " + status);
      }
    );
  } catch (err) {
    showLoader(false);
    alert("Error building distance matrix: " + err);
  }
}

// --- Distance Matrix in chunks ---
async function getDistanceMatrixChunked(selected) {
  const service = new google.maps.DistanceMatrixService();
  const n = selected.length;
  let matrix = Array.from({ length: n }, () => new Array(n).fill(Infinity));

  for (let i = 0; i < n; i++) {
    const origins = [{ lat: selected[i].lat, lng: selected[i].lon }];
    const destinations = selected.map(p => ({ lat: p.lat, lng: p.lon }));

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

// --- Nearest-neighbor heuristic ---
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

// --- Loader ---
function showLoader(show) {
  document.getElementById("loader").style.display = show ? "flex" : "none";
}

