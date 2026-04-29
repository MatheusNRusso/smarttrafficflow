// Configuration
const DEBUG = false;

// Cache for stops by line to avoid redundant API calls
const stopsCache = new Map();

/**
 * Loads all available bus lines from the API
 * @returns {Promise<Array<string>>} Array of line IDs
 */
export async function loadBusLines() {
    try {
        const res = await fetch('/api/traffic/bus-lines');
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        const lines = await res.json();

        if (DEBUG) {
            console.log(`${lines.length} lines loaded`);
        }
        return lines;
    } catch (err) {
        console.error('Error loading lines:', err);
        return [];
    }
}

/**
 * Loads stops for a specific bus line from the API
 * @param {string} line - Line ID to fetch stops for (empty string for all)
 * @returns {Promise<Array<Object>>} Array of processed stop objects
 */
export async function loadStopsByLine(line = '') {
    if (!line) {
        // Return all stops if no line specified
        return loadAllStops();
    }

    // Check cache first
    if (stopsCache.has(line)) {
        if (DEBUG) {
            console.log(`Cache hit for line ${line}`);
        }
        return stopsCache.get(line);
    }

    try {
        const res = await fetch(`/api/traffic/stops-by-line?line=${line}`);
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        const stopsData = await res.json();

        if (DEBUG) {
            console.log(`${stopsData.length} stops loaded from API for line ${line}`);
        }

        // Process and normalize stop data
        const processedStops = stopsData.map(stop => ({
            id: stop.id || stop.stop_id,
            name: stop.name || stop.stop_name || 'Bus Stop',
            code: stop.code || stop.stop_code || '',
            position: parsePosition(stop)
        })).filter(stop => stop.position !== null);

        // Cache the result
        stopsCache.set(line, processedStops);

        return processedStops;
    } catch (err) {
        console.warn(`Error loading stops for line ${line}:`, err);
        return [];
    }
}

/**
 * Loads all bus stops (when no line filter is applied)
 * @returns {Promise<Array<Object>>} Array of all stop objects
 */
async function loadAllStops() {
    try {
        const res = await fetch('/api/traffic/bus-stops');
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        const geoJson = await res.json();

        if (!geoJson.features || !Array.isArray(geoJson.features)) {
            return [];
        }

        const stops = geoJson.features.map(feature => ({
            id: feature.properties.stop_id,
            name: feature.properties.stop_name || 'Bus Stop',
            code: feature.properties.stop_code || '',
            position: feature.geometry.coordinates // [longitude, latitude]
        }));

        if (DEBUG) {
            console.log(`${stops.length} total stops loaded`);
        }

        return stops;
    } catch (err) {
        console.error('Error loading all stops:', err);
        return [];
    }
}

/**
 * Parses stop position from various possible formats
 * @param {Object} stop - Stop object with position data
 * @returns {Array<number>|null} [longitude, latitude] or null if invalid
 */
function parsePosition(stop) {
    if (!stop) return null;

    // Handle GeoJSON geometry
    if (stop.geometry?.coordinates?.length >= 2) {
        return stop.geometry.coordinates;
    }

    // Handle nested position object
    if (stop.position) {
        if (Array.isArray(stop.position) && stop.position.length >= 2) {
            return stop.position;
        }
        if (typeof stop.position === 'object') {
            if (stop.position.lng && stop.position.lat) {
                return [stop.position.lng, stop.position.lat];
            }
            if (stop.position.longitude && stop.position.latitude) {
                return [stop.position.longitude, stop.position.latitude];
            }
        }
    }

    // Handle direct coordinates
    if (Array.isArray(stop.coordinates) && stop.coordinates.length >= 2) {
        return stop.coordinates;
    }

    // Handle direct lng/lat properties
    if (typeof stop.lng === 'number' && typeof stop.lat === 'number') {
        return [stop.lng, stop.lat];
    }

    if (DEBUG) {
        console.warn('Unable to parse position from stop:', stop);
    }
    return null;
}

/**
 * Clears the stops cache for a specific line or all lines
 * @param {string|null} line - Line ID to clear, or null to clear all
 */
export function clearStopsCache(line = null) {
    if (line) {
        stopsCache.delete(line);
        if (DEBUG) {
            console.log(`Cache cleared for line ${line}`);
        }
    } else {
        stopsCache.clear();
        if (DEBUG) {
            console.log('All stops cache cleared');
        }
    }
}

/**
 * Fetches traffic status for a specific hour
 * @param {number} hour - Hour (0-23)
 * @returns {Promise<Array<Object>>} Array of traffic status objects
 */
export async function loadTrafficStatus(hour) {
    try {
        const res = await fetch(`/api/traffic/status-by-hour?hour=${hour}`);
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        return await res.json();
    } catch (err) {
        console.error('Error loading traffic status:', err);
        return [];
    }
}

/**
 * Fetches route geometry for a specific hour and optional line filter
 * @param {number} hour - Hour (0-23)
 * @param {string} line - Optional line ID filter
 * @returns {Promise<Object>} GeoJSON object with route features
 */
export async function loadRoutes(hour, line = '') {
    try {
        let url = `/api/traffic/routes?hour=${hour}`;
        if (line) {
            url += `&line=${line}`;
        }

        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        return await res.json();
    } catch (err) {
        console.error('Error loading routes:', err);
        return { features: [] };
    }
}