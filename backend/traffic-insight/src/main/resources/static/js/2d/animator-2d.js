import { SINGLE_DIRECTION_LINES } from '../3d/single_direction_line.js';

/**
 * BusAnimator2D — stop-by-stop path interpolation for the 2D Leaflet map.
 *
 * Mirrors the animation logic from the 3D main.js:
 *  - Maps each stop to its closest index on the route path (once, on start)
 *  - Advances PATH_POINTS_PER_FRAME path points per animation frame
 *  - Pauses at each stop for STOP_PAUSE_MS milliseconds
 *  - On circular lines (SINGLE_DIRECTION_LINES): stops at end and calls onComplete
 *  - On standard lines: switches direction and keeps running
 */
export class BusAnimator2D {

    // How many path points to advance per frame — tune for speed
    static PATH_POINTS_PER_FRAME = 3;
    static STOP_PAUSE_MS         = 2500;
    static END_PAUSE_MS          = 5000;

    constructor(map, options = {}) {
        this.map    = map;
        this.marker = null;

        // Callbacks
        this.onStopReached     = options.onStopReached     || null; // (stop) => void
        this.onComplete        = options.onComplete        || null; // () => void
        this.onDirectionSwitch = options.onDirectionSwitch || null;
        this.onFollowChanged   = options.onFollowChanged   || null; // (following: bool) => void

        // Camera follow — enabled by default, disabled when user moves the map manually
        this.followCamera   = false;
        this._userMovedMap  = false;

        this._reset();
        this._setupMapListeners();
    }

    // ─── Public API ──────────────────────────────────────────────────────────────

    /**
     * Prepare animation state for a direction — positions bus at first stop.
     * Does NOT start moving until start() is called.
     *
     * @param {Object}   routeGroup     - { lineId, directions: { [key]: { path } } }
     * @param {boolean}  hasTwoDirs     - Whether the route has two directions
     * @param {string}   lineId         - Current line ID (for circular detection)
     * @param {Array}    stops          - Ordered stop array [{ position:[lng,lat], name, id }]
     * @param {number}   directionIndex - 0 = outbound, 1 = return
     */
    prepare(routeGroup, hasTwoDirs, lineId, stops, directionIndex = 0) {
        this._reset();

        this.routeGroup      = routeGroup;
        this.hasTwoDirections = hasTwoDirs;
        this.lineId          = lineId;
        this.directionIndex  = directionIndex;

        if (!routeGroup || !stops || stops.length === 0) return;

        const directions = Object.keys(routeGroup.directions);
        const dirKey     = directions[directionIndex % directions.length];
        this.currentPath = routeGroup.directions[dirKey]?.path || null;

        if (!this.currentPath || this.currentPath.length === 0) return;

        // Map each stop to closest path index (done once)
        this.stops = stops.map(stop => {
            let minDist = Infinity, closestIdx = 0;
            for (let i = 0; i < this.currentPath.length; i++) {
                const dx = this.currentPath[i][0] - stop.position[0];
                const dy = this.currentPath[i][1] - stop.position[1];
                const d  = dx * dx + dy * dy;
                if (d < minDist) { minDist = d; closestIdx = i; }
            }
            return { ...stop, pathIndex: closestIdx };
        });

        // Position marker at first stop
        this.pathPointIndex = this.stops[0].pathIndex;
        this._updateMarkerPosition(this.currentPath[this.pathPointIndex]);
    }

    /**
     * Start (or resume) the animation.
     */
    start() {
        if (!this.currentPath || this.stops.length === 0) return;
        this.isRunning = true;
        this.enableFollow(); // re-enable follow on every explicit start
        if (!this.animationId) this._tick();
    }

    /**
     * Pause the animation — bus stays at current position.
     */
    pause() {
        this.isRunning = false;
        if (this.moveTimer) { clearTimeout(this.moveTimer); this.moveTimer = null; }
    }

    /**
     * Full stop — removes marker, cancels all timers.
     */
    stop() {
        this.isRunning = false;
        if (this.animationId)  { cancelAnimationFrame(this.animationId); this.animationId = null; }
        if (this.moveTimer)    { clearTimeout(this.moveTimer); this.moveTimer = null; }
        if (this.marker && this.map.hasLayer(this.marker)) {
            this.map.removeLayer(this.marker);
        }
        this.marker = null;
    }

    // ─── Private helpers ─────────────────────────────────────────────────────────

    _reset() {
        this.stop();
        this.routeGroup       = null;
        this.hasTwoDirections = false;
        this.lineId           = '';
        this.stops            = [];
        this.currentPath      = null;
        this.directionIndex   = 0;
        this.pathPointIndex   = 0;
        this.currentStopIndex = 0;
        this.isRunning        = false;
        this.isWaitingAtStop  = false;
        this.isWaitingAtEnd   = false;
        this.animationId      = null;
        this.moveTimer        = null;
    }

    /**
     * Attaches Leaflet map event listeners to detect manual user interaction.
     * When the user drags or zooms manually, camera follow is disabled.
     * Follow is re-enabled when startBusAnimation() is called again.
     */
    _setupMapListeners() {
        if (!this.map) return;

        const disableFollow = () => {
            if (this.followCamera && !this._programmaticMove) {
                this.followCamera  = false;
                this._userMovedMap = true;
                if (this.onFollowChanged) this.onFollowChanged(false);
            }
        };

        // Disable follow only on drag — zoom keeps the bus centered at new zoom level
        this.map.on('dragstart', disableFollow);
    }

    /**
     * Enables camera follow — called when simulation starts.
     */
    enableFollow() {
        this.followCamera   = true;
        this._userMovedMap  = false;
        if (this.onFollowChanged) this.onFollowChanged(true);
    }

    /**
     * Disables camera follow without affecting the simulation.
     */
    disableFollow() {
        this.followCamera = false;
        if (this.onFollowChanged) this.onFollowChanged(false);
    }

    /**
     * Main animation loop — mirrors animateBus() from 3D main.js.
     */
    _tick() {
        this.animationId = requestAnimationFrame(() => this._tick());

        if (!this.currentPath || this.stops.length === 0) return;
        if (!this.isRunning)      return; // paused
        if (this.isWaitingAtStop) return; // paused at stop
        if (this.isWaitingAtEnd)  return; // waiting at terminal

        // End of stop list
        if (this.currentStopIndex >= this.stops.length) {
            this.isWaitingAtEnd = true;
            const isCircular = SINGLE_DIRECTION_LINES.has(this.lineId?.toLowerCase());

            if (isCircular) {
                // Circular line — stop and notify caller
                this.isRunning = false;
                this.isWaitingAtEnd = false;
                if (this.onComplete) this.onComplete();
            } else {
                // Standard line — switch direction after pause
                this.moveTimer = setTimeout(() => {
                    const nextDir = this.directionIndex === 0 ? 1 : 0;
                    this._switchDirection(nextDir);
                }, BusAnimator2D.END_PAUSE_MS);
            }
            return;
        }

        // Advance toward target stop
        const targetStop  = this.stops[this.currentStopIndex];
        const safeTarget  = Math.min(targetStop.pathIndex, this.currentPath.length - 1);

        if (this.pathPointIndex > safeTarget) {
            // Out-of-order stop — snap and advance
            this.pathPointIndex = safeTarget;
            this.currentStopIndex++;
            return;
        }

        this.pathPointIndex = Math.min(
            this.pathPointIndex + BusAnimator2D.PATH_POINTS_PER_FRAME,
            safeTarget
        );
        this.pathPointIndex = Math.max(0, Math.min(this.pathPointIndex, this.currentPath.length - 1));

        const pt = this.currentPath[this.pathPointIndex];
        if (!pt) return;
        this._updateMarkerPosition(pt);

        // Camera follow — pan to bus position smoothly if enabled
        if (this.followCamera) {
            this._programmaticMove = true;
            this.map.panTo([pt[1], pt[0]], { animate: true, duration: 0.3, easeLinearity: 1 });
            this._programmaticMove = false;
        }

        // Reached target stop
        if (this.pathPointIndex >= targetStop.pathIndex) {
            this.isWaitingAtStop = true;
            if (this.onStopReached) this.onStopReached(targetStop);

            this.moveTimer = setTimeout(() => {
                this.currentStopIndex++;
                this.isWaitingAtStop = false;
                this.moveTimer = null;
            }, BusAnimator2D.STOP_PAUSE_MS);
        }
    }

    /**
     * Switch to a new direction — reloads path + stops from outside via callback.
     * The caller (main-2d.js) listens for onDirectionSwitch.
     */
    _switchDirection(nextDir) {
        this.isWaitingAtEnd = false;
        if (this.onDirectionSwitch) this.onDirectionSwitch(nextDir);
    }

    /**
     * Move the Leaflet marker to a path point [lng, lat].
     * Uses the shared bus-icon.svg from /js/core/ for visual consistency with the 3D map.
     */
    _updateMarkerPosition([lng, lat]) {
        if (!this.map) return;

        if (!this.marker) {
            // Use the same bus SVG icon as the 3D map
            const busIcon = L.divIcon({
                className: '',
                html: `<img src="/js/core/bus-icon.svg"
                            style="width:32px;height:32px;
                                   filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5));
                                   display:block;"
                            alt="bus"/>`,
                iconSize:   [32, 32],
                iconAnchor: [16, 16]
            });

            this.marker = L.marker([lat, lng], {
                icon:           busIcon,
                zIndexOffset:   1000,
                interactive:    false
            }).addTo(this.map);
        } else {
            this.marker.setLatLng([lat, lng]);
            if (!this.map.hasLayer(this.marker)) {
                this.marker.addTo(this.map);
            }
        }
    }
}