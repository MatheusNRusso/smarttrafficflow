import { initMap, changeMapStyle, MAP_STYLES } from './map.js';
import { RoutePlanner3D } from './route-planner-3d.js';
import { loadBusLines, loadStopsByLine } from "./data.js";
import { createRouteLayer, createStopsLayer, createBusLayer} from "./layers.js";
import { showTooltip, hideTooltip } from "./ui.js";
import { SINGLE_DIRECTION_LINES } from "./single_direction_line.js";
import {TrafficStyler} from "../core/TrafficStyler.js";

const DEBUG = false;

document.addEventListener('DOMContentLoaded', () => {
    if (DEBUG) console.log("Initializing Traffic Insight");

    const { PathLayer, ScatterplotLayer, IconLayer } = deck;

    // ─── Global State ─────────────────────────────────────────────────────────
    let map;
    let overlay = null;

    let currentMapStyle = 'positron';
    let trafficDataMap = {};
    let isLoading = false;
    let currentHour = 8;
    let currentLine = "";
    let currentPaths = [];
    let currentStops = [];
    let hoveredStopId = null;

    let selectedDirection = null;
    let currentRouteGroup = null;
    let hasTwoDirections = false;
    let staticLayers = [];

    // ─── Animation state ──────────────────────────────────────────────────────
    let busAnimationId = null;
    let busPosition = null;
    let busDirectionIndex = 0;
    let busProgress = 0;

    let currentStopIndex = 0;
    let isWaitingAtStop = false;
    let isWaitingAtEnd = false;
    let moveTimer = null;

    let currentPath = null;
    let pathPointIndex = 0;

    const PATH_POINTS_PER_FRAME = 3;
    const STOP_PAUSE_MS = 2500;

    let isSimulationRunning = false;
    let followCamera = false;

    let isUpdatingCameraProgrammatically = false;

    // ─── Mobile Detection ─────────────────────────────────────────────────────
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    // ─── Smooth Camera Control State ─────────────────────────────────────────
    const CAMERA_LERP_FACTOR = isMobile ? 0.4 : 0.2;

    let routePlanner = null;
    let userLocation      = null; // { lat, lng }
    const cache = new Map();


    // ─── Geolocation ──────────────────────────────────────────────────────────
    function buildUserLocationLayer() {
        if (!userLocation) return [];
        const { ScatterplotLayer } = deck;
        return [new ScatterplotLayer({
            id: 'user-location',
            data: [{ position: [userLocation.lng, userLocation.lat, 0] }],
            getPosition: d => d.position,
            getFillColor: [41, 128, 185, 220],
            getLineColor: [255, 255, 255, 255],
            getRadius: 18,
            lineWidthMinPixels: 2,
            stroked: true,
            pickable: false,
            parameters: { depthTest: false }
        })];
    }

    function locateUser() {
        if (!navigator.geolocation) { alert('Geolocation not supported.'); return; }
        navigator.geolocation.getCurrentPosition(pos => {
                userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                map.flyTo({ center: [userLocation.lng, userLocation.lat], zoom: 14, duration: 1200 });
                if (routePlanner) {
                    routePlanner.pointA = { lat: userLocation.lat, lng: userLocation.lng };
                    routePlanner._clearMarker('A');
                    routePlanner._placeMarker('A', userLocation.lat, userLocation.lng);
                    const inA = document.getElementById('rpInputA');
                    if (inA) inA.value = 'My Location';
                }
            }, err => alert('Could not get location. Check browser permissions.'),
            { enableHighAccuracy: true, timeout: 8000 });
    }

    // ─── Helper: build fresh A→B planner layers ───────────────────────────────
    function buildPlannerLayers() {
        if (!routePlanner || !routePlanner.pointA || !routePlanner.pointB) return [];
        const { LineLayer } = deck;
        const pA     = routePlanner.pointA;
        const pB     = routePlanner.pointB;
        const midLng = (pA.lng + pB.lng) / 2;
        const midLat = (pA.lat + pB.lat) / 2;
        return [
            new LineLayer({
                id: 'route-planner-ab-outline',
                data: [
                    { src: [pA.lng, pA.lat, 100], tgt: [midLng, midLat, 100] },
                    { src: [midLng, midLat, 100], tgt: [pB.lng,  pB.lat,  100] }
                ],
                getSourcePosition: d => d.src, getTargetPosition: d => d.tgt,
                getColor: [255, 255, 255, 120], getWidth: 8, pickable: false
            }),
            new LineLayer({
                id: 'route-planner-ab-green',
                data: [{ src: [pA.lng, pA.lat, 100], tgt: [midLng, midLat, 100] }],
                getSourcePosition: d => d.src, getTargetPosition: d => d.tgt,
                getColor: [39, 174, 96, 220], getWidth: 4, pickable: false
            }),
            new LineLayer({
                id: 'route-planner-ab-line',
                data: [{ src: [midLng, midLat, 100], tgt: [pB.lng,  pB.lat,  100] }],
                getSourcePosition: d => d.src, getTargetPosition: d => d.tgt,
                getColor: [231, 76, 60, 220], getWidth: 4, pickable: false
            })
        ];
    }

    // ─── Map initialization ───────────────────────────────────────────────────
    map = initMap((loadedMap, loadedOverlay) => {
        map = loadedMap;
        overlay = loadedOverlay;

        const handleUserInteraction = () => {
            if (followCamera && !isUpdatingCameraProgrammatically) {
                followCamera = false;
                updateFollowButtonState();
                if (DEBUG) console.log('🔓 Follow disabled by user interaction');
            }
        };

        map.on('dragstart', handleUserInteraction);
        map.on('zoomstart', handleUserInteraction);
        map.on('pitchstart', handleUserInteraction);
        map.on('rotatestart', handleUserInteraction);


        let lastCenter = map.getCenter();

        map.on('moveend', () => {
            const currentCenter = map.getCenter();
            const dist = currentCenter.distanceTo(lastCenter);

            if (dist > 5 && !isUpdatingCameraProgrammatically && followCamera) {
                followCamera = false;
                updateFollowButtonState();
                if (DEBUG) console.log('🔓 Follow disabled after move (dist: ' + dist.toFixed(2) + 'm)');
            }
            lastCenter = currentCenter;
        });

        routePlanner = new RoutePlanner3D(map, overlay, {
            getCurrentHour: () => currentHour,
            onRouteSelected: async (route) => {
                const lineSelect = document.getElementById('lineSelect');
                if (!lineSelect) return;

                lineSelect.value  = route.lineId;
                currentLine       = route.lineId;
                hoveredStopId     = null;
                selectedDirection = route.direction;

                if (moveTimer) { clearTimeout(moveTimer); moveTimer = null; }
                busPosition       = null;
                currentRouteGroup = null;
                hasTwoDirections  = false;
                currentStops      = [];
                currentStopIndex  = 0;
                isWaitingAtStop   = false;
                isWaitingAtEnd    = false;
                isSimulationRunning = false;
                currentPath       = null;
                pathPointIndex    = 0;

                const dirControls = document.getElementById('directionControls');
                if (dirControls) dirControls.style.display = 'flex';
                resetSimulationButton();

                await loadTrafficData(currentHour, currentLine);
                const dirIndex = parseInt(route.direction) || 0;
                await startBusAnimation(dirIndex, false);

                const findRouteBtn = document.getElementById('findRouteBtn');
                if (findRouteBtn) {
                    findRouteBtn.textContent     = '🗺️ Find Route';
                    findRouteBtn.style.background = '#8e44ad';
                }

                if (routePlanner) routePlanner.isSelecting = false;
                if (DEBUG) console.log(`Route selected: line ${route.lineId} direction ${route.direction}`);
            },
            onClear: () => {
                const findRouteBtn = document.getElementById('findRouteBtn');
                if (findRouteBtn) {
                    findRouteBtn.textContent     = '🗺️ Find Route';
                    findRouteBtn.style.background = '#8e44ad';
                }
            }
        });

        loadLines();
        loadConsortiumData();
        animateBus();
        setTimeout(() => {
            loadTrafficData(8, "");
            loadInsights();
        }, 500);
    });

    // ─── Load bus lines ───────────────────────────────────────────────────────
    async function loadLines() {
        try {
            const lines = await loadBusLines();
            const select = document.getElementById('lineSelect');
            lines.forEach(line => {
                const option = document.createElement('option');
                option.value = line;
                option.textContent = `Line ${line}`;
                select.appendChild(option);
            });
            select.__allLines = lines;
            if (DEBUG) console.log(`${lines.length} lines loaded`);
        } catch (err) {
            console.error("Error loading lines:", err);
        }
    }

    // ─── Traffic color utils ──────────────────────────────────────────────────
    function getTrafficColor(level) {
        if (!level) return [150, 150, 150];
        const l = level.toLowerCase();
        if (l === 'low')       return [46, 204, 113];
        if (l === 'medium')    return [241, 196, 15];
        if (l === 'high')      return [230, 126, 34];
        if (l === 'congested') return [231, 76, 60];
        return [150, 150, 150];
    }

    // ─── Load traffic data ────────────────────────────────────────────────────
    async function loadTrafficData(hour, line = "") {
        if (isLoading) return;
        setLoading(true);
        isLoading = true;

        const cacheKey = `data_${hour}_${line || 'all'}`;

        if (cache.has(cacheKey)) {
            const cached = cache.get(cacheKey);
            currentPaths = cached.paths;
            const stopsForLine = await loadStopsByLine(line);
            currentStops = stopsForLine;
            document.getElementById('stopCount').textContent = currentStops.length;
            updateLayers(currentPaths, currentStops, false);
            updateCounters(currentPaths.length, hour);
            updateLastUpdate();
            if (line) fitMapToPaths(currentPaths);
            setLoading(false);
            isLoading = false;
            return;
        }

        trafficDataMap = {};

        try {
            const statusRes = await fetch(`/api/traffic/status-by-hour?hour=${hour}`);
            if (statusRes.ok) {
                const statusData = await statusRes.json();
                statusData.forEach(item => { trafficDataMap[item.routeId] = item; });
            }

            let url = `/api/traffic/routes?hour=${hour}`;
            if (line) url += `&line=${line}`;

            const routesRes = await fetch(url);
            const geoJson = await routesRes.json();
            const routesByService = {};

            geoJson.features.forEach(feature => {
                const { servico, direcao, destino } = feature.properties;
                const trafficInfo = trafficDataMap[servico];
                const normalizedServico = servico.toLowerCase();

                if (feature.geometry.type === 'LineString') {
                    if (!routesByService[normalizedServico]) {
                        routesByService[normalizedServico] = { lineId: normalizedServico, directions: {} };
                    }
                    routesByService[normalizedServico].directions[direcao] = {
                        path: feature.geometry.coordinates.map(c => [c[0], c[1], 0]),
                        color: (currentLine && trafficInfo)
                            ? getTrafficColor(trafficInfo.trafficLevel)
                            : TrafficStyler.getColor('unknown'),
                        width: (currentLine && trafficInfo?.trafficLevel === 'congested') ? 8 :
                            (currentLine && trafficInfo?.trafficLevel === 'high')      ? 6 : 5,
                        destination: destino
                    };
                }
            });

            let paths = Object.values(routesByService);

            if (line) {
                const normalizedLine = line.toLowerCase();
                paths = paths.filter(p => p.lineId === normalizedLine);
                if (paths.length > 0) {
                    currentRouteGroup = paths[0];
                    const directionCount = Object.keys(currentRouteGroup.directions).length;
                    const isSingleDirection = SINGLE_DIRECTION_LINES.has(normalizedLine);
                    hasTwoDirections = directionCount >= 2 || (!isSingleDirection && directionCount === 1);
                    if (DEBUG) console.log(`Line ${line}: ${directionCount} direction(s) | Two-way: ${hasTwoDirections}`);
                }
            } else {
                currentRouteGroup = paths[0] || null;
                hasTwoDirections  = currentRouteGroup && Object.keys(currentRouteGroup.directions).length >= 2;
            }

            cache.set(cacheKey, { paths });
            currentPaths = paths;

            const stopsForLine = await loadStopsByLine(line);
            currentStops = stopsForLine;
            document.getElementById('stopCount').textContent = currentStops.length;

            updateLayers(paths, currentStops, false);
            updateCounters(paths.length, hour);
            updateLastUpdate();
            if (line) fitMapToPaths(paths);

            if (DEBUG) {
                console.log(`${paths.length} routes rendered`);
                console.log(`${currentStops.length} stops for line ${line || 'all'}`);
            }
        } catch (err) {
            console.error("Error loading traffic ", err);
        } finally {
            isLoading = false;
            setLoading(false);
        }
    }

    // ─── Update layers ────────────────────────────────────────────────────────
    function updateLayers(paths, stops, updateBusOnly = false) {
        if (!overlay) return;

        let path = null;
        if (currentRouteGroup) {
            const directions = Object.keys(currentRouteGroup.directions);
            if (directions.length > 0) {
                const directionKey  = directions[busDirectionIndex % directions.length];
                const directionData = currentRouteGroup.directions[directionKey];
                if (directionData?.path) path = directionData.path;
            }
        }

        if (!updateBusOnly) {
            staticLayers = [];
            const routeLayer = createRouteLayer(paths, PathLayer);
            if (routeLayer) staticLayers.push(routeLayer);
            const stopsLayer = createStopsLayer(stops, path, hoveredStopId, IconLayer, handleStopHover);
            if (stopsLayer) staticLayers.push(stopsLayer);
            if (DEBUG) console.log(`Static layers updated: ${staticLayers.length} layers`);
        }

        const busLayer = createBusLayer(
            paths, IconLayer, busProgress,
            currentRouteGroup, hasTwoDirections,
            busDirectionIndex, false,
            busPosition
        );

        const plannerLayers = buildPlannerLayers();

        // Location User Layer
        const userLayer = buildUserLocationLayer();

        const layers = busLayer
            ? [...staticLayers, busLayer, ...plannerLayers, ...userLayer]
            : [...staticLayers, ...plannerLayers, ...userLayer];

        overlay.setProps({ layers });
    }

    // ─── Stop hover handler ───────────────────────────────────────────────────
    function handleStopHover(event) {
        if (!event) return;
        const { object, x, y } = event;

        if (object) {
            showTooltip(`Stop: ${object.name}`, x, y);
        } else {
            hideTooltip();
        }

        const newHoveredId = object?.id || null;
        if (hoveredStopId === newHoveredId) return;

        if (overlay && staticLayers.length > 0) {
            const stopsLayerIndex = staticLayers.findIndex(layer => layer?.id === 'stops-layer');

            if (stopsLayerIndex >= 0) {
                const oldStopsLayer = staticLayers[stopsLayerIndex];
                const newStopsLayer = oldStopsLayer.clone({
                    data: oldStopsLayer.props.data,
                    getFillColor: stop => newHoveredId === stop.id ? [255, 215, 0] : [52, 152, 219],
                    getRadius:    stop => newHoveredId === stop.id ? 23 : 13,
                    pickable: true,
                    onHover: handleStopHover,
                    updateTriggers: { getFillColor: newHoveredId, getRadius: newHoveredId }
                });
                staticLayers[stopsLayerIndex] = newStopsLayer;

                const busLayer = createBusLayer(
                    currentPaths, IconLayer, busProgress,
                    currentRouteGroup, hasTwoDirections,
                    busDirectionIndex, false,
                    busPosition
                );

                const plannerLayers = buildPlannerLayers();

                overlay.setProps({
                    layers: [...staticLayers, ...(busLayer ? [busLayer] : []), ...plannerLayers]
                });
            }
        }

        hoveredStopId = newHoveredId;
    }

    // ─── Fit map to route bounds ──────────────────────────────────────────────
    function fitMapToPaths(paths) {
        if (!paths.length) return;
        const bounds = new maplibregl.LngLatBounds();
        paths.forEach(p => {
            Object.values(p.directions || {}).forEach(dir => {
                if (dir.path?.length) dir.path.forEach(coord => bounds.extend([coord[0], coord[1]]));
            });
        });
        if (bounds.isEmpty()) return;
        map.fitBounds(bounds, { padding: 50, duration: 1000, pitch: 45 });
    }

    // ─── UI helpers ───────────────────────────────────────────────────────────
    function updateCounters(routeCount, hour) {
        const routeCountEl = document.getElementById('routeCount');
        const hourEl       = document.getElementById('currentHour');
        if (routeCountEl) routeCountEl.textContent = routeCount;
        if (hourEl)       hourEl.textContent        = `${hour.toString().padStart(2, '0')}:00`;
    }
    function updateLastUpdate() {
        const el = document.getElementById('lastUpdate');
        if (el) el.textContent = new Date().toLocaleTimeString();
    }
    function setLoading(loading) {
        const el = document.getElementById('loadingIndicator');
        if (el) el.style.display = loading ? 'block' : 'none';
    }

    // ─── Load stops for a specific direction ──────────────────────────────────
    async function loadStopsForDirection(line, direction) {
        try {
            const res = await fetch(`/api/traffic/stops-by-line?line=${line}&direction=${direction}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const stops = data.map(stop => ({
                position: [stop.lng, stop.lat],
                name:     stop.stop_name || stop.name || 'Parada',
                id:       stop.stop_id   || stop.id,
                code:     stop.stop_code || stop.code || ''
            }));
            if (DEBUG) console.log(`✅ ${stops.length} stops loaded — line ${line} direction ${direction}`);
            return stops;
        } catch (err) {
            console.error(`Error loading stops for direction ${direction}:`, err);
            return [];
        }
    }

    // ─── Start bus animation ──────────────────────────────────────────────────
    async function startBusAnimation(directionIndex, autoStart = false) {
        if (moveTimer) { clearTimeout(moveTimer); moveTimer = null; }

        busDirectionIndex   = directionIndex;
        busProgress         = 0;
        currentStopIndex    = 0;
        isWaitingAtStop     = false;
        isWaitingAtEnd      = false;
        busPosition         = null;
        pathPointIndex      = 0;
        currentPath         = null;
        isSimulationRunning = autoStart;
        if (autoStart) {
            followCamera = true;
            updateFollowButtonState();
        }
        if (!currentLine || !currentRouteGroup) return;

        const directions = Object.keys(currentRouteGroup.directions);
        const dirKey     = directions[directionIndex % directions.length];

        if (DEBUG) console.log(`🚌 Starting animation — line ${currentLine} direction ${dirKey} (index ${directionIndex})`);

        currentPath = currentRouteGroup.directions[dirKey]?.path || null;

        const stops = await loadStopsForDirection(currentLine, dirKey);
        currentStops = stops;
        document.getElementById('stopCount').textContent = currentStops.length;

        if (currentPath && currentStops.length > 0) {
            currentStops = currentStops.map(stop => {
                let minDist = Infinity, closestIdx = 0;
                for (let i = 0; i < currentPath.length; i++) {
                    const dx = currentPath[i][0] - stop.position[0];
                    const dy = currentPath[i][1] - stop.position[1];
                    const d  = dx * dx + dy * dy;
                    if (d < minDist) { minDist = d; closestIdx = i; }
                }
                return { ...stop, pathIndex: closestIdx };
            });

            pathPointIndex = currentStops[0].pathIndex;
            busPosition    = [currentPath[pathPointIndex][0], currentPath[pathPointIndex][1], 0];

            if (DEBUG) console.log(`📍 Path mapped: ${currentStops.length} stops → indices [${currentStops[0].pathIndex} … ${currentStops[currentStops.length-1].pathIndex}]`);
        }

        updateLayers(currentPaths, currentStops, false);
    }

    // ─── Smooth Camera Update Function ────────────────────────────────────────
    function updateCameraSmoothly(lng, lat) {
        if (!map || !followCamera) return;

        isUpdatingCameraProgrammatically = true;

        if (isMobile) {
            map.jumpTo({ center: [lng, lat] });
        } else {
            const center = map.getCenter();
            const newLng = center.lng + (lng - center.lng) * CAMERA_LERP_FACTOR;
            const newLat = center.lat + (lat - center.lat) * CAMERA_LERP_FACTOR;
            map.setCenter([newLng, newLat]);
        }

        requestAnimationFrame(() => {
            isUpdatingCameraProgrammatically = false;
        });
    }

    // ─── Animation loop ───────────────────────────────────────────────────────
    function animateBus() {
        busAnimationId = requestAnimationFrame(animateBus);

        if (!currentRouteGroup || !currentPath || !currentStops || currentStops.length === 0) return;

        if (!isSimulationRunning) {
            updateLayers(currentPaths, currentStops, true);
            if (followCamera && busPosition) updateCameraSmoothly(busPosition[0], busPosition[1]);
            return;
        }

        if (isWaitingAtStop) {
            updateLayers(currentPaths, currentStops, true);
            if (followCamera && busPosition) updateCameraSmoothly(busPosition[0], busPosition[1]);
            return;
        }
        if (isWaitingAtEnd) return;

        if (currentStopIndex >= currentStops.length) {
            isWaitingAtEnd = true;
            if (DEBUG) console.log(`End of route — direction ${busDirectionIndex}`);

            const isCircular = SINGLE_DIRECTION_LINES.has(currentLine.toLowerCase());
            if (isCircular) {
                isSimulationRunning = false;
                resetSimulationButton();
                isWaitingAtEnd = false;
            } else {
                moveTimer = setTimeout(async () => {
                    let nextDirection = busDirectionIndex;
                    if (selectedDirection === null && hasTwoDirections) {
                        nextDirection = busDirectionIndex === 0 ? 1 : 0;
                    }
                    await startBusAnimation(nextDirection, true);
                }, STOP_PAUSE_MS * 2);
            }
            return;
        }
        const targetStop      = currentStops[currentStopIndex];
        const targetPathIndex = targetStop.pathIndex;
        const safeTarget      = Math.min(targetPathIndex, currentPath.length - 1);

        if (pathPointIndex > safeTarget) {
            pathPointIndex = safeTarget;
            currentStopIndex++;
            return;
        }
        pathPointIndex = Math.min(pathPointIndex + PATH_POINTS_PER_FRAME, safeTarget);
        pathPointIndex = Math.max(0, Math.min(pathPointIndex, currentPath.length - 1));

        const pt = currentPath[pathPointIndex];
        if (!pt) return;
        busPosition = [pt[0], pt[1], 0];

        updateLayers(currentPaths, currentStops, true);

        // --- SMOOTH CAMERA LOGIC ---
        if (followCamera && busPosition && map) {
            updateCameraSmoothly(busPosition[0], busPosition[1]);
        }
        if (pathPointIndex >= targetPathIndex) {
            isWaitingAtStop = true;
            if (DEBUG) console.log(`🚏 Stop ${currentStopIndex + 1}/${currentStops.length}: ${targetStop.name}`);
            showStopBanner(targetStop.name);
            moveTimer = setTimeout(() => {
                currentStopIndex++;
                isWaitingAtStop = false;
                moveTimer = null;
            }, STOP_PAUSE_MS);
        }
    }

    // ─── Consortium filter ────────────────────────────────────────────────────
    const CONSORTIUM_LABELS = {
        'internorte':   'Internorte',
        'intersul':     'Intersul',
        'transcarioca': 'Transcarioca',
        'santa_cruz':   'Santa Cruz',
        'mobi_rio':     'MobiRio'
    };

    let linesByConsortium = {};

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

            const consortiumSelect = document.getElementById('consortiumSelect');
            if (!consortiumSelect) return;
            consortiumSelect.innerHTML = '<option value="">-- All Consortiums --</option>';
            Object.keys(CONSORTIUM_LABELS).forEach(key => {
                if (!linesByConsortium[key]) return;
                const opt = document.createElement('option');
                opt.value       = key;
                opt.textContent = `${CONSORTIUM_LABELS[key]} (${linesByConsortium[key].length})`;
                consortiumSelect.appendChild(opt);
            });

            if (DEBUG) console.log(`Consortium data loaded: ${Object.keys(linesByConsortium).length} consortiums`);
        } catch (err) {
            console.error('Error loading consortium ', err);
        }
    }

    function filterLinesByConsortium(consortiumKey) {
        const lineSelect = document.getElementById('lineSelect');
        if (!lineSelect) return;
        lineSelect.innerHTML = '<option value="">-- All Lines --</option>';
        const allLines    = lineSelect.__allLines || [];
        const linesToShow = consortiumKey && linesByConsortium[consortiumKey]
            ? allLines.filter(l => linesByConsortium[consortiumKey].includes(l))
            : allLines;
        linesToShow.forEach(line => {
            const opt = document.createElement('option');
            opt.value       = line;
            opt.textContent = `Line ${line}`;
            lineSelect.appendChild(opt);
        });
    }

    // ─── Insights panel ───────────────────────────────────────────────────────
    async function loadInsights() {
        try {
            const [levelsRes, statusRes] = await Promise.all([
                fetch('/api/traffic/summary/levels'),
                fetch(`/api/traffic/status-by-hour?hour=${currentHour}`)
            ]);
            if (levelsRes.ok) renderLevelBars(await levelsRes.json());
            if (statusRes.ok) renderTopCongested(await statusRes.json());
        } catch (err) {
            console.error('Error loading insights:', err);
        }
    }

    function renderLevelBars(levels) {
        const container = document.getElementById('levelBars');
        if (!container) return;
        const total  = levels.reduce((sum, [, count]) => sum + count, 0);
        if (total === 0) return;
        const colors = { low: '#2ecc71', medium: '#f1c40f', high: '#e67e22', congested: '#e74c3c' };
        const order  = ['congested', 'high', 'medium', 'low'];
        const sorted = order.map(l => levels.find(([name]) => name === l)).filter(Boolean);
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
        const container = document.getElementById('topCongested');
        if (!container) return;
        const congested = status
            .filter(s => s.trafficLevel === 'congested')
            .sort((a, b) => parseFloat(a.avgSpeed) - parseFloat(b.avgSpeed))
            .slice(0, 5);
        if (congested.length === 0) {
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

    // ─── Stop name banner ─────────────────────────────────────────────────────
    function showStopBanner(stopName) {
        let banner = document.getElementById('stopBanner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'stopBanner';
            banner.style.cssText = `
                position: fixed; top: 24px; left: 50%;
                transform: translateX(-50%);
                background: rgba(30,30,30,0.92); color: #fff;
                padding: 8px 20px; border-radius: 20px;
                font-size: 14px; font-weight: 600;
                pointer-events: none; z-index: 9999;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                transition: opacity 0.2s ease; white-space: nowrap;
            `;
            document.body.appendChild(banner);
        }
        banner.textContent   = `🚏 ${stopName}`;
        banner.style.opacity = '1';
        banner.style.display = 'block';
        clearTimeout(banner._hideTimer);
        banner._hideTimer = setTimeout(() => {
            banner.style.opacity = '0';
            setTimeout(() => { banner.style.display = 'none'; }, 200);
        }, STOP_PAUSE_MS - 300);
    }

    // ─── Simulation button helpers ────────────────────────────────────────────
    function updateSimulationButton() {
        const btn = document.getElementById('startSimBtn');
        if (!btn) return;
        if (isSimulationRunning) {
            btn.textContent      = '⏸ Pause Simulation';
            btn.style.background = '#c0392b';
        } else {
            btn.textContent      = '▶ Start Simulation';
            btn.style.background = '#e67e22';
        }
    }

    function resetSimulationButton() {
        isSimulationRunning      = false;
        const btn = document.getElementById('startSimBtn');
        if (!btn) return;
        btn.textContent      = '▶ Start Simulation';
        btn.style.background = '#e67e22';
    }

    // ─── Follow Bus Button Logic ──────────────────────────────────────────────
    function updateFollowButtonState() {
        const btn = document.getElementById('followBusBtn');
        if (!btn) return;

        if (followCamera) {
            btn.textContent = '🎯 Following';
            btn.classList.add('active');
            btn.title = 'Click to release camera';
        } else {
            btn.textContent = '🎯 Follow Bus';
            btn.classList.remove('active');
            btn.title = 'Click to recenter on bus';
        }
    }

    // ─── Event Listeners ──────────────────────────────────────────────────────
    let debounceTimeout;
    document.getElementById('hourSlider').addEventListener('input', e => {
        const h = parseInt(e.target.value);
        document.getElementById('hourDisplay').innerText = `${h.toString().padStart(2, '0')}:00`;
        if (debounceTimeout) clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => {
            currentHour = h;
            if (routePlanner) routePlanner.setHour(h);
            loadTrafficData(currentHour, currentLine);
            loadInsights();
            loadConsortiumData();
        }, 200);
    });

    document.getElementById('consortiumSelect')?.addEventListener('change', e => {
        filterLinesByConsortium(e.target.value);
        const lineSelect = document.getElementById('lineSelect');
        if (lineSelect) lineSelect.value = '';
        currentLine = '';
        if (moveTimer) { clearTimeout(moveTimer); moveTimer = null; }
        busPosition       = null;
        currentRouteGroup = null;
        currentStops      = [];
        isSimulationRunning = false;
        currentPath       = null;
        pathPointIndex    = 0;
        isWaitingAtStop   = false;
        isWaitingAtEnd    = false;
        const directionControls = document.getElementById('directionControls');
        if (directionControls) directionControls.style.display = 'none';
        resetSimulationButton();
        hideTooltip();
    });

    document.getElementById('lineSelect').addEventListener('change', async e => {
        currentLine       = e.target.value;
        hoveredStopId     = null;
        selectedDirection = null;

        if (routePlanner) {
            routePlanner._clearMarkers();
            routePlanner._clearABLine();
            routePlanner.pointA      = null;
            routePlanner.pointB      = null;
            routePlanner.isSelecting = false;
        }
        const findBtn = document.getElementById('findRouteBtn');
        if (findBtn) {
            findBtn.textContent      = '🗺️ Find Route';
            findBtn.style.background = '#8e44ad';
        }

        if (moveTimer) { clearTimeout(moveTimer); moveTimer = null; }
        busPosition       = null;
        currentRouteGroup = null;
        hasTwoDirections  = false;
        currentStops      = [];
        currentStopIndex  = 0;
        isWaitingAtStop   = false;
        isWaitingAtEnd    = false;
        isSimulationRunning = false;
        currentPath       = null;
        pathPointIndex    = 0;
        selectedDirection = null;
        hideTooltip();

        if (DEBUG) console.log(`Switching to line: ${currentLine || 'all'}`);

        const directionControls = document.getElementById('directionControls');
        if (directionControls) directionControls.style.display = currentLine ? 'flex' : 'none';
        resetSimulationButton();

        await loadTrafficData(currentHour, currentLine);
        if (currentLine) await startBusAnimation(0, false);
    });

    document.getElementById('direction0Btn')?.addEventListener('click', async () => {
        selectedDirection = '0';
        const wasRunning  = isSimulationRunning;
        if (DEBUG) console.log('Direction set: Outbound (0)');
        await startBusAnimation(0, wasRunning);
    });

    document.getElementById('direction1Btn')?.addEventListener('click', async () => {
        selectedDirection = '1';
        const wasRunning  = isSimulationRunning;
        if (DEBUG) console.log('Direction set: Return (1)');
        await startBusAnimation(1, wasRunning);
    });

    document.getElementById('startSimBtn')?.addEventListener('click', () => {
        if (!currentLine || !currentRouteGroup) return;
        isSimulationRunning = !isSimulationRunning;
        if (isSimulationRunning) {
            if (currentStopIndex >= currentStops.length) {
                currentStopIndex = 0;
                isWaitingAtEnd   = false;
            }
            isWaitingAtStop = false;
            if (moveTimer) { clearTimeout(moveTimer); moveTimer = null; }

            followCamera = true;
            updateFollowButtonState();

            if (DEBUG) console.log('▶ Simulation started + Follow ON');
        } else {
            if (moveTimer) { clearTimeout(moveTimer); moveTimer = null; }
            isWaitingAtStop = false;
            isWaitingAtEnd  = false;
            if (DEBUG) console.log('⏸ Simulation paused');
        }
        updateSimulationButton();
    });

    // Listener for Follow Bus button
    document.getElementById('followBusBtn')?.addEventListener('click', () => {
        if (!busPosition) {
            if (DEBUG) console.warn('⚠️ No bus position available yet');
            return;
        }

        followCamera = !followCamera;

        if (followCamera) {
            // Center immediately when activating
            isUpdatingCameraProgrammatically = true;
            map.jumpTo({ center: [busPosition[0], busPosition[1]] });
            if (map.getZoom() < 14) map.setZoom(15);

            // Reset flag shortly after
            setTimeout(() => { isUpdatingCameraProgrammatically = false; }, 100);

            if (DEBUG) console.log('🎯 Follow Mode ON');
        } else {
            if (DEBUG) console.log('🔓 Follow Mode OFF');
        }

        updateFollowButtonState();
    });

    document.getElementById('findRouteBtn')?.addEventListener('click', () => {
        const btn = document.getElementById('findRouteBtn');
        if (!routePlanner) return;
        if (routePlanner.isSelecting) {
            routePlanner.deactivate();
            btn.textContent      = '🗺️ Find Route';
            btn.style.background = '#8e44ad';
        } else {
            if (isSimulationRunning) {
                isSimulationRunning = false;
                if (moveTimer) { clearTimeout(moveTimer); moveTimer = null; }
                isWaitingAtStop = false;
                isWaitingAtEnd  = false;
                updateSimulationButton();
            }
            routePlanner.activate();
            btn.textContent      = '✕ Cancel';
            btn.style.background = '#c0392b';
        }
    });
    document.getElementById('locateUserBtn')?.addEventListener('click', () => locateUser());
    document.getElementById('resetViewBtn').addEventListener('click', () => {
        // Reset line selection
        const lineSelect = document.getElementById('lineSelect');
        if (lineSelect) lineSelect.value = '';
        const consortiumSelect = document.getElementById('consortiumSelect');
        if (consortiumSelect) consortiumSelect.value = '';
        currentLine = '';
        selectedDirection = null;

        // Stop animation
        if (moveTimer) { clearTimeout(moveTimer); moveTimer = null; }
        busPosition       = null;
        currentRouteGroup = null;
        hasTwoDirections  = false;
        currentStops      = [];
        currentStopIndex  = 0;
        isWaitingAtStop   = false;
        isWaitingAtEnd    = false;
        isSimulationRunning = false;
        currentPath       = null;
        pathPointIndex    = 0;
        followCamera      = false;
        updateFollowButtonState();
        resetSimulationButton();
        hideTooltip();

        // Clear route planner
        if (routePlanner) {
            routePlanner._clearMarkers();
            routePlanner._clearABLine();
            routePlanner.pointA      = null;
            routePlanner.pointB      = null;
            routePlanner.isSelecting = false;
        }
        const findBtn = document.getElementById('findRouteBtn');
        if (findBtn) {
            findBtn.textContent      = '🗺️ Find Route';
            findBtn.style.background = '#8e44ad';
        }

        // Hide direction controls
        const dirControls = document.getElementById('directionControls');
        if (dirControls) dirControls.style.display = 'none';

        // Reload all routes and fly to initial view
        loadTrafficData(currentHour, '');
        map.flyTo({ center: [-43.1729, -22.9068], zoom: 11.5, pitch: 45, bearing: 0, duration: 1500 });
    });

    document.getElementById('refreshBtn').addEventListener('click', () => {
        cache.delete(`data_${currentHour}_${currentLine || 'all'}`);
        loadTrafficData(currentHour, currentLine);
    });

    document.getElementById('mapStyleToggle')?.addEventListener('click', () => {
        currentMapStyle = (currentMapStyle === 'voyager' || currentMapStyle === 'positron') ? 'dark' : 'positron';
        changeMapStyle(map, currentMapStyle);
        const btn = document.getElementById('mapStyleToggle');
        if (btn) btn.textContent = (currentMapStyle === 'voyager' || currentMapStyle === 'positron') ? '🌙 Dark Mode' : '☀️ Light Mode';
        document.body.classList.toggle('dark-mode', currentMapStyle === 'dark');
    });
});