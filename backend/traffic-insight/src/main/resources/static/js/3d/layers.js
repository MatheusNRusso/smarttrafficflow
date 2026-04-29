import { TrafficStyler } from '../core/TrafficStyler.js';


/**
 * Creates the route layer for displaying bus routes
 * @param {Array} paths - Array of route objects with directions
 * @param {Object} PathLayer - Deck.gl PathLayer constructor
 * @returns {PathLayer|null} Configured PathLayer instance or null if no paths
 */
export function createRouteLayer(paths, PathLayer) {
    if (!paths || paths.length === 0) return null;

    const flattenedPaths = [];

    paths.forEach(route => {
        const directions = Object.values(route.directions || {});
        directions.forEach((dir, index) => {
            if (dir.path && Array.isArray(dir.path)) {
                flattenedPaths.push({
                    id: `${route.lineId}-dir-${index}`,
                    path: dir.path,
                    color: dir.color || TrafficStyler.getColor('unknown'), // 🔵 Blue fallback
                    width: dir.width || 4
                });
            }
        });
    });

    return new PathLayer({
        id: 'routes-layer',
        data: flattenedPaths,
        getPath: d => d.path,
        getColor: d => d.color,
        getWidth: d => d.width,
        widthMinPixels: 2,
        widthMaxPixels: 8,
        capRounded: true,
        jointRounded: true,
        pickable: false
    });
}
export function createStopsLayer(stops, path, hoveredStopId, IconLayer, onHover) {
    if (!stops || stops.length === 0) return null;
    if (!path || path.length === 0) return null;

    const validStops = stops.filter(stop => {
        const pos = stop.position;
        return pos && Array.isArray(pos) && pos.length >= 2;
    });

    if (validStops.length === 0) return null;

    // Map stops to closest index on path
    const stopsWithIndex = validStops.map(stop => {

        let closestIndex = 0;
        let minDist = Infinity;

        path.forEach((coord, i) => {
            const dx = coord[0] - stop.position[0];
            const dy = coord[1] - stop.position[1];
            const dist = dx * dx + dy * dy;

            if (dist < minDist) {
                minDist = dist;
                closestIndex = i;
            }
        });

        return {
            ...stop,
            pathIndex: closestIndex
        };
    });

    // Sort stops along route
    stopsWithIndex.sort((a, b) => a.pathIndex - b.pathIndex);

    // Identify stop closest to start and end of path
    const startCoord = path[0];
    const endCoord = path[path.length - 1];

    let startStopId = null;
    let endStopId = null;

    let minStartDist = Infinity;
    let minEndDist = Infinity;

    stopsWithIndex.forEach(stop => {

        const dxStart = stop.position[0] - startCoord[0];
        const dyStart = stop.position[1] - startCoord[1];
        const distStart = dxStart * dxStart + dyStart * dyStart;

        if (distStart < minStartDist) {
            minStartDist = distStart;
            startStopId = stop.id;
        }

        const dxEnd = stop.position[0] - endCoord[0];
        const dyEnd = stop.position[1] - endCoord[1];
        const distEnd = dxEnd * dxEnd + dyEnd * dyEnd;

        if (distEnd < minEndDist) {
            minEndDist = distEnd;
            endStopId = stop.id;
        }
    });

    // Assign icons
    const stopsWithIcons = stopsWithIndex.map(stop => {

        let iconType = 'stop-regular';

        if (stop.id === startStopId) {
            iconType = 'stop-start';
        }
        else if (stop.id === endStopId) {
            iconType = 'stop-end';
        }

        return {
            ...stop,
            iconType,
            isHovered: hoveredStopId === stop.id
        };
    });

    return new IconLayer({
        id: 'stops-layer',
        data: stopsWithIcons,

        getPosition: d => d.position,
        getIcon: d => d.iconType,

        iconAtlas: '/js/core/icon-stop-atlas.png',

        iconMapping: {
            'stop-regular': {
                x: 0, y: 0, width: 48, height: 48,
                anchorX: 24, anchorY: 48,
                mask: false
            },
            'stop-start': {
                x: 48, y: 0, width: 48, height: 48,
                anchorX: 24, anchorY: 48,
                mask: false
            },
            'stop-end': {
                x: 96, y: 0, width: 48, height: 48,
                anchorX: 24, anchorY: 48,
                mask: false
            }
        },

        getSize: d => d.isHovered ? 1.4 : 1.0,
        sizeScale: 0.7,
        sizeMinPixels: 20,
        sizeMaxPixels: 40,

        getColor: d => d.isHovered ? [255, 215, 0] : [255, 255, 255],

        pickable: true,
        onHover,

        updateTriggers: {
            getSize: hoveredStopId,
            getColor: hoveredStopId
        }
    });
}
/**
 * Creates the animated bus layer using IconLayer with SVG icon
 * @param {Array} paths - Array of route objects
 * @param {Object} IconLayer - Deck.gl IconLayer constructor
 * @param {number} progress - Animation progress (0 to 1) - fallback if position not provided
 * @param {Object} routeGroup - Current route group with directions
 * @param {boolean} hasTwoDirs - Whether route has two directions
 * @param {number} directionIndex - Current direction index (0 or 1)
 * @param {boolean} isReversed - Whether path is reversed
 * @param {Array|null} position - direct bus position [lon, lat, alt]
 * @returns {IconLayer|null} Configured layer instance or null
 */
export function createBusLayer(paths, IconLayer, progress, routeGroup, hasTwoDirs, directionIndex, isReversed, position) {
    if (!paths || paths.length === 0 || !routeGroup) return null;

    const busPosition = position || (() => {
        const availableDirections = Object.keys(routeGroup.directions);
        if (availableDirections.length === 0) return null;

        let path;
        if (hasTwoDirs && availableDirections.length >= 2) {
            const currentDirection = availableDirections[directionIndex % 2];
            path = routeGroup.directions[currentDirection].path;
        } else {
            const originalPath = routeGroup.directions[availableDirections[0]].path;
            path = isReversed ? [...originalPath].reverse() : originalPath;
        }

        if (!path || path.length < 2) return null;

        const totalSegments = path.length - 1;
        const scaledProgress = progress * totalSegments;
        const startIndex = Math.floor(scaledProgress);
        const fraction = scaledProgress - startIndex;
        const nextIndex = Math.min(startIndex + 1, path.length - 1);

        const start = path[startIndex];
        const end = path[nextIndex];

        return [
            start[0] + (end[0] - start[0]) * fraction,
            start[1] + (end[1] - start[1]) * fraction,
            0
        ];
    })();

    if (!busPosition) return null;

    // Use IconLayer with SVG icon
    return new IconLayer({
        id: 'bus-layer',
        data: [{ position: busPosition, id: `bus-${routeGroup.lineId}` }],
        getPosition: d => d.position,

        // Icon configuration
        getIcon: () => 'bus',

        // Icon atlas (SVG file)
        iconAtlas: '/js/core/bus-icon.svg',

        // Icon mapping
        iconMapping: {
            bus: {
                x: 0,
                y: 0,
                width: 64,
                height: 64,
                anchorX: 32,
                anchorY: 32,
                mask: false
            }
        },

        // Size and scaling
        getSize: () => 1,
        sizeScale: 0.8,
        sizeMinPixels: 24,
        sizeMaxPixels: 48,

        // Color tint
        getLineColor: () => [255, 255, 255],

        // Visual styling
        pickable: false,

        // Ensure icon updates when position changes
        updateTriggers: {
            getPosition: busPosition
        }
    });
}

