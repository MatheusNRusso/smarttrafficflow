/**
 * Available map styles for MapLibre GL.
 * Positron is the default — neutral gray background with readable street labels.
 */
export const MAP_STYLES = {
    positron: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    dark:     'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    voyager:  'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'
};

// ─── Label size multipliers ───────────────────────────────────────────────────
// Increase these values to make map labels larger.
// 1.0 = original size, 1.4 = 40% larger, etc.
const LABEL_SCALE = {
    street:  1.35,  // street names
    place:   1.45,  // neighbourhoods, districts
    city:    1.5,   // city / municipality names
    country: 1.4,
    poi:     1.2,
    default: 1.3
};

/**
 * Applies larger text sizes to all symbol/label layers in the current style.
 * Called after every style load so it persists through style changes.
 * @param {Object} map - MapLibre map instance
 */
function applyLabelSizes(map) {
    const style = map.getStyle();
    if (!style || !style.layers) return;

    style.layers.forEach(layer => {
        if (layer.type !== 'symbol') return;

        const id = layer.id.toLowerCase();

        // Pick scale factor based on layer name keywords
        let scale = LABEL_SCALE.default;
        if (id.includes('street') || id.includes('road'))                                    scale = LABEL_SCALE.street;
        else if (id.includes('place') || id.includes('neighbourhood') || id.includes('suburb')) scale = LABEL_SCALE.place;
        else if (id.includes('city') || id.includes('town') || id.includes('village'))          scale = LABEL_SCALE.city;
        else if (id.includes('country') || id.includes('state'))                                 scale = LABEL_SCALE.country;
        else if (id.includes('poi') || id.includes('transit'))                                   scale = LABEL_SCALE.poi;

        const current = map.getLayoutProperty(layer.id, 'text-size');
        if (current === undefined || current === null) return;

        const newSize = typeof current === 'number'
            ? current * scale
            : Array.isArray(current) ? scaleExpression(current, scale) : null;

        if (newSize === null) return;

        try {
            map.setLayoutProperty(layer.id, 'text-size', newSize);
        } catch (_) {
            // Some layers may reject the update — skip silently
        }
    });
}

/**
 * Recursively scales numeric values inside a MapLibre GL expression.
 * @param {*}      expr  - MapLibre expression or primitive
 * @param {number} scale - Multiplier
 * @returns {*} Scaled expression
 */
function scaleExpression(expr, scale) {
    if (typeof expr === 'number') return expr * scale;
    if (!Array.isArray(expr))    return expr;
    return expr.map(item => scaleExpression(item, scale));
}

/**
 * Initializes the MapLibre GL map with Deck.gl overlay.
 * @param {Function} onLoadCallback - Called with (map, overlay) when ready
 * @param {string}   initialStyle   - Style key (default: 'positron')
 * @returns {Object} MapLibre map instance
 */
export function initMap(onLoadCallback, initialStyle = 'positron') {
    const map = new maplibregl.Map({
        container: 'map',
        style: MAP_STYLES[initialStyle] || MAP_STYLES.positron,
        center: [-43.1729, -22.9068],
        zoom: 11.5,
        pitch: 45,
        bearing: 0,
        antialias: true,
        dragRotate: true,
        pitchWithRotate: true,
        cooperativeGestures: false
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.on('load', () => {
        applyLabelSizes(map);

        const overlay = new deck.MapboxOverlay({ layers: [] });
        map.addControl(overlay);
        onLoadCallback(map, overlay);
    });

    // Re-apply label sizes after style changes (dark mode toggle etc.)
    map.on('styledata', () => {
        if (map.isStyleLoaded()) applyLabelSizes(map);
    });

    return map;
}

/**
 * Changes the map style dynamically.
 * Label sizes are re-applied automatically via the 'styledata' listener.
 * @param {Object} map      - MapLibre map instance
 * @param {string} styleKey - Key from MAP_STYLES
 */
export function changeMapStyle(map, styleKey) {
    if (!map || !MAP_STYLES[styleKey]) return;
    map.setStyle(MAP_STYLES[styleKey]);
    console.log(`Map style changed to: ${styleKey}`);
}