// Configuration
const DEBUG = false;

// Cache for stops by line
const stopsByLineMap = new Map();

/**
 * Loads all available bus lines from the API
 * @returns {Promise<Array<string>>} Array of line IDs
 */
export async function loadBusLines() {
    try {
        const res = await fetch('/api/traffic/bus-lines');
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

        const lines = await res.json();
        if (DEBUG) console.log(`${lines.length} lines loaded`);
        return lines;
    } catch (err) {
        console.error("Error loading lines:", err);
        return [];
    }
}

/**
 * Parses stop position from various possible formats
 * @param {Object|Array} stop - Stop object or coordinates array
 * @returns {Array<number>|null} [longitude, latitude] or null if invalid
 */
function parseStopPosition(stop) {
    if (!stop) return null;

    if (stop.position) {
        if (Array.isArray(stop.position) && stop.position.length >= 2) {
            return [stop.position[0], stop.position[1]];
        }
        if (typeof stop.position === 'object') {
            if (stop.position.lng && stop.position.lat) return [stop.position.lng, stop.position.lat];
            if (stop.position.longitude && stop.position.latitude) return [stop.position.longitude, stop.position.latitude];
            if (Array.isArray(stop.position.coordinates)) return [stop.position.coordinates[0], stop.position.coordinates[1]];
        }
    }

    if (Array.isArray(stop.coordinates) && stop.coordinates.length >= 2) return [stop.coordinates[0], stop.coordinates[1]];
    if (typeof stop.lng === 'number' && typeof stop.lat === 'number') return [stop.lng, stop.lat];
    if (typeof stop.longitude === 'number' && typeof stop.latitude === 'number') return [stop.longitude, stop.latitude];
    if (Array.isArray(stop) && stop.length >= 2) return [stop[0], stop[1]];

    if (DEBUG) console.warn('Unable to extract coordinates from stop:', stop);
    return null;
}

/**
 * Loads stops for a specific bus line
 * @param {string} line - Line ID to fetch stops for
 * @returns {Promise<Array<Object>>} Array of processed stop objects
 */
export async function loadStopsByLine(line) {
    if (!line) return [];

    try {
        const res = await fetch(`/api/traffic/stops-by-line?line=${line}`);
        if (res.ok) {
            const stopsData = await res.json();
            if (DEBUG)
                console.log(`${stopsData.length} stops loaded from API for line ${line}`);

            const processedStops = stopsData
                .map(stop => {
                    const position = parseStopPosition(stop);
                    return position ? {
                        position,
                        name: stop.name || stop.stop_name || "Bus Stop",
                        id: stop.id || stop.stop_id,
                        code: stop.code || stop.stop_code || ""
                    } : null;
                })
                .filter(Boolean);

            if (processedStops.length > 0 && DEBUG) console.log(`First processed stop:`, processedStops[0]);

            stopsByLineMap.set(line, processedStops);
            return processedStops;
        }
    } catch (err) {
        console.warn(`Error loading stops from API for line ${line}:`, err);
    }

    const cached = stopsByLineMap.get(line);
    if (cached) {
        if (DEBUG) console.log(`${cached.length} stops loaded from cache for line ${line}`);
        return cached;
    }

    return [];
}

/**
 * Clears the stops cache
 * @param {string|null} line - Line ID to clear, or null to clear all
 */
export function clearStopsCache(line = null) {
    if (line) {
        stopsByLineMap.delete(line);
        if (DEBUG) console.log(`Cache cleared for line ${line}`);
    } else {
        stopsByLineMap.clear();
        if (DEBUG) console.log('All stops cache cleared');
    }
}