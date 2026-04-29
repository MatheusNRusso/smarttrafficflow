import { TrafficStyler } from '../core/TrafficStyler.js';

/**
 * Renders route polylines on the Leaflet map.
 * Each route gets a white outline layer beneath the color layer,
 * improving visibility against both light and dark tile backgrounds.
 *
 * @param {Array}        paths          - Processed route objects with directions
 * @param {Object}       trafficDataMap - Traffic status by route ID
 * @param {string}       selectedLine   - Currently selected line ID
 * @param {L.LayerGroup} layerGroup     - Target Leaflet layer group
 * @returns {Array} Array of rendered route objects
 */
export function renderRoutes(paths, trafficDataMap, selectedLine, layerGroup) {
    const rendered = [];

    paths.forEach(route => {
        Object.entries(route.directions || {}).forEach(([direction, data]) => {
            if (!data.path || data.path.length < 2) return;

            const coords     = data.path.map(c => [c[1], c[0]]); // [lat, lng] for Leaflet
            const isSelected = selectedLine && route.lineId === selectedLine.toLowerCase();
            const weight     = isSelected ? (data.weight || 4) + 2 : (data.weight || 4);
            const color      = data.color || '#95a5a6';

            // White outline layer — drawn first, sits beneath color layer.
            // Creates a halo that makes routes readable against any tile background.
            L.polyline(coords, {
                color:       '#ffffff',
                weight:      weight + 3,
                opacity:     isSelected ? 0.9 : 0.6,
                lineCap:     'round',
                lineJoin:    'round',
                interactive: false
            }).addTo(layerGroup);

            // Color layer — drawn on top of the outline
            const polyline = L.polyline(coords, {
                color,
                weight,
                opacity:  isSelected ? 1 : 0.85,
                lineCap:  'round',
                lineJoin: 'round'
            }).addTo(layerGroup);

            polyline.bindPopup(buildRoutePopup(route.lineId, data, trafficDataMap[route.lineId]));

            rendered.push({ id: route.lineId, direction, coordinates: data.path, layer: polyline });
        });
    });

    return rendered;
}

/**
 * Builds popup HTML for a route.
 */
function buildRoutePopup(serviceId, directionData, trafficInfo) {
    const levelColors = {
        low: '#2ecc71', medium: '#f1c40f',
        high: '#e67e22', congested: '#e74c3c'
    };

    let html = `<div style="min-width:180px;font-family:inherit;">`;
    html += `<h4 style="margin:0 0 8px;color:#2c3e50;">Line ${serviceId.toUpperCase()}</h4>`;
    html += `<p style="margin:0 0 4px;"><strong>Direction:</strong> ${directionData.destination || 'N/A'}</p>`;

    if (trafficInfo) {
        const level = trafficInfo.trafficLevel || 'unknown';
        const color = levelColors[level] || '#95a5a6';
        html += `<p style="margin:0 0 4px;"><strong>Status:</strong>
                    <span style="color:${color};font-weight:600;">${level.toUpperCase()}</span></p>`;
        if (trafficInfo.avgSpeed !== undefined) {
            html += `<p style="margin:0;"><strong>Avg Speed:</strong> ${Number(trafficInfo.avgSpeed).toFixed(1)} km/h</p>`;
        }
    } else {
        html += `<p style="margin:0;color:#7f8c8d;font-style:italic;">No traffic data</p>`;
    }

    html += `</div>`;
    return html;
}

/**
 * Renders stop markers using the shared icon-stop-atlas.png.
 * Atlas layout (48x48px cells): x=0 regular | x=48 start | x=96 end
 *
 * @param {Array}        stops      - Array of stop objects { position, name, id }
 * @param {L.LayerGroup} layerGroup - Target Leaflet layer group
 * @param {Object}       options    - { onHover, onHoverEnd } callbacks
 */
export function renderStops(stops, layerGroup, options = {}) {
    const { onHover, onHoverEnd } = options;
    if (!stops || stops.length === 0) return;

    const ICON_SIZE   = 28; // display size in px
    const SPRITE_SIZE = 48; // each sprite cell in the atlas

    const startId = stops[0]?.id;
    const endId   = stops[stops.length - 1]?.id;

    stops.forEach(stop => {
        if (!stop.position || stop.position.length < 2) return;
        const [lng, lat] = stop.position;

        // Pick sprite column: 0 = regular, 48 = start, 96 = end
        let spriteX = 0;
        if (stop.id === startId) spriteX = 48;
        if (stop.id === endId)   spriteX = 96;

        const scaledX = spriteX * (ICON_SIZE / SPRITE_SIZE);

        const icon = L.divIcon({
            className: '',
            html: `<div class="stop-icon-div" style="
                width:${ICON_SIZE}px;
                height:${ICON_SIZE}px;
                background: url('/js/core/icon-stop-atlas.png')
                            -${scaledX}px 0 / auto ${ICON_SIZE}px no-repeat;
                cursor: pointer;
                transition: transform 0.15s ease;
            "></div>`,
            iconSize:   [ICON_SIZE, ICON_SIZE],
            iconAnchor: [ICON_SIZE / 2, ICON_SIZE]
        });

        const marker = L.marker([lat, lng], { icon, zIndexOffset: 500 });

        if (onHover) {
            marker.on('mouseover', e => {
                e.target.getElement()
                    ?.querySelector('.stop-icon-div')
                    ?.style.setProperty('transform', 'scale(1.4)');
                onHover(stop, e.originalEvent.pageX, e.originalEvent.pageY);
            });
        }

        if (onHoverEnd) {
            marker.on('mouseout', e => {
                const el = e.target.getElement()?.querySelector('.stop-icon-div');
                if (el) el.style.removeProperty('transform');
                onHoverEnd();
            });
        }

        marker.bindPopup(`<strong>${stop.name}</strong><br/><small>ID: ${stop.id}</small>`);
        marker.addTo(layerGroup);
    });
}