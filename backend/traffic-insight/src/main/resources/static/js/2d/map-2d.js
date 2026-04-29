export const MAP_STYLES_2D = {
    // Light — clean, high readability
    smooth: 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png',

    // Dark — deep background, good route contrast
    dark: 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png',

    // Fallback light — CartoDB Positron (no API key needed)
    positron: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',

    // Fallback dark — CartoDB Dark Matter
    dark_matter: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
};

const STADIA_ATTRIBUTION =
    '&copy; <a href="https://stadiamaps.com/" target="_blank">Stadia Maps</a> ' +
    '&copy; <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a> ' +
    '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';

const CARTO_ATTRIBUTION =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
    '&copy; <a href="https://carto.com/attributions">CARTO</a>';

// Which attribution to use per style key
const ATTRIBUTION_MAP = {
    smooth:      STADIA_ATTRIBUTION,
    dark:        STADIA_ATTRIBUTION,
    positron:    CARTO_ATTRIBUTION,
    dark_matter: CARTO_ATTRIBUTION
};

let currentTileLayer = null;
let currentStyleKey  = 'smooth'; // track for toggle logic

/**
 * Initializes the Leaflet map.
 * @param {string} initialStyle - Style key (default: 'smooth')
 * @returns {Promise<L.Map>}
 */
export async function initMap2D(initialStyle = 'smooth') {
    await new Promise(resolve => {
        if (document.readyState === 'complete') resolve();
        else window.addEventListener('load', resolve, { once: true });
    });

    await new Promise(resolve => setTimeout(resolve, 50));

    const mapContainer = document.getElementById('map');
    if (!mapContainer) throw new Error('Map container #map not found');

    const map = L.map('map', {
        center: [-22.9068, -43.1729],
        zoom: 11.5,
        zoomControl: false,
        attributionControl: true,
        fadeAnimation: true,
        markerZoomAnimation: true
    });

    currentStyleKey  = initialStyle;
    currentTileLayer = L.tileLayer(
        MAP_STYLES_2D[initialStyle] || MAP_STYLES_2D.smooth,
        {
            attribution: ATTRIBUTION_MAP[initialStyle] || STADIA_ATTRIBUTION,
            maxZoom: 19,
            detectRetina: true
        }
    ).addTo(map);

    L.control.zoom({ position: 'topright' }).addTo(map);
    L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map);
    map.invalidateSize();

    // Wait for map to be ready
    await new Promise(resolve => {
        if (map._loaded) resolve();
        else {
            const onReady = () => { map.off('load', onReady); resolve(); };
            map.on('load', onReady);
            setTimeout(resolve, 2000);
        }
    });

    map.invalidateSize();
    return map;
}

/**
 * Toggles between light (smooth) and dark styles.
 * Calling code passes 'voyager' or 'dark' to stay compatible with
 * existing toggle logic — we map those to the Stadia equivalents.
 *
 * @param {L.Map} map      - Leaflet map instance
 * @param {string} styleKey - 'voyager' | 'dark' (or any MAP_STYLES_2D key)
 */
export function changeMapStyle2D(map, styleKey) {
    if (!map) return;

    // Map legacy keys to Stadia equivalents
    const keyMap = { voyager: 'smooth', positron: 'positron' };
    const resolvedKey = keyMap[styleKey] || styleKey;
    const tileUrl     = MAP_STYLES_2D[resolvedKey] || MAP_STYLES_2D.smooth;
    const attribution = ATTRIBUTION_MAP[resolvedKey] || STADIA_ATTRIBUTION;

    if (currentTileLayer) map.removeLayer(currentTileLayer);

    currentTileLayer = L.tileLayer(tileUrl, {
        attribution,
        maxZoom: 19,
        detectRetina: true
    }).addTo(map);

    currentStyleKey = resolvedKey;
    console.log(`Map style changed to: ${resolvedKey}`);
}