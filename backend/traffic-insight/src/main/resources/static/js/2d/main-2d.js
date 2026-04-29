import { initMap2D, changeMapStyle2D } from './map-2d.js';
import { RoutePlanner2D } from './route-planner-2d.js';
import { loadBusLines } from '../core/data-loader.js';
import { renderRoutes, renderStops } from './layers-2d.js';
import { BusAnimator2D } from './animator-2d.js';
import { showTooltip, hideTooltip } from './ui-2d.js';
import { TrafficStyler } from '../core/TrafficStyler.js';
import { SINGLE_DIRECTION_LINES } from '../3d/single_direction_line.js';

const DEBUG = false;

// ─── Global state ─────────────────────────────────────────────────────────────
let map;
let routesLayer;
let stopsLayer;

let currentMapStyle    = 'voyager';
let trafficDataMap     = {};
let currentHour        = 8;
let currentLine        = '';
let currentRoutes      = [];
let currentStops       = [];
let currentRouteGroup  = null;
let hasTwoDirections   = false;
let selectedDirection  = null; // null = auto cycle, '0' or '1' = fixed
let busAnimator        = null;
let isSimulationRunning = false;
let routePlanner2D      = null;
let linesByConsortium  = {};

// Maps consortium keys to display names
const CONSORTIUM_LABELS = {
    'internorte':   'Internorte',
    'intersul':     'Intersul',
    'transcarioca': 'Transcarioca',
    'santa_cruz':   'Santa Cruz',
    'mobi_rio':     'MobiRio'
};

// ─── DOM element cache ────────────────────────────────────────────────────────
let hourSlider, hourDisplay, consortiumSelect, lineSelect;
let routeCountEl, stopCountEl, applyBtn, resetBtn;

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    if (DEBUG) console.log('Initializing SmartTrafficFlow 2D');

    cacheDOMElements();

    const mapContainer = document.getElementById('map');
    if (!mapContainer) { console.error('Map container #map not found'); return; }

    await new Promise(resolve => requestAnimationFrame(resolve));

    try {
        map = await initMap2D();
        routesLayer = L.layerGroup().addTo(map);
        stopsLayer  = L.layerGroup().addTo(map);

        // Create animator with callbacks
        busAnimator = new BusAnimator2D(map, {
            onStopReached:     (stop) => showStopBanner(stop.name),
            onComplete:        () => {
                isSimulationRunning = false;
                resetSimulationButton();
                updateFollowButtonState(false);
                hideTooltip();
            },
            onDirectionSwitch: async (nextDir) => {
                await startBusAnimation(nextDir, true);
            },
            onFollowChanged: (following) => {
                updateFollowButtonState(following);
            }
        });

        // Initialize route planner
        routePlanner2D = new RoutePlanner2D(map, {
            getCurrentHour:  () => currentHour,
            onRouteSelected: async (route) => {
                currentLine       = route.lineId;
                selectedDirection = route.direction;

                busAnimator.stop();
                currentRouteGroup = null;
                hasTwoDirections  = false;
                currentStops      = [];
                isSimulationRunning = false;
                resetSimulationButton();

                const dirControls = document.getElementById('directionControls');
                if (dirControls) dirControls.style.display = 'flex';

                lineSelect.value = route.lineId;
                await loadTrafficData(currentHour, currentLine);
                const dirIndex = parseInt(route.direction) || 0;
                await startBusAnimation(dirIndex, false);

                // Reset Find Route button
                const btn = document.getElementById('findRouteBtn2D');
                if (btn) { btn.textContent = '🗺️ Find Route'; btn.style.background = '#8e44ad'; }

                // Clear planner state
                if (routePlanner2D) {
                    routePlanner2D.isSelecting = false;
                    routePlanner2D.pointA      = null;
                    routePlanner2D.pointB      = null;
                }
            },
            onClear: () => {
                const btn = document.getElementById('findRouteBtn2D');
                if (btn) { btn.textContent = '🗺️ Find Route'; btn.style.background = '#8e44ad'; }
            }
        });

        await loadBusLinesDropdown();
        await loadConsortiumData();
        setupEventListeners();
        await loadTrafficData(currentHour, '');
        await loadInsights();

        if (DEBUG) console.log('SmartTrafficFlow 2D initialized');
    } catch (err) {
        console.error('Failed to initialize map:', err);
        document.getElementById('map').innerHTML = `
            <div style="padding:20px;text-align:center;color:#e74c3c">
                <strong>Map failed to load</strong><br/>
                <small>${err.message}</small><br/>
                <button onclick="location.reload()" style="margin-top:10px;padding:8px 16px">Retry</button>
            </div>`;
    }
});

/**
 * Shows a centered stop name banner over the map area.
 * Fades in and auto-hides after STOP_PAUSE_MS.
 * @param {string} stopName
 */
function showStopBanner(stopName) {
    let banner = document.getElementById('stopBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'stopBanner';
        banner.style.cssText = `
            position: fixed;
            top: 24px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(30,30,30,0.92);
            color: #fff;
            padding: 8px 20px;
            border-radius: 20px;
            font-size: 14px;
            font-weight: 600;
            pointer-events: none;
            z-index: 9999;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            transition: opacity 0.2s ease;
            white-space: nowrap;
        `;
        document.body.appendChild(banner);
    }
    banner.textContent = `🚏 ${stopName}`;
    banner.style.opacity = '1';
    banner.style.display = 'block';

    clearTimeout(banner._hideTimer);
    banner._hideTimer = setTimeout(() => {
        banner.style.opacity = '0';
        setTimeout(() => { banner.style.display = 'none'; }, 200);
    }, 2200);
}

function cacheDOMElements() {
    hourSlider       = document.getElementById('hourRange');
    hourDisplay      = document.getElementById('hourDisplay');
    consortiumSelect = document.getElementById('consortiumSelect');
    lineSelect       = document.getElementById('lineSelect');
    routeCountEl     = document.getElementById('routeCount');
    stopCountEl      = document.getElementById('stopCount');
    applyBtn         = document.getElementById('applyBtn');
    resetBtn         = document.getElementById('resetBtn');
}

// ─── Bus lines dropdown ───────────────────────────────────────────────────────
async function loadBusLinesDropdown() {
    try {
        const lines = await loadBusLines();
        lines.forEach(line => {
            const opt = document.createElement('option');
            opt.value = line;
            opt.textContent = `Line ${line}`;
            lineSelect.appendChild(opt);
        });
        // Store full list for consortium filtering
        lineSelect.__allLines = lines;
        if (DEBUG) console.log(`${lines.length} lines loaded`);
    } catch (err) {
        console.error('Error loading lines:', err);
    }
}

// ─── Consortium filter ────────────────────────────────────────────────────────
async function loadConsortiumData() {
    try {
        const res = await fetch(`/api/traffic/status-by-hour?hour=${currentHour}`);
        if (!res.ok) return;
        const data = await res.json();

        linesByConsortium = {};
        data.forEach(({ routeId, consortium }) => {
            if (!consortium) return;
            const key = consortium.toLowerCase();
            if (!linesByConsortium[key]) linesByConsortium[key] = [];
            if (!linesByConsortium[key].includes(routeId)) linesByConsortium[key].push(routeId);
        });

        Object.keys(linesByConsortium).forEach(k => linesByConsortium[k].sort());

        const sel = document.getElementById('consortiumSelect');
        if (!sel) return;
        sel.innerHTML = '<option value="">-- All Consortiums --</option>';
        Object.keys(CONSORTIUM_LABELS).forEach(key => {
            if (!linesByConsortium[key]) return;
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = `${CONSORTIUM_LABELS[key]} (${linesByConsortium[key].length})`;
            sel.appendChild(opt);
        });
    } catch (err) {
        console.error('Error loading consortium data:', err);
    }
}

function filterLinesByConsortium(consortiumKey) {
    const allLines = lineSelect.__allLines || [];
    lineSelect.innerHTML = '<option value="">-- All Lines --</option>';
    const linesToShow = consortiumKey && linesByConsortium[consortiumKey]
        ? allLines.filter(l => linesByConsortium[consortiumKey].includes(l))
        : allLines;
    linesToShow.forEach(line => {
        const opt = document.createElement('option');
        opt.value = line;
        opt.textContent = `Line ${line}`;
        lineSelect.appendChild(opt);
    });
}

// ─── Stop loading for a specific direction ────────────────────────────────────
async function loadStopsForDirection(line, direction) {
    try {
        const res = await fetch(`/api/traffic/stops-by-line?line=${line}&direction=${direction}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return data.map(stop => ({
            position: [stop.lng, stop.lat],
            name:     stop.stop_name || stop.name || 'Stop',
            id:       stop.stop_id   || stop.id,
            code:     stop.stop_code || stop.code || ''
        }));
    } catch (err) {
        console.error(`Error loading stops for direction ${direction}:`, err);
        return [];
    }
}

// ─── Start / restart bus animation ───────────────────────────────────────────
async function startBusAnimation(directionIndex, autoStart = false) {
    busAnimator.stop();
    isSimulationRunning = autoStart;

    if (!currentLine || !currentRouteGroup) return;

    const directions = Object.keys(currentRouteGroup.directions);
    const dirKey     = directions[directionIndex % directions.length];

    if (DEBUG) console.log(`Starting animation — line ${currentLine} direction ${dirKey} (index ${directionIndex})`);

    // Load stops for this direction
    const stops = await loadStopsForDirection(currentLine, dirKey);
    currentStops = stops;
    if (stopCountEl) stopCountEl.textContent = currentStops.length;

    // Re-render stops on map
    stopsLayer.clearLayers();
    renderStops(currentStops, stopsLayer, {
        onHover:    (stop, x, y) => showTooltip(`Stop: ${stop.name}`, x, y),
        onHoverEnd: hideTooltip
    });

    // Prepare animator (positions bus at first stop without moving)
    busAnimator.prepare(currentRouteGroup, hasTwoDirections, currentLine, currentStops, directionIndex);

    if (autoStart) {
        busAnimator.start();
        updateSimulationButton(true);
    }
}

// ─── Simulation button helpers ────────────────────────────────────────────────
function updateSimulationButton(running) {
    const btn = document.getElementById('startSimBtn');
    if (!btn) return;
    isSimulationRunning = running;
    btn.textContent = running ? '⏸ Pause Simulation' : '▶ Start Simulation';
    btn.style.background = running ? '#c0392b' : '#e67e22';
}

function resetSimulationButton() {
    updateSimulationButton(false);
}

// ─── Follow Bus Button ────────────────────────────────────────────────────────
function updateFollowButtonState(following) {
    const btn = document.getElementById('followBusBtn');
    if (!btn) return;
    if (following) {
        btn.textContent = '🎯 Following';
        btn.style.background = '#1abc9c';
        btn.classList.add('active');
    } else {
        btn.textContent = '🎯 Follow Bus';
        btn.style.background = '#16a085';
        btn.classList.remove('active');
    }
}

// ─── Insights ─────────────────────────────────────────────────────────────────
async function loadInsights() {
    try {
        const [levelsRes, statusRes] = await Promise.all([
            fetch('/api/traffic/summary/levels'),
            fetch(`/api/traffic/status-by-hour?hour=${currentHour}`)
        ]);
        if (levelsRes.ok)  renderLevelBars(await levelsRes.json());
        if (statusRes.ok)  renderTopCongested(await statusRes.json());
    } catch (err) {
        console.error('Error loading insights:', err);
    }
}

function renderLevelBars(levels) {
    const container = document.getElementById('levelBars2D');
    if (!container) return;
    const total  = levels.reduce((sum, [, c]) => sum + c, 0);
    if (!total) return;
    const colors = { low: '#2ecc71', medium: '#f1c40f', high: '#e67e22', congested: '#e74c3c' };
    const order  = ['congested', 'high', 'medium', 'low'];
    const sorted = order.map(l => levels.find(([n]) => n === l)).filter(Boolean);
    container.innerHTML = sorted.map(([name, count]) => {
        const pct   = ((count / total) * 100).toFixed(1);
        const color = colors[name] || '#999';
        const label = name.charAt(0).toUpperCase() + name.slice(1);
        return `
            <div class="insight-bar-row">
                <span class="insight-bar-label">${label}</span>
                <div class="insight-bar-track">
                    <div class="insight-bar-fill" style="width:${pct}%;background:${color}"></div>
                </div>
                <span class="insight-bar-pct">${pct}%</span>
            </div>`;
    }).join('');
}

function renderTopCongested(status) {
    const container = document.getElementById('topCongested2D');
    if (!container) return;
    const congested = status
        .filter(s => s.trafficLevel === 'congested')
        .sort((a, b) => parseFloat(a.avgSpeed) - parseFloat(b.avgSpeed))
        .slice(0, 5);
    if (!congested.length) {
        container.innerHTML = '<p class="insight-empty">No congested lines at this hour.</p>';
        return;
    }
    container.innerHTML = congested.map((s, i) => `
        <div class="insight-route-row">
            <span class="insight-rank">#${i + 1}</span>
            <span class="insight-route-id">${s.routeId.toUpperCase()}</span>
            <span class="insight-consortium">${CONSORTIUM_LABELS[s.consortium] || s.consortium}</span>
            <span class="insight-speed">${parseFloat(s.avgSpeed).toFixed(1)} km/h</span>
        </div>`).join('');
}

// ─── Traffic data loader ──────────────────────────────────────────────────────
async function loadTrafficData(hour, line = '') {
    routesLayer.clearLayers();
    stopsLayer.clearLayers();
    trafficDataMap = {};

    try {
        const statusRes = await fetch(`/api/traffic/status-by-hour?hour=${hour}`);
        if (statusRes.ok) {
            (await statusRes.json()).forEach(item => { trafficDataMap[item.routeId] = item; });
        }

        let url = `/api/traffic/routes?hour=${hour}`;
        if (line) url += `&line=${line}`;

        const geoData = await (await fetch(url)).json();
        if (!geoData.features?.length) {
            if (routeCountEl) routeCountEl.textContent = '0';
            if (stopCountEl)  stopCountEl.textContent  = '0';
            return;
        }

        const routesByService = {};
        geoData.features.forEach(feature => {
            const { servico, direcao, destino } = feature.properties;
            const trafficInfo        = trafficDataMap[servico];
            const normalizedServico  = servico.toLowerCase();
            if (feature.geometry.type !== 'LineString') return;
            if (!routesByService[normalizedServico]) {
                routesByService[normalizedServico] = { lineId: normalizedServico, directions: {} };
            }
            routesByService[normalizedServico].directions[direcao] = {
                path:         feature.geometry.coordinates,
                color:        trafficInfo ? TrafficStyler.getColorHex(trafficInfo.trafficLevel) : '#95a5a6',
                weight:       trafficInfo?.trafficLevel === 'congested' ? 6 :
                    trafficInfo?.trafficLevel === 'high'      ? 5 : 4,
                destination:  destino,
                trafficLevel: trafficInfo?.trafficLevel
            };
        });

        let paths = Object.values(routesByService);

        if (line) {
            paths = paths.filter(p => p.lineId === line.toLowerCase());
            if (paths.length > 0) {
                currentRouteGroup = paths[0];
                hasTwoDirections  = Object.keys(currentRouteGroup.directions).length >= 2;
                if (DEBUG) console.log(`Line ${line}: two-way=${hasTwoDirections}`);
            }
        } else {
            currentRouteGroup = paths[0] || null;
            hasTwoDirections  = currentRouteGroup
                ? Object.keys(currentRouteGroup.directions).length >= 2
                : false;
        }

        currentRoutes = renderRoutes(paths, trafficDataMap, line, routesLayer);
        if (routeCountEl) routeCountEl.textContent = paths.length;

        if (line && line === currentLine && currentRouteGroup) {
            // Re-position bus at first stop without starting
            await startBusAnimation(0, false);
        } else {
            currentStops = [];
            if (stopCountEl) stopCountEl.textContent = '0';
        }

        if (line && routesLayer.getLayers().length > 0) {
            map.fitBounds(L.featureGroup(routesLayer.getLayers()).getBounds(), { padding: [50, 50] });
        }

    } catch (err) {
        console.error('Error loading traffic data:', err);
    }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

// ─── Geolocation ──────────────────────────────────────────────────────────
function locateUser() {
    const btn = document.getElementById('locateUserBtn');
    if (!navigator.geolocation) {
        if (btn) btn.textContent = '❌ Not supported';
        return;
    }
    if (btn) btn.textContent = '⏳ Locating...';
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            if (btn) btn.textContent = '📍 My Location';

            // Fly to user position
            map.setView([lat, lng], 15, { animate: true });

            // Add marker
            const userIcon = L.divIcon({
                className: '',
                html: '<div style="width:16px;height:16px;background:#2980b9;border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 3px rgba(41,128,185,0.4);"></div>',
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            });

            if (window._userLocationMarker) {
                window._userLocationMarker.setLatLng([lat, lng]);
            } else {
                window._userLocationMarker = L.marker([lat, lng], {
                    icon: userIcon,
                    zIndexOffset: 900,
                    interactive: false
                }).addTo(map);
            }

            // Pre-fill point A in route planner
            if (routePlanner2D) {
                routePlanner2D.pointA = { lat, lng };
                routePlanner2D._clearMarker('A');
                routePlanner2D._placeMarker('A', lat, lng);
                const inA = document.getElementById('rpInputA');
                if (inA) inA.value = 'My Location';
            }
        },
        (err) => {
            if (btn) btn.textContent = '❌ ' + err.message;
            setTimeout(() => { if (btn) btn.textContent = '📍 My Location'; }, 3000);
        },
        { enableHighAccuracy: true, timeout: 8000 }
    );
}

function setupEventListeners() {
    // Hour slider
    let debounce;
    hourSlider.addEventListener('input', e => {
        const h = parseInt(e.target.value);
        hourDisplay.textContent = `${h.toString().padStart(2, '0')}:00`;
        clearTimeout(debounce);
        debounce = setTimeout(async () => {
            currentHour = h;
            if (routePlanner2D) routePlanner2D.setHour(h);
            await loadTrafficData(currentHour, currentLine);
            await loadInsights();
            await loadConsortiumData();
        }, 200);
    });

    // Consortium select
    consortiumSelect?.addEventListener('change', e => {
        filterLinesByConsortium(e.target.value);
        // Reset line selection
        lineSelect.value = '';
        currentLine      = '';
        busAnimator.stop();
        resetSimulationButton();
        selectedDirection = null;
        currentRouteGroup = null;
        document.getElementById('directionControls').style.display = 'none';
        (document.getElementById('followBusBtn') || {style:{}}).style.display = 'none';
        if (routePlanner2D) {
            routePlanner2D.deactivate();
            routePlanner2D.pointA = null;
            routePlanner2D.pointB = null;
        }
        const findBtn = document.getElementById('findRouteBtn2D');
        if (findBtn) { findBtn.textContent = '🗺️ Find Route'; findBtn.style.background = '#8e44ad'; }
        hideTooltip();
    });

    // Line select
    lineSelect.addEventListener('change', async () => {
        currentLine       = lineSelect.value;
        selectedDirection = null;
        busAnimator.stop();
        resetSimulationButton();
        currentRouteGroup = null;
        hasTwoDirections  = false;

        // Clear route planner markers when user manually selects a line
        if (routePlanner2D) {
            routePlanner2D._clearMarkers();
            routePlanner2D._clearABLine();
            routePlanner2D.pointA    = null;
            routePlanner2D.pointB    = null;
            routePlanner2D.isSelecting = false;
        }
        const findBtn = document.getElementById('findRouteBtn2D');
        if (findBtn) {
            findBtn.textContent     = '🗺️ Find Route';
            findBtn.style.background = '#8e44ad';
        }

        const dirControls = document.getElementById('directionControls');
        dirControls.style.display = currentLine ? 'flex' : 'none';
        const followBtnLine = document.getElementById('followBusBtn');
        if (followBtnLine) followBtnLine.style.display = currentLine ? 'block' : 'none';

        if (currentLine) {
            await loadTrafficData(currentHour, currentLine);
        } else {
            stopsLayer.clearLayers();
            currentStops = [];
            if (stopCountEl) stopCountEl.textContent = '0';
            await loadTrafficData(currentHour, '');
        }
    });

    // Outbound button
    document.getElementById('direction0Btn')?.addEventListener('click', async () => {
        selectedDirection    = '0';
        const wasRunning     = isSimulationRunning;
        if (DEBUG) console.log('Direction set: Outbound (0)');
        await startBusAnimation(0, wasRunning);
        if (wasRunning) updateSimulationButton(true);
    });

    // Return button
    document.getElementById('direction1Btn')?.addEventListener('click', async () => {
        selectedDirection    = '1';
        const wasRunning     = isSimulationRunning;
        if (DEBUG) console.log('Direction set: Return (1)');
        await startBusAnimation(1, wasRunning);
        if (wasRunning) updateSimulationButton(true);
    });

    // Start / Pause simulation button
    document.getElementById('startSimBtn')?.addEventListener('click', () => {
        if (!currentLine || !currentRouteGroup) return;

        if (isSimulationRunning) {
            busAnimator.pause();
            updateSimulationButton(false);
            hideTooltip();
        } else {
            // Resume from current stop — if at end, restart from stop 0
            if (busAnimator.currentStopIndex >= busAnimator.stops.length) {
                busAnimator.currentStopIndex = 0;
                busAnimator.isWaitingAtEnd   = false;
            }
            busAnimator.isWaitingAtStop = false;
            busAnimator.start();
            updateSimulationButton(true);
            updateFollowButtonState(busAnimator.followCamera);
        }
    });

    // Apply / Update map
    document.getElementById('locateUserBtn')?.addEventListener('click', () => locateUser());

    applyBtn.addEventListener('click', () => loadTrafficData(currentHour, currentLine));

    // Reset view
    resetBtn.addEventListener('click', () => {
        hourSlider.value     = 8;
        hourDisplay.textContent = '08:00';
        consortiumSelect.value  = '';
        lineSelect.value        = '';
        currentHour             = 8;
        currentLine             = '';
        selectedDirection       = null;

        busAnimator.stop();
        resetSimulationButton();
        currentRouteGroup = null;
        hasTwoDirections  = false;
        document.getElementById('directionControls').style.display = 'none';
        (document.getElementById('followBusBtn') || {style:{}}).style.display = 'none';
        if (routePlanner2D) {
            routePlanner2D.deactivate();
            routePlanner2D.pointA = null;
            routePlanner2D.pointB = null;
        }
        const findBtn = document.getElementById('findRouteBtn2D');
        if (findBtn) { findBtn.textContent = '🗺️ Find Route'; findBtn.style.background = '#8e44ad'; }
        hideTooltip();

        map.setView([-22.9068, -43.1729], 11);
        loadTrafficData(8, '');
    });

    // Follow Bus button
    document.getElementById('followBusBtn')?.addEventListener('click', () => {
        if (!busAnimator?.marker) return;
        if (busAnimator.followCamera) {
            busAnimator.disableFollow();
        } else {
            busAnimator.enableFollow();
            const pos = busAnimator.marker.getLatLng();
            map.panTo(pos, { animate: true });
        }
    });

    // Find Route button
    document.getElementById('findRouteBtn2D')?.addEventListener('click', () => {
        const btn = document.getElementById('findRouteBtn2D');
        if (!routePlanner2D) return;

        if (routePlanner2D.isSelecting) {
            routePlanner2D.deactivate();
            btn.textContent      = '🗺️ Find Route';
            btn.style.background = '#8e44ad';
        } else {
            if (isSimulationRunning) {
                busAnimator.pause();
                updateSimulationButton(false);
            }
            routePlanner2D.activate();
            btn.textContent      = '✕ Cancel';
            btn.style.background = '#c0392b';
        }
    });

    // Map style toggle
    let styleDebounce;
    document.getElementById('mapStyleToggle')?.addEventListener('click', () => {
        if (styleDebounce) clearTimeout(styleDebounce);
        styleDebounce = setTimeout(() => {
            currentMapStyle = currentMapStyle === 'voyager' ? 'dark' : 'voyager';
            changeMapStyle2D(map, currentMapStyle);
            const btn = document.getElementById('mapStyleToggle');
            if (btn) btn.textContent = currentMapStyle === 'voyager' ? '🌙 Dark Mode' : '☀️ Light Mode';
            // Toggle dark-mode class on body — controls panel CSS reacts to this
            document.body.classList.toggle('dark-mode', currentMapStyle === 'dark');
        }, 150);
    });
}



