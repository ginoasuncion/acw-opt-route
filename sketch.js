// sketch.js

// --- Define places ---
const places = [
  {
    "name": "079 | Stories",
    "lat": 23.0353928,
    "lon": 72.4947591
  },
  {
    "name": "Archer Art Gallery",
    "lat": 23.04166188,
    "lon": 72.55184877
  },
  {
    "name": "Arthshila Ahmedabad",
    "lat": 23.029595,
    "lon": 72.5372661
  },
  {
    "name": "Basera",
    "lat": 23.03008,
    "lon": 72.57936
  },
  {
    "name": "Conflictorium",
    "lat": 23.03534,
    "lon": 72.58649
  },
  {
    "name": "Darpana Academy",
    "lat": 23.0477,
    "lon": 72.57277
  },
  {
    "name": "Hutheesing Visual Art Centre",
    "lat": 23.03724,
    "lon": 72.54969
  },
  {
    "name": "Iram Art Gallery",
    "lat": 23.02874,
    "lon": 72.49185
  },
  {
    "name": "Kanoria Centre for Arts",
    "lat": 23.0375,
    "lon": 72.54908
  },
  {
    "name": "Kasturbhai Lalbhai Museum",
    "lat": 23.05223,
    "lon": 72.59307
  },
  {
    "name": "LD Museum Director Bunglow",
    "lat": 23.03422,
    "lon": 72.55094
  },
  {
    "name": "Mehnat Manzil: Museum of Work",
    "lat": 22.99835,
    "lon": 72.53732
  },
  {
    "name": "Samara Art Gallery",
    "lat": 23.04347,
    "lon": 72.55721
  },
  {
    "name": "Shreyas Foundation",
    "lat": 23.01436,
    "lon": 72.53993
  },
  {
    "name": "Studio Sangath / Vastushilpa Sangath LLP",
    "lat": 23.04791,
    "lon": 72.52645
  }
];

// --- Initialize map ---
const map = L.map("map").setView([23.0353928, 72.4947591], 13);
L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://www.carto.com/">CARTO</a>',
  subdomains: "abcd",
  maxZoom: 20
}).addTo(map);

// --- Marker styles ---
function grayIcon() {
  return L.icon({
    iconUrl: "https://unpkg.com/leaflet@1.9.3/dist/images/marker-icon.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowUrl: "https://unpkg.com/leaflet@1.9.3/dist/images/marker-shadow.png"
  });
}

function blueIcon() {
  return L.icon({
    iconUrl: "https://unpkg.com/leaflet@1.9.3/dist/images/marker-icon.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowUrl: "https://unpkg.com/leaflet@1.9.3/dist/images/marker-shadow.png",
    className: "blue-marker"
  });
}

function numberedIcon(num) {
  return L.divIcon({
    className: "custom-div-icon",
    html: `<div style="
      background:#2563eb;
      color:#fff;
      border-radius:50%;
      width:24px;
      height:24px;
      display:flex;
      align-items:center;
      justify-content:center;
      font-size:12px;
      font-weight:bold;
      border:2px solid #fff;
    ">${num}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12]
  });
}

// --- Add markers + sidebar checkboxes ---
let markers = [];
let routeLayer = null;

const controlDiv = L.control({ position: "topright" });
controlDiv.onAdd = function () {
  const div = L.DomUtil.create("div", "places-control");
  div.innerHTML = `<div id="placesList"></div>
    <button id="computeBtn">Compute Route</button>
    <a id="gmapLink" href="#" target="_blank" style="display:none;">Open in Google Maps</a>`;
  return div;
};
controlDiv.addTo(map);

const placesListDiv = document.getElementById("placesList");

places.forEach((p, i) => {
  const marker = L.marker([p.lat, p.lon], { icon: grayIcon() })
    .addTo(map)
    .bindTooltip(p.name, { permanent: false, direction: "top" });

  markers.push(marker);

  const label = document.createElement("label");
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.value = i;

  cb.addEventListener("change", (e) => {
    if (e.target.checked) {
      marker.setIcon(blueIcon());
    } else {
      marker.setIcon(grayIcon());
    }
  });

  label.appendChild(cb);
  label.appendChild(document.createTextNode(" " + p.name));
  placesListDiv.appendChild(label);
});

// --- Loading spinner ---
const loader = document.createElement("div");
loader.id = "loader";
loader.innerHTML = '<div class="spinner"></div>';
document.body.appendChild(loader);

function showLoader(show) {
  loader.style.display = show ? "flex" : "none";
}

// --- Fit all markers initially with sidebar padding ---
const allBounds = places.map((p) => [p.lat, p.lon]);
map.fitBounds(allBounds, {
  paddingTopLeft: [20, 20],
  paddingBottomRight: [300, 20] // shift map left for sidebar on right
});

// --- Route computation ---
async function computeRoute() {
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

  // Clear old route
  if (routeLayer) {
    map.removeLayer(routeLayer);
  }

  // Build OSRM request
  const coords = selected.map((p) => `${p.lon},${p.lat}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (!data.routes || data.routes.length === 0) {
      alert("No route found.");
      showLoader(false);
      return;
    }

    // Draw route
    routeLayer = L.geoJSON(data.routes[0].geometry, {
      style: { color: "blue", weight: 4 }
    }).addTo(map);

    // Keep markers blue + add numbering
    selected.forEach((p, i) => {
      const idx = places.findIndex((pp) => pp.name === p.name);
      markers[idx].setIcon(numberedIcon(i + 1));
      markers[idx].bindTooltip(`${i + 1}. ${p.name}`, {
        permanent: false,
        direction: "top"
      });
    });

    // Fit map with sidebar padding
    const bounds = selected.map((p) => [p.lat, p.lon]);
    map.fitBounds(bounds, {
      paddingTopLeft: [20, 20],
      paddingBottomRight: [300, 20] // keep space for sidebar
    });

    // Google Maps link (show only after route computed)
    const origin = `${selected[0].lat},${selected[0].lon}`;
    const destination = `${selected[selected.length - 1].lat},${selected[selected.length - 1].lon}`;
    const waypoints = selected.slice(1, -1).map((p) => `${p.lat},${p.lon}`).join("|");

    let gmapUrl = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`;
    if (waypoints) gmapUrl += `&waypoints=${waypoints}`;
    gmapUrl += "&travelmode=driving";

    const gmapLink = document.getElementById("gmapLink");
    gmapLink.href = gmapUrl;
    gmapLink.style.display = "block"; // only show now
  } catch (err) {
    console.error(err);
    alert("Error fetching route.");
  }

  showLoader(false);
}

document.getElementById("computeBtn").addEventListener("click", computeRoute);

